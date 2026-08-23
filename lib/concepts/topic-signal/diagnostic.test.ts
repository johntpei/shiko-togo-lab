import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { CONCEPT_EXTRACTION_VERSION } from "@/lib/concepts/types";
import { applySqlMigrations } from "@/lib/db/client";
import {
  countConceptAliases,
  countConceptOccurrences,
  countConcepts,
  insertConcept,
  insertConceptOccurrence,
} from "@/lib/db/concept-queries";
import * as schema from "@/lib/db/schema";
import { addCalendarDays, calendarDayDistance } from "./calendar";
import {
  TOPIC_SIGNAL_DIAGNOSTIC_VERSION,
  buildTopicSignalDiagnostic,
} from "./diagnostic";
import { formatTopicSignalDiagnosticReport } from "./diagnostic-format";
import { loadTopicSignalSnapshot } from "./load";
import {
  TOPIC_SIGNAL_SNAPSHOT_VERSION,
  buildTopicSignalSnapshot,
  type TopicSignalConceptInput,
  type TopicSignalOccurrenceInput,
} from "./snapshot";

const USER =
  "これまでの人間関係でなぜ上手くいかないのか理解できないと思った。";
const ASOF = "2026-08-02T18:00:00.000Z";

function occ(
  conceptId: string,
  sessionId: string,
  occurredAt: string,
): TopicSignalOccurrenceInput {
  return { conceptId, sessionId, occurredAt };
}

function concept(
  conceptId: string,
  canonicalLabel: string,
): TopicSignalConceptInput {
  return { conceptId, canonicalLabel };
}

function diagnose(
  concepts: TopicSignalConceptInput[],
  occurrences: TopicSignalOccurrenceInput[],
) {
  return buildTopicSignalDiagnostic(
    buildTopicSignalSnapshot({ concepts, occurrences }),
  );
}

function openMemoryDb() {
  const sqlite = new Database(":memory:");
  applySqlMigrations(sqlite);
  sqlite.pragma("foreign_keys = ON");
  return drizzle(sqlite, { schema });
}

function seedSession(
  db: ReturnType<typeof openMemoryDb>,
  id: string,
  content = USER,
) {
  db.insert(schema.sessions)
    .values({
      id,
      title: id,
      occurredAt: "1999-01-01",
      source: "chatgpt",
      category: "制作",
      rawContent: "x",
      status: "parsed",
      sourceConversationId: null,
      importSource: "manual",
      sourceStartAt: null,
      sourceEndAt: null,
      createdAt: "2026-08-18T00:00:00.000Z",
      updatedAt: "2026-08-18T00:00:00.000Z",
    })
    .run();
  db.insert(schema.messages)
    .values({
      id: `${id}-u`,
      sessionId: id,
      index: 0,
      role: "user",
      content,
      charStart: 0,
      charEnd: content.length,
      sourceMessageId: null,
      sourceCreatedAt: "2026-07-15T12:00:00.000Z",
      contentType: "text",
      attachmentsJson: null,
    })
    .run();
}

test("calendarDayDistance same day is 0", () => {
  assert.equal(calendarDayDistance("2026-08-02", "2026-08-02"), 0);
  assert.equal(addCalendarDays("2026-08-02", -13), "2026-07-20");
  assert.equal(addCalendarDays("2026-08-02", -29), "2026-07-04");
});

test("A. daysSinceLastSeen is asOf date minus lastSeen date", () => {
  const report = diagnose(
    [concept("c1", "人間関係")],
    [
      occ("c1", "s1", ASOF),
      occ("c1", "s2", "2026-07-26T00:00:00.000Z"),
    ],
  );
  const byId = Object.fromEntries(
    report.concepts.map((row) => [row.conceptId, row]),
  );
  assert.equal(byId.c1?.daysSinceLastSeen, 0);
  const older = diagnose(
    [concept("c2", "距離感")],
    [occ("c2", "s1", "2026-07-26T00:00:00.000Z"), occ("c2", "s0", ASOF)],
  );
  assert.equal(older.concepts[0]?.daysSinceLastSeen, 0);
  const onlyOld = diagnose(
    [concept("c3", "返信")],
    [occ("c3", "s1", "2026-07-26T12:00:00.000Z")],
  );
  assert.equal(onlyOld.asOf, "2026-07-26T12:00:00.000Z");
  assert.equal(onlyOld.concepts[0]?.daysSinceLastSeen, 0);
  const withAsOf = diagnose(
    [concept("c4", "人間関係"), concept("c5", "距離感")],
    [
      occ("c4", "s-asof", ASOF),
      occ("c5", "s-old", "2026-07-26T00:00:00.000Z"),
    ],
  );
  const rows = Object.fromEntries(
    withAsOf.concepts.map((row) => [row.conceptId, row]),
  );
  assert.equal(rows.c4?.daysSinceLastSeen, 0);
  assert.equal(rows.c5?.daysSinceLastSeen, 7);
});

