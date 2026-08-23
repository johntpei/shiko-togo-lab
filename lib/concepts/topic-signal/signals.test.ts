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
import { loadTopicSignals } from "./load";
import {
  TOPIC_SIGNAL_REASON_OBSERVED_IN_MULTIPLE_SESSIONS,
  TOPIC_SIGNAL_REASON_RECENT_OCCURRENCE_PRESENT,
  TOPIC_SIGNAL_VERSION,
  buildTopicSignals,
} from "./signals";
import { formatTopicSignalSet } from "./signals-format";
import {
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

function signals(
  concepts: TopicSignalConceptInput[],
  occurrences: TopicSignalOccurrenceInput[],
) {
  return buildTopicSignals(
    buildTopicSignalSnapshot({ concepts, occurrences }),
  );
}

function openMemoryDb() {
  const sqlite = new Database(":memory:");
  applySqlMigrations(sqlite);
  sqlite.pragma("foreign_keys = ON");
  return drizzle(sqlite, { schema });
}

function seedSession(db: ReturnType<typeof openMemoryDb>, id: string) {
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
      content: USER,
      charStart: 0,
      charEnd: USER.length,
      sourceMessageId: null,
      sourceCreatedAt: "2026-07-15T12:00:00.000Z",
      contentType: "text",
      attachmentsJson: null,
    })
    .run();
}

test("A. empty Snapshot → both groups empty", () => {
  const result = signals([], []);
  assert.equal(result.version, TOPIC_SIGNAL_VERSION);
  assert.equal(result.asOf, null);
  assert.deepEqual(result.recentlyObserved, []);
  assert.deepEqual(result.crossSessionRecurrence, []);
});

test("B. recent one-off → recently_observed only", () => {
  const result = signals(
    [concept("c1", "寂しさ")],
    [occ("c1", "s1", ASOF)],
  );
  assert.equal(result.recentlyObserved.length, 1);
  assert.equal(result.crossSessionRecurrence.length, 0);
  const item = result.recentlyObserved[0]!;
  assert.equal(item.type, "recently_observed");
  assert.equal(item.conceptId, "c1");
  assert.equal(item.recent7d.occurrenceCount, 1);
  assert.equal(item.reasonCode, TOPIC_SIGNAL_REASON_RECENT_OCCURRENCE_PRESENT);
  assert.equal(item.reason.recent7dOccurrenceCount, 1);
});

test("C. old one-off → neither group", () => {
  const result = signals(
    [concept("c1", "人間関係"), concept("c-asof", "anchor")],
    [
      occ("c-asof", "s-asof", ASOF),
      occ("c1", "s1", "2026-07-15T00:00:00.000Z"),
    ],
  );
  assert.equal(
    result.recentlyObserved.some((row) => row.conceptId === "c1"),
    false,
  );
  assert.equal(
    result.crossSessionRecurrence.some((row) => row.conceptId === "c1"),
    false,
  );
});

test("D. cross-session old → recurrence only", () => {
  const result = signals(
    [concept("c1", "人間関係"), concept("c-asof", "anchor")],
    [
      occ("c-asof", "s-asof", ASOF),
      occ("c1", "s1", "2026-07-15T00:00:00.000Z"),
      occ("c1", "s2", "2026-07-16T00:00:00.000Z"),
    ],
  );
  assert.equal(
    result.recentlyObserved.some((row) => row.conceptId === "c1"),
    false,
  );
  assert.equal(result.crossSessionRecurrence.length, 1);
  const item = result.crossSessionRecurrence[0]!;
  assert.equal(item.type, "cross_session_recurrence");
  assert.equal(item.conceptId, "c1");
  assert.equal(item.totalOccurrenceCount, 2);
  assert.equal(item.distinctSessionCount, 2);
  assert.equal(
    item.reasonCode,
    TOPIC_SIGNAL_REASON_OBSERVED_IN_MULTIPLE_SESSIONS,
  );
});

test("E. recent cross-session → both Signals", () => {
  const result = signals(
    [concept("c1", "人間関係")],
    [
      occ("c1", "s1", ASOF),
      occ("c1", "s2", "2026-07-26T00:00:00.000Z"),
    ],
  );
  assert.equal(result.recentlyObserved.length, 1);
  assert.equal(result.crossSessionRecurrence.length, 1);
  assert.equal(result.recentlyObserved[0]?.conceptId, "c1");
  assert.equal(result.crossSessionRecurrence[0]?.conceptId, "c1");
});

