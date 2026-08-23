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
import {
  addCalendarDays,
  calendarDateFromOccurredAt,
  topicSignalWindowDates,
} from "./calendar";
import { loadTopicSignalSnapshot } from "./load";
import {
  buildTopicSignalPreviewReport,
  formatTopicSignalPreviewReport,
} from "./preview";
import {
  TOPIC_SIGNAL_SNAPSHOT_VERSION,
  buildTopicSignalSnapshot,
  type TopicSignalConceptInput,
  type TopicSignalOccurrenceInput,
} from "./snapshot";

const USER =
  "これまでの人間関係でなぜ上手くいかないのか理解できないと思った。";
const SURFACE = "人間関係";
const ASOF = "2026-07-20T18:00:00.000Z";

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

function snapshot(
  concepts: TopicSignalConceptInput[],
  occurrences: TopicSignalOccurrenceInput[],
) {
  return buildTopicSignalSnapshot({ concepts, occurrences });
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
  occurredAt: string,
  content = USER,
) {
  db.insert(schema.sessions)
    .values({
      id,
      title: id,
      occurredAt,
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

function seedConcept(
  db: ReturnType<typeof openMemoryDb>,
  id: string,
  canonicalLabel: string,
  createdAt = "2099-01-01T00:00:00.000Z",
) {
  const inserted = insertConcept({ id, canonicalLabel, createdAt }, db);
  assert.equal(inserted.status, "inserted");
}

function seedOccurrence(
  db: ReturnType<typeof openMemoryDb>,
  input: {
    id: string;
    conceptId: string;
    sessionId: string;
    occurredAt: string;
    evidenceRef?: string;
  },
) {
  const inserted = insertConceptOccurrence(
    {
      id: input.id,
      conceptId: input.conceptId,
      sessionId: input.sessionId,
      messageId: `${input.sessionId}-u`,
      evidenceRef: input.evidenceRef ?? "M001:E01",
      occurredAt: input.occurredAt,
      sourceRole: "user",
      sourceType: "evidence_unit",
      extractionVersion: CONCEPT_EXTRACTION_VERSION,
    },
    db,
  );
  assert.equal(inserted.status, "inserted");
}

test("calendar prefix convention matches YYYY-MM-DD from occurredAt", () => {
  assert.equal(calendarDateFromOccurredAt("2026-07-20T18:00:00.000Z"), "2026-07-20");
  assert.equal(calendarDateFromOccurredAt("2026-07-20"), "2026-07-20");
  assert.equal(addCalendarDays("2026-07-20", -6), "2026-07-14");
  assert.equal(addCalendarDays("2026-07-20", -7), "2026-07-13");
  assert.equal(addCalendarDays("2026-07-20", -13), "2026-07-07");
  const windows = topicSignalWindowDates("2026-07-20");
  assert.deepEqual(windows, {
    recentStart: "2026-07-14",
    recentEnd: "2026-07-20",
    previousStart: "2026-07-07",
    previousEnd: "2026-07-13",
  });
});

test("A. empty Registry", () => {
  const result = snapshot([], []);
  assert.equal(result.version, TOPIC_SIGNAL_SNAPSHOT_VERSION);
  assert.equal(result.asOf, null);
  assert.deepEqual(result.concepts, []);
  assert.equal(result.diagnostics.conceptsWithoutOccurrences, 0);
});

test("B. Concept exists / Occurrence 0 → excluded", () => {
  const result = snapshot([concept("c-empty", "距離感")], []);
  assert.equal(result.asOf, null);
  assert.deepEqual(result.concepts, []);
  assert.equal(result.diagnostics.conceptsWithoutOccurrences, 1);
});

test("C. single Concept / single Occurrence", () => {
  const result = snapshot(
    [concept("c1", "人間関係")],
    [occ("c1", "s1", "2026-07-15T12:00:00.000Z")],
  );
  assert.equal(result.concepts.length, 1);
  const row = result.concepts[0]!;
  assert.equal(row.totalOccurrenceCount, 1);
  assert.equal(row.distinctSessionCount, 1);
  assert.equal(row.activeDayCount, 1);
  assert.equal(row.firstSeenAt, row.lastSeenAt);
  assert.equal(row.firstSeenAt, "2026-07-15T12:00:00.000Z");
  assert.equal(result.asOf, "2026-07-15T12:00:00.000Z");
});

test("D. multiple Occurrences same Session", () => {
  const result = snapshot(
    [concept("c1", "人間関係")],
    [
      occ("c1", "s1", "2026-07-15T10:00:00.000Z"),
      occ("c1", "s1", "2026-07-15T11:00:00.000Z"),
      occ("c1", "s1", "2026-07-16T09:00:00.000Z"),
    ],
  );
  const row = result.concepts[0]!;
  assert.equal(row.totalOccurrenceCount, 3);
  assert.equal(row.distinctSessionCount, 1);
  assert.equal(row.totalOccurrenceCount > row.distinctSessionCount, true);
});

test("E. multiple Sessions same day", () => {
  const result = snapshot(
    [concept("c1", "人間関係")],
    [
      occ("c1", "s1", "2026-07-15T10:00:00.000Z"),
      occ("c1", "s2", "2026-07-15T18:00:00.000Z"),
    ],
  );
  const day = result.concepts[0]!.daily[0]!;
  assert.equal(day.date, "2026-07-15");
  assert.equal(day.occurrenceCount, 2);
  assert.equal(day.distinctSessionCount, 2);
});

test("F. multiple Occurrences same Session same day", () => {
  const result = snapshot(
    [concept("c1", "人間関係")],
    [
      occ("c1", "s1", "2026-07-15T10:00:00.000Z"),
      occ("c1", "s1", "2026-07-15T11:00:00.000Z"),
    ],
  );
  const day = result.concepts[0]!.daily[0]!;
  assert.equal(day.occurrenceCount, 2);
  assert.equal(day.distinctSessionCount, 1);
});

test("G. multiple days", () => {
  const result = snapshot(
    [concept("c1", "人間関係")],
    [
      occ("c1", "s1", "2026-07-13T10:00:00.000Z"),
      occ("c1", "s2", "2026-07-15T10:00:00.000Z"),
      occ("c1", "s3", "2026-07-20T10:00:00.000Z"),
    ],
  );
  const row = result.concepts[0]!;
  assert.equal(row.activeDayCount, 3);
  assert.deepEqual(
    row.daily.map((day) => day.date),
    ["2026-07-13", "2026-07-15", "2026-07-20"],
  );
  assert.equal(row.firstSeenAt, "2026-07-13T10:00:00.000Z");
  assert.equal(row.lastSeenAt, "2026-07-20T10:00:00.000Z");
});

test("H. multiple Concepts aggregate independently", () => {
  const result = snapshot(
    [concept("c1", "人間関係"), concept("c2", "距離感")],
    [
      occ("c1", "s1", "2026-07-15T10:00:00.000Z"),
      occ("c1", "s1", "2026-07-16T10:00:00.000Z"),
      occ("c2", "s2", "2026-07-20T10:00:00.000Z"),
    ],
  );
  const byId = Object.fromEntries(result.concepts.map((row) => [row.conceptId, row]));
  assert.equal(byId.c1?.totalOccurrenceCount, 2);
  assert.equal(byId.c1?.distinctSessionCount, 1);
  assert.equal(byId.c2?.totalOccurrenceCount, 1);
  assert.equal(byId.c2?.lastSeenAt, "2026-07-20T10:00:00.000Z");
});

test("I. same Evidence multi Concept does not collapse", () => {
  const result = snapshot(
    [concept("c1", "人間関係"), concept("c2", "距離感")],
    [
      occ("c1", "s1", "2026-07-15T10:00:00.000Z"),
      occ("c2", "s1", "2026-07-15T10:00:00.000Z"),
    ],
  );
  assert.equal(result.concepts.length, 2);
  assert.equal(result.diagnostics.totalOccurrenceCount, 2);
  for (const row of result.concepts) {
    assert.equal(row.totalOccurrenceCount, 1);
  }
});

test("J. recent7d includes asOf date and 6 days before", () => {
  const result = snapshot(
    [concept("c1", "人間関係")],
    [
      occ("c1", "s-asof", ASOF),
      occ("c1", "s-start", "2026-07-14T00:00:00.000Z"),
      occ("c1", "s-before", "2026-07-13T23:59:59.000Z"),
    ],
  );
  assert.equal(result.asOf, ASOF);
  const row = result.concepts[0]!;
  assert.equal(row.recent7d.occurrenceCount, 2);
  assert.equal(row.recent7d.distinctSessionCount, 2);
  assert.equal(row.recent7d.activeDayCount, 2);
});

test("K. previous7d is the 7 days immediately before recent, no overlap", () => {
  const result = snapshot(
    [concept("c1", "人間関係")],
    [
      occ("c1", "s-asof", ASOF),
      occ("c1", "s-recent-start", "2026-07-14T12:00:00.000Z"),
      occ("c1", "s-prev-end", "2026-07-13T12:00:00.000Z"),
      occ("c1", "s-prev-start", "2026-07-07T12:00:00.000Z"),
      occ("c1", "s-before-prev", "2026-07-06T12:00:00.000Z"),
    ],
  );
  const row = result.concepts[0]!;
  assert.equal(row.recent7d.occurrenceCount, 2);
  assert.equal(row.previous7d.occurrenceCount, 2);
  assert.equal(row.previous7d.activeDayCount, 2);
  assert.equal(row.totalOccurrenceCount, 5);
});

test("L. occurrence outside 14 days stays in totals only", () => {
  const result = snapshot(
    [concept("c1", "人間関係")],
    [
      occ("c1", "s-asof", ASOF),
      occ("c1", "s-old", "2026-07-06T12:00:00.000Z"),
    ],
  );
  const row = result.concepts[0]!;
  assert.equal(row.totalOccurrenceCount, 2);
  assert.equal(row.recent7d.occurrenceCount, 1);
  assert.equal(row.previous7d.occurrenceCount, 0);
  assert.equal(row.activeDayCount, 2);
});

test("M. deterministic asOf from max occurredAt, independent of input order", () => {
  const concepts = [concept("c1", "人間関係")];
  const a = occ("c1", "s1", "2026-07-10T00:00:00.000Z");
  const b = occ("c1", "s2", ASOF);
  const c = occ("c1", "s3", "2026-07-18T00:00:00.000Z");
  const first = snapshot(concepts, [a, b, c]);
  const second = snapshot(concepts, [c, a, b]);
  assert.equal(first.asOf, ASOF);
  assert.equal(second.asOf, ASOF);
  assert.deepEqual(first, second);
});

test("N. deterministic Concept ordering lastSeenAt DESC, conceptId ASC", () => {
  const concepts = [
    concept("c-b", "距離感"),
    concept("c-a", "人間関係"),
    concept("c-c", "返信"),
  ];
  const occurrences = [
    occ("c-c", "s1", "2026-07-10T00:00:00.000Z"),
    occ("c-a", "s2", "2026-07-20T00:00:00.000Z"),
    occ("c-b", "s3", "2026-07-20T00:00:00.000Z"),
  ];
  const first = snapshot(concepts, occurrences);
  const second = snapshot([...concepts].reverse(), [...occurrences].reverse());
  assert.deepEqual(
    first.concepts.map((row) => row.conceptId),
    ["c-a", "c-b", "c-c"],
  );
  assert.deepEqual(
    second.concepts.map((row) => row.conceptId),
    first.concepts.map((row) => row.conceptId),
  );
});

test("O. deterministic daily ordering date ASC", () => {
  const result = snapshot(
    [concept("c1", "人間関係")],
    [
      occ("c1", "s3", "2026-07-20T00:00:00.000Z"),
      occ("c1", "s1", "2026-07-10T00:00:00.000Z"),
      occ("c1", "s2", "2026-07-15T00:00:00.000Z"),
    ],
  );
  assert.deepEqual(
    result.concepts[0]!.daily.map((day) => day.date),
    ["2026-07-10", "2026-07-15", "2026-07-20"],
  );
});

test("P. Concept.createdAt is not used for firstSeenAt / lastSeenAt", () => {
  const db = openMemoryDb();
  seedSession(db, "s1", "2026-01-01");
  seedConcept(db, "c1", "人間関係", "2099-12-31T00:00:00.000Z");
  seedOccurrence(db, {
    id: "o1",
    conceptId: "c1",
    sessionId: "s1",
    occurredAt: "2026-07-15T12:00:00.000Z",
  });
  const result = loadTopicSignalSnapshot({ db });
  const row = result.concepts[0]!;
  assert.equal(row.firstSeenAt, "2026-07-15T12:00:00.000Z");
  assert.equal(row.lastSeenAt, "2026-07-15T12:00:00.000Z");
  assert.notEqual(row.firstSeenAt, "2099-12-31T00:00:00.000Z");
});

test("Q. Session.occurredAt is not used", () => {
  const db = openMemoryDb();
  seedSession(db, "s1", "1999-01-01");
  seedConcept(db, "c1", "人間関係");
  seedOccurrence(db, {
    id: "o1",
    conceptId: "c1",
    sessionId: "s1",
    occurredAt: "2026-07-15T12:00:00.000Z",
  });
  const result = loadTopicSignalSnapshot({ db });
  assert.equal(result.asOf, "2026-07-15T12:00:00.000Z");
  assert.equal(result.concepts[0]?.firstSeenAt, "2026-07-15T12:00:00.000Z");
  assert.equal(result.concepts[0]?.daily[0]?.date, "2026-07-15");
});

test("R. Observation rows do not change Snapshot", () => {
  const db = openMemoryDb();
  seedSession(db, "s1", "1999-01-01");
  seedConcept(db, "c1", "人間関係");
  seedOccurrence(db, {
    id: "o1",
    conceptId: "c1",
    sessionId: "s1",
    occurredAt: "2026-07-15T12:00:00.000Z",
  });
  const before = loadTopicSignalSnapshot({ db });
  db.insert(schema.reviews)
    .values({
      id: "rev-obs",
      title: "review",
      model: "test",
      promptVersion: "integrated-review-v5",
      payload: "{}",
      createdAt: "2026-08-18T00:00:00.000Z",
    })
    .run();
  db.insert(schema.observations)
    .values({
      id: "obs-1",
      kind: "shift",
      projectionVersion: "review-observation-v1",
      sourceReviewId: "rev-obs",
      sourceRef: "R:SHIFT:01",
      title: SURFACE,
      body: USER,
      supportType: "direct",
      payload: JSON.stringify({ text: USER, surfaceForm: SURFACE }),
      firstSeenAt: "2026-07-01",
      lastSeenAt: "2026-07-20",
      detectedAt: "2026-08-18T00:00:00.000Z",
      distinctSessionCount: 9,
      createdAt: "2026-08-18T00:00:00.000Z",
    })
    .run();
  const after = loadTopicSignalSnapshot({ db });
  assert.deepEqual(after, before);
});

test("S. provisional Candidate not in Registry is excluded", () => {
  const result = snapshot(
    [concept("c1", "人間関係")],
    [
      occ("c1", "s1", "2026-07-15T10:00:00.000Z"),
      occ("provisional-candidate", "s2", "2026-07-20T10:00:00.000Z"),
    ],
  );
  assert.equal(result.concepts.length, 1);
  assert.equal(result.concepts[0]?.conceptId, "c1");
  assert.equal(result.diagnostics.totalOccurrenceCount, 1);
  assert.equal(result.asOf, "2026-07-15T10:00:00.000Z");
});

test("T. serialized Snapshot has no USER / evidence / surfaceForm", () => {
  const result = snapshot(
    [concept("c1", SURFACE)],
    [occ("c1", "s1", "2026-07-15T12:00:00.000Z")],
  );
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(USER), false);
  assert.equal(serialized.includes("surfaceForm"), false);
  assert.equal(serialized.includes("evidenceRef"), false);
  assert.equal(serialized.includes("messageId"), false);
  const report = formatTopicSignalPreviewReport(
    buildTopicSignalPreviewReport(result),
  );
  assert.equal(report.includes(USER), false);
  assert.equal(report.includes("surfaceForm"), false);
});

test("U. no LLM / Observation / score / classification dependency", () => {
  const files = [
    "lib/concepts/topic-signal/snapshot.ts",
    "lib/concepts/topic-signal/load.ts",
    "lib/concepts/topic-signal/calendar.ts",
    "lib/concepts/topic-signal/preview.ts",
  ];
  for (const file of files) {
    const source = readFileSync(resolve(process.cwd(), file), "utf8");
    assert.doesNotMatch(source, /getDb\(/);
    assert.doesNotMatch(source, /openai/);
    assert.doesNotMatch(source, /getAiProvider/);
    assert.doesNotMatch(source, /from "openai"/);
    assert.doesNotMatch(source, /from "@\/lib\/observations/);
    assert.doesNotMatch(source, /observation_concepts/);
    assert.doesNotMatch(source, /signalScore/);
    assert.doesNotMatch(source, /importanceScore/);
    assert.doesNotMatch(source, /trendScore/);
    assert.doesNotMatch(source, /momentumScore/);
    assert.doesNotMatch(source, /heatScore/);
    assert.doesNotMatch(source, /"rising"/);
    assert.doesNotMatch(source, /"falling"/);
    assert.doesNotMatch(source, /"emerging"/);
    assert.doesNotMatch(source, /"recurring"/);
    assert.doesNotMatch(source, /"dormant"/);
    assert.doesNotMatch(source, /named_or_high/);
    assert.doesNotMatch(source, /evaluatePolicyCalibration/);
  }
});

test("V. zero DB mutation", () => {
  const db = openMemoryDb();
  seedSession(db, "s1", "1999-01-01");
  seedSession(db, "s2", "1999-01-02");
  seedConcept(db, "c1", "人間関係");
  seedConcept(db, "c-empty", "距離感");
  seedOccurrence(db, {
    id: "o1",
    conceptId: "c1",
    sessionId: "s1",
    occurredAt: "2026-07-15T12:00:00.000Z",
  });
  seedOccurrence(db, {
    id: "o2",
    conceptId: "c1",
    sessionId: "s1",
    occurredAt: "2026-07-15T13:00:00.000Z",
    evidenceRef: "M001:E02",
  });
  const before = {
    concepts: countConcepts(db),
    aliases: countConceptAliases(db),
    occurrences: countConceptOccurrences(db),
    sessions: db.select().from(schema.sessions).all().length,
    messages: db.select().from(schema.messages).all().length,
  };
  const result = loadTopicSignalSnapshot({ db });
  assert.equal(result.concepts.length, 1);
  assert.equal(result.diagnostics.conceptsWithoutOccurrences, 1);
  assert.equal(result.concepts[0]?.totalOccurrenceCount, 2);
  assert.equal(result.concepts[0]?.distinctSessionCount, 1);
  const after = {
    concepts: countConcepts(db),
    aliases: countConceptAliases(db),
    occurrences: countConceptOccurrences(db),
    sessions: db.select().from(schema.sessions).all().length,
    messages: db.select().from(schema.messages).all().length,
  };
  assert.deepEqual(after, before);
});

test("normalizedKey merge しない: conceptId 単位で独立", () => {
  const result = snapshot(
    [concept("id-a", "人間関係"), concept("id-b", "人間関係")],
    [
      occ("id-a", "s1", "2026-07-15T10:00:00.000Z"),
      occ("id-b", "s2", "2026-07-16T10:00:00.000Z"),
    ],
  );
  assert.equal(result.concepts.length, 2);
  assert.equal(result.concepts[0]?.totalOccurrenceCount, 1);
  assert.equal(result.concepts[1]?.totalOccurrenceCount, 1);
});

test("loader empty Registry", () => {
  const db = openMemoryDb();
  const result = loadTopicSignalSnapshot({ db });
  assert.equal(result.asOf, null);
  assert.deepEqual(result.concepts, []);
});

test("same EvidenceRef でも conceptId が違えば両方計上 (loader)", () => {
  const db = openMemoryDb();
  seedSession(db, "s1", "1999-01-01");
  seedConcept(db, "c1", "人間関係");
  seedConcept(db, "c2", "距離感");
  seedOccurrence(db, {
    id: "o1",
    conceptId: "c1",
    sessionId: "s1",
    occurredAt: "2026-07-15T12:00:00.000Z",
    evidenceRef: "M001:E01",
  });
  seedOccurrence(db, {
    id: "o2",
    conceptId: "c2",
    sessionId: "s1",
    occurredAt: "2026-07-15T12:00:00.000Z",
    evidenceRef: "M001:E01",
  });
  const result = loadTopicSignalSnapshot({ db });
  assert.equal(result.diagnostics.totalOccurrenceCount, 2);
  assert.equal(result.diagnostics.totalDistinctSessionCount, 1);
  assert.equal(result.concepts.length, 2);
});