test("B. observedSpanDays same-day = 0, otherwise calendar difference", () => {
  const sameDay = diagnose(
    [concept("c1", "人間関係")],
    [
      occ("c1", "s1", "2026-07-15T10:00:00.000Z"),
      occ("c1", "s1", "2026-07-15T18:00:00.000Z"),
    ],
  );
  assert.equal(sameDay.concepts[0]?.observedSpanDays, 0);
  const span = diagnose(
    [concept("c1", "人間関係")],
    [
      occ("c1", "s1", "2026-07-12T00:00:00.000Z"),
      occ("c1", "s2", "2026-07-20T00:00:00.000Z"),
    ],
  );
  assert.equal(span.concepts[0]?.observedSpanDays, 8);
});

test("C. multiple occurrences list includes only matching Concepts", () => {
  const report = diagnose(
    [concept("c1", "人間関係"), concept("c2", "距離感")],
    [
      occ("c1", "s1", "2026-07-15T00:00:00.000Z"),
      occ("c1", "s2", "2026-07-16T00:00:00.000Z"),
      occ("c2", "s3", ASOF),
    ],
  );
  assert.deepEqual(
    report.summary.conceptsWithMultipleOccurrences.map((row) => row.conceptId),
    ["c1"],
  );
  assert.equal(report.summary.occurrenceCountDistribution.one, 1);
  assert.equal(report.summary.occurrenceCountDistribution.two, 1);
});

test("D. cross-session repetition is listed separately", () => {
  const report = diagnose(
    [concept("c1", "人間関係")],
    [
      occ("c1", "s1", "2026-07-15T00:00:00.000Z"),
      occ("c1", "s2", "2026-07-16T00:00:00.000Z"),
    ],
  );
  assert.equal(report.summary.conceptsObservedInMultipleSessions.length, 1);
  assert.equal(
    report.summary.conceptsWithSameSessionMultipleOccurrences.length,
    0,
  );
});

test("E. same-session multiple occurrences are not mixed with cross-session", () => {
  const report = diagnose(
    [concept("c1", "人間関係")],
    [
      occ("c1", "s1", "2026-07-15T10:00:00.000Z"),
      occ("c1", "s1", "2026-07-15T11:00:00.000Z"),
    ],
  );
  assert.equal(report.summary.conceptsWithSameSessionMultipleOccurrences.length, 1);
  assert.equal(report.summary.conceptsObservedInMultipleSessions.length, 0);
});

test("F. gap calculation uses occurredAt ascending calendar dates", () => {
  const report = diagnose(
    [concept("c1", "両親")],
    [
      occ("c1", "s2", "2026-07-20T00:00:00.000Z"),
      occ("c1", "s1", "2026-07-12T00:00:00.000Z"),
    ],
  );
  const row = report.concepts[0]!;
  assert.deepEqual(row.occurrenceGapDays, [8]);
  assert.equal(row.minGapDays, 8);
  assert.equal(row.maxGapDays, 8);
  const sameDay = diagnose(
    [concept("c2", "人間関係")],
    [
      occ("c2", "s1", "2026-07-15T10:00:00.000Z"),
      occ("c2", "s1", "2026-07-15T18:00:00.000Z"),
    ],
  );
  assert.deepEqual(sameDay.concepts[0]?.occurrenceGapDays, [0]);
});