test("F. same-session multiple is not recurrence", () => {
  const oldSame = signals(
    [concept("c1", "人間関係"), concept("c-asof", "anchor")],
    [
      occ("c-asof", "s-asof", ASOF),
      occ("c1", "s1", "2026-07-15T10:00:00.000Z"),
      occ("c1", "s1", "2026-07-15T11:00:00.000Z"),
    ],
  );
  assert.equal(
    oldSame.crossSessionRecurrence.some((row) => row.conceptId === "c1"),
    false,
  );
  assert.equal(
    oldSame.recentlyObserved.some((row) => row.conceptId === "c1"),
    false,
  );

  const recentSame = signals(
    [concept("c2", "寂しさ")],
    [
      occ("c2", "s1", ASOF),
      occ("c2", "s1", "2026-08-02T10:00:00.000Z"),
    ],
  );
  assert.equal(recentSame.recentlyObserved.length, 1);
  assert.equal(recentSame.crossSessionRecurrence.length, 0);
});

test("G. previous7d only is not recently_observed", () => {
  const result = signals(
    [concept("c1", "第2の脳"), concept("c-asof", "anchor")],
    [
      occ("c-asof", "s-asof", ASOF),
      occ("c1", "s1", "2026-07-26T00:00:00.000Z"),
    ],
  );
  assert.equal(result.asOf, ASOF);
  assert.equal(
    result.recentlyObserved.some((row) => row.conceptId === "c1"),
    false,
  );
  assert.equal(
    result.crossSessionRecurrence.some((row) => row.conceptId === "c1"),
    false,
  );
  assert.equal(
    result.recentlyObserved.some((row) => row.conceptId === "c-asof"),
    true,
  );
});

test("H. recent > previous still has no trend field", () => {
  const result = signals(
    [concept("c1", "寂しさ")],
    [
      occ("c1", "s1", ASOF),
      occ("c1", "s1", "2026-08-01T00:00:00.000Z"),
      occ("c1", "s2", "2026-07-26T00:00:00.000Z"),
    ],
  );
  assert.equal(result.recentlyObserved.length, 1);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('"rising"'), false);
  assert.equal("rising" in result.recentlyObserved[0]!, false);
});

test("I. recently_observed ordering lastSeenAt DESC, conceptId ASC", () => {
  const result = signals(
    [concept("c-b", "高性能AI"), concept("c-a", "寂しさ")],
    [
      occ("c-b", "s1", ASOF),
      occ("c-a", "s2", ASOF),
    ],
  );
  assert.deepEqual(
    result.recentlyObserved.map((row) => row.conceptId),
    ["c-a", "c-b"],
  );
  const shuffled = signals(
    [concept("c-a", "寂しさ"), concept("c-b", "高性能AI")],
    [occ("c-a", "s2", ASOF), occ("c-b", "s1", "2026-08-01T00:00:00.000Z")],
  );
  assert.deepEqual(
    shuffled.recentlyObserved.map((row) => row.conceptId),
    ["c-a", "c-b"],
  );
});

test("J. recurrence ordering lastSeenAt DESC, conceptId ASC", () => {
  const result = signals(
    [
      concept("c-b", "両親"),
      concept("c-a", "人間関係"),
      concept("c-asof", "anchor"),
    ],
    [
      occ("c-asof", "s-asof", ASOF),
      occ("c-b", "s1", "2026-07-12T00:00:00.000Z"),
      occ("c-b", "s2", "2026-07-16T00:00:00.000Z"),
      occ("c-a", "s3", "2026-07-15T00:00:00.000Z"),
      occ("c-a", "s4", "2026-07-16T00:00:00.000Z"),
    ],
  );
  assert.deepEqual(
    result.crossSessionRecurrence.map((row) => row.conceptId),
    ["c-a", "c-b"],
  );
});

test("K. no score fields", () => {
  const result = signals(
    [concept("c1", "寂しさ")],
    [occ("c1", "s1", ASOF)],
  );
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("signalScore"), false);
  assert.equal(serialized.includes("importanceScore"), false);
  assert.equal(serialized.includes("trendScore"), false);
  assert.equal(serialized.includes("momentumScore"), false);
  assert.equal(serialized.includes("recurrenceScore"), false);
  assert.equal(serialized.includes('"score"'), false);
});