test("G. last14d includes asOf date and 13 days before", () => {
  const report = diagnose(
    [concept("c1", "人間関係")],
    [
      occ("c1", "s-asof", ASOF),
      occ("c1", "s-start", "2026-07-20T00:00:00.000Z"),
      occ("c1", "s-before", "2026-07-19T00:00:00.000Z"),
    ],
  );
  const row = report.concepts[0]!;
  assert.equal(row.last14d.occurrenceCount, 2);
  assert.equal(row.last14d.activeDayCount, 2);
  assert.equal(row.totalOccurrenceCount, 3);
});

test("H. last30d includes asOf date and 29 days before", () => {
  const report = diagnose(
    [concept("c1", "人間関係")],
    [
      occ("c1", "s-asof", ASOF),
      occ("c1", "s-start", "2026-07-04T00:00:00.000Z"),
      occ("c1", "s-before", "2026-07-03T00:00:00.000Z"),
    ],
  );
  const row = report.concepts[0]!;
  assert.equal(row.last30d.occurrenceCount, 2);
  assert.equal(row.totalOccurrenceCount, 3);
});

test("I. outside window remains in totals only", () => {
  const report = diagnose(
    [concept("c1", "人間関係")],
    [
      occ("c1", "s-asof", ASOF),
      occ("c1", "s-old", "2026-06-01T00:00:00.000Z"),
    ],
  );
  const row = report.concepts[0]!;
  assert.equal(row.totalOccurrenceCount, 2);
  assert.equal(row.last14d.occurrenceCount, 1);
  assert.equal(row.last30d.occurrenceCount, 1);
  assert.equal(row.recent7dOccurrenceCount, 1);
});

test("J. 7d comparison pair is raw recent / previous counts", () => {
  const report = diagnose(
    [
      concept("c-recent", "寂しさ"),
      concept("c-prev", "第2の脳"),
      concept("c-both", "人間関係"),
      concept("c-none", "両親"),
    ],
    [
      occ("c-recent", "s1", ASOF),
      occ("c-prev", "s2", "2026-07-26T00:00:00.000Z"),
      occ("c-both", "s3", ASOF),
      occ("c-both", "s4", "2026-07-26T00:00:00.000Z"),
      occ("c-none", "s5", "2026-07-12T00:00:00.000Z"),
    ],
  );
  const pairs = report.summary.recentPreviousPairCounts;
  assert.equal(pairs.recentPositivePreviousZero, 1);
  assert.equal(pairs.recentZeroPreviousPositive, 1);
  assert.equal(pairs.bothPositive, 1);
  assert.equal(pairs.bothZero, 1);
});

test("K. delta is recent minus previous only", () => {
  const report = diagnose(
    [concept("c1", "人間関係")],
    [
      occ("c1", "s1", ASOF),
      occ("c1", "s1", "2026-08-01T00:00:00.000Z"),
      occ("c1", "s2", "2026-07-26T00:00:00.000Z"),
    ],
  );
  const row = report.concepts[0]!;
  assert.equal(row.recent7dOccurrenceCount, 2);
  assert.equal(row.previous7dOccurrenceCount, 1);
  assert.equal(row.recent7dOccurrenceDelta, 1);
});

test("L. deterministic regardless of input order", () => {
  const concepts = [concept("c-b", "距離感"), concept("c-a", "人間関係")];
  const occurrences = [
    occ("c-b", "s1", "2026-07-20T00:00:00.000Z"),
    occ("c-a", "s2", ASOF),
    occ("c-a", "s3", "2026-07-26T00:00:00.000Z"),
  ];
  const first = diagnose(concepts, occurrences);
  const second = diagnose([...concepts].reverse(), [...occurrences].reverse());
  assert.deepEqual(first, second);
});

test("M. empty Snapshot yields empty diagnostic", () => {
  const report = buildTopicSignalDiagnostic(
    buildTopicSignalSnapshot({ concepts: [], occurrences: [] }),
  );
  assert.equal(report.version, TOPIC_SIGNAL_DIAGNOSTIC_VERSION);
  assert.equal(report.asOf, null);
  assert.deepEqual(report.concepts, []);
  assert.equal(report.summary.conceptCount, 0);
  assert.equal(report.summary.conceptsWithOccurrence7d, 0);
});

test("N. serialized diagnostic has no USER body", () => {
  const report = diagnose(
    [concept("c1", "人間関係")],
    [occ("c1", "s1", ASOF)],
  );
  const serialized = `${JSON.stringify(report)}\n${formatTopicSignalDiagnosticReport(report)}`;
  assert.equal(serialized.includes(USER), false);
  assert.equal(serialized.includes("surfaceForm"), false);
});

test("O. no Product classification / score fields", () => {
  const report = diagnose(
    [concept("c1", "人間関係")],
    [occ("c1", "s1", ASOF)],
  );
  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes('"rising"'), false);
  assert.equal(serialized.includes('"falling"'), false);
  assert.equal(serialized.includes('"emerging"'), false);
  assert.equal(serialized.includes('"recurring"'), false);
  assert.equal(serialized.includes('"importance"'), false);
  assert.equal(serialized.includes('"score"'), false);
  assert.equal("signalScore" in report.summary, false);
  assert.equal("importanceScore" in report, false);
});

test("P. no LLM / Observation / Snapshot contract change", () => {
  const files = [
    "lib/concepts/topic-signal/diagnostic.ts",
    "lib/concepts/topic-signal/diagnostic-format.ts",
    "lib/concepts/topic-signal/snapshot.ts",
  ];
  for (const file of files) {
    const source = readFileSync(resolve(process.cwd(), file), "utf8");
    assert.doesNotMatch(source, /getAiProvider/);
    assert.doesNotMatch(source, /from "openai"/);
    assert.doesNotMatch(source, /named_or_high/);
    assert.doesNotMatch(source, /evaluatePolicyCalibration/);
  }
  const snapshotSource = readFileSync(
    resolve(process.cwd(), "lib/concepts/topic-signal/snapshot.ts"),
    "utf8",
  );
  assert.match(snapshotSource, /topic-signal-snapshot-v0/);
  assert.doesNotMatch(snapshotSource, /from "\.\/diagnostic"/);
  assert.doesNotMatch(snapshotSource, /last14d/);
  assert.doesNotMatch(snapshotSource, /last30d/);
  assert.equal(TOPIC_SIGNAL_SNAPSHOT_VERSION, "topic-signal-snapshot-v0");
  const diagnosticSource = readFileSync(
    resolve(process.cwd(), "lib/concepts/topic-signal/diagnostic.ts"),
    "utf8",
  );
  assert.match(diagnosticSource, /buildTopicSignalDiagnostic/);
  assert.doesNotMatch(diagnosticSource, /getDb\(/);
  assert.doesNotMatch(diagnosticSource, /from "@\/lib\/observations/);
});

test("Q. zero DB mutation", () => {
  const db = openMemoryDb();
  seedSession(db, "s1");
  seedSession(db, "s2");
  const inserted = insertConcept(
    {
      id: "c1",
      canonicalLabel: "人間関係",
      createdAt: "2026-08-18T00:00:00.000Z",
    },
    db,
  );
  assert.equal(inserted.status, "inserted");
  const occ1 = insertConceptOccurrence(
    {
      id: "o1",
      conceptId: "c1",
      sessionId: "s1",
      messageId: "s1-u",
      evidenceRef: "M001:E01",
      occurredAt: "2026-07-15T12:00:00.000Z",
      sourceRole: "user",
      sourceType: "evidence_unit",
      extractionVersion: CONCEPT_EXTRACTION_VERSION,
    },
    db,
  );
  const occ2 = insertConceptOccurrence(
    {
      id: "o2",
      conceptId: "c1",
      sessionId: "s2",
      messageId: "s2-u",
      evidenceRef: "M001:E01",
      occurredAt: ASOF,
      sourceRole: "user",
      sourceType: "evidence_unit",
      extractionVersion: CONCEPT_EXTRACTION_VERSION,
    },
    db,
  );
  assert.equal(occ1.status, "inserted");
  assert.equal(occ2.status, "inserted");
  const before = {
    concepts: countConcepts(db),
    aliases: countConceptAliases(db),
    occurrences: countConceptOccurrences(db),
  };
  const snapshot = loadTopicSignalSnapshot({ db });
  const report = buildTopicSignalDiagnostic(snapshot);
  assert.equal(report.concepts.length, 1);
  assert.equal(report.concepts[0]?.daysSinceLastSeen, 0);
  const after = {
    concepts: countConcepts(db),
    aliases: countConceptAliases(db),
    occurrences: countConceptOccurrences(db),
  };
  assert.deepEqual(after, before);
});