test("L. no trend classification fields", () => {
  const result = signals(
    [concept("c1", "寂しさ")],
    [occ("c1", "s1", ASOF)],
  );
  const serialized = JSON.stringify(result);
  for (const name of [
    "rising",
    "falling",
    "emerging",
    "returning",
    "dormant",
    "stable",
  ]) {
    assert.equal(serialized.includes(`"${name}"`), false);
  }
});

test("M. overlap: same Concept may appear in both arrays", () => {
  const result = signals(
    [concept("c1", "人間関係")],
    [
      occ("c1", "s1", ASOF),
      occ("c1", "s2", "2026-07-20T00:00:00.000Z"),
    ],
  );
  assert.equal(result.recentlyObserved[0]?.conceptId, "c1");
  assert.equal(result.crossSessionRecurrence[0]?.conceptId, "c1");
});

test("N. builder uses Snapshot only, not DB or Occurrence rows", () => {
  const source = readFileSync(
    resolve(process.cwd(), "lib/concepts/topic-signal/signals.ts"),
    "utf8",
  );
  assert.match(source, /buildTopicSignals/);
  assert.match(source, /recent7d\.occurrenceCount/);
  assert.doesNotMatch(source, /from "\.\/load"/);
  assert.doesNotMatch(source, /conceptOccurrences/);
  assert.doesNotMatch(source, /getDb\(/);
  assert.doesNotMatch(source, /from "@\/lib\/db\/schema"/);
  assert.doesNotMatch(source, /daysSinceLastSeen/);
});

test("O. USER本文なし", () => {
  const result = signals(
    [concept("c1", "人間関係")],
    [occ("c1", "s1", ASOF)],
  );
  const serialized = `${JSON.stringify(result)}\n${formatTopicSignalSet(result)}`;
  assert.equal(serialized.includes(USER), false);
  assert.equal(serialized.includes("surfaceForm"), false);
});

test("P. no LLM / Observation / diagnostic reverse dependency", () => {
  const files = [
    "lib/concepts/topic-signal/signals.ts",
    "lib/concepts/topic-signal/signals-format.ts",
    "lib/concepts/topic-signal/snapshot.ts",
    "lib/concepts/topic-signal/diagnostic.ts",
  ];
  for (const file of files) {
    const source = readFileSync(resolve(process.cwd(), file), "utf8");
    assert.doesNotMatch(source, /getAiProvider/);
    assert.doesNotMatch(source, /from "openai"/);
  }
  const snapshotSource = readFileSync(
    resolve(process.cwd(), "lib/concepts/topic-signal/snapshot.ts"),
    "utf8",
  );
  assert.doesNotMatch(snapshotSource, /from "\.\/signals"/);
  const diagnosticSource = readFileSync(
    resolve(process.cwd(), "lib/concepts/topic-signal/diagnostic.ts"),
    "utf8",
  );
  assert.doesNotMatch(diagnosticSource, /from "\.\/signals"/);
  const signalsSource = readFileSync(
    resolve(process.cwd(), "lib/concepts/topic-signal/signals.ts"),
    "utf8",
  );
  assert.doesNotMatch(signalsSource, /from "\.\/diagnostic"/);
  assert.doesNotMatch(signalsSource, /from "@\/lib\/observations/);
});

test("Q. zero DB mutation", () => {
  const db = openMemoryDb();
  seedSession(db, "s1");
  seedSession(db, "s2");
  assert.equal(
    insertConcept(
      {
        id: "c1",
        canonicalLabel: "人間関係",
        createdAt: "2026-08-18T00:00:00.000Z",
      },
      db,
    ).status,
    "inserted",
  );
  assert.equal(
    insertConceptOccurrence(
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
    ).status,
    "inserted",
  );
  assert.equal(
    insertConceptOccurrence(
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
    ).status,
    "inserted",
  );
  const before = {
    concepts: countConcepts(db),
    aliases: countConceptAliases(db),
    occurrences: countConceptOccurrences(db),
  };
  const result = loadTopicSignals({ db });
  assert.equal(result.recentlyObserved.length, 1);
  assert.equal(result.crossSessionRecurrence.length, 1);
  const after = {
    concepts: countConcepts(db),
    aliases: countConceptAliases(db),
    occurrences: countConceptOccurrences(db),
  };
  assert.deepEqual(after, before);
});
