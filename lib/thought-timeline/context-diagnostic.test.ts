import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { applySqlMigrations } from "@/lib/db/client";
import {
  countConceptOccurrences,
  countConcepts,
  insertConcept,
  insertConceptOccurrence,
} from "@/lib/db/concept-queries";
import { countObservations } from "@/lib/db/observation-queries";
import * as schema from "@/lib/db/schema";
import { CONCEPT_EXTRACTION_VERSION } from "@/lib/concepts/types";
import { buildTopicSignalSnapshot } from "@/lib/concepts/topic-signal/snapshot";
import { REVIEW_OBSERVATION_VERSION } from "@/lib/observations/types";
import {
  buildThoughtTimelineContextDiagnostic,
  formatThoughtTimelineContextDiagnostic,
  THOUGHT_TIMELINE_CONTEXT_DIAGNOSTIC_VERSION,
} from "./context-diagnostic";
import { loadThoughtTimelineContextAudit } from "./context-load";
import { buildThoughtTimeline } from "./timeline";
import {
  THOUGHT_TIMELINE_VERSION,
  type ThoughtTimeline,
  type ThoughtTimelineSourceObservation,
} from "./types";

const USER =
  "これまでの人間関係でなぜ上手くいかないのか理解できないと思った。";

function shiftPayload(text: string) {
  return JSON.stringify({
    text,
    evidence: [],
    semanticValid: true,
    before: "以前",
    after: "いま",
    interpretation: text,
    beforeEvidence: [],
    afterEvidence: [],
  });
}

function connectionPayload(text: string) {
  return JSON.stringify({
    text,
    evidence: [],
    semanticValid: true,
  });
}

function observation(
  overrides: Partial<ThoughtTimelineSourceObservation> &
    Pick<ThoughtTimelineSourceObservation, "id" | "kind">,
): ThoughtTimelineSourceObservation {
  const body = overrides.body ?? overrides.title ?? overrides.id;
  return {
    title: overrides.title ?? body,
    body,
    payload:
      overrides.kind === "shift"
        ? shiftPayload(body)
        : connectionPayload(body),
    firstSeenAt: "2026-08-02",
    lastSeenAt: "2026-08-02",
    detectedAt: "2099-01-01T00:00:00.000Z",
    createdAt: "2099-01-01T00:00:00.000Z",
    sessionIds: ["session-a"],
    relatedConcepts: [],
    ...overrides,
  };
}

function timelineFrom(
  observations: ThoughtTimelineSourceObservation[],
): ThoughtTimeline {
  return buildThoughtTimeline({ observations });
}

function snapshotFrom(
  concepts: Array<{ conceptId: string; canonicalLabel: string }>,
  occurrences: Array<{
    conceptId: string;
    sessionId: string;
    occurredAt: string;
  }>,
) {
  return buildTopicSignalSnapshot({ concepts, occurrences });
}

function diagnostic(input: {
  timeline?: ThoughtTimeline;
  concepts?: Array<{ conceptId: string; canonicalLabel: string }>;
  occurrences?: Array<{
    conceptId: string;
    sessionId: string;
    occurredAt: string;
  }>;
}) {
  const occurrences = input.occurrences ?? [];
  const concepts = input.concepts ?? [];
  return buildThoughtTimelineContextDiagnostic({
    timeline: input.timeline ?? timelineFrom([]),
    snapshot: snapshotFrom(concepts, occurrences),
    occurrences,
  });
}

function openMemoryDb() {
  const sqlite = new Database(":memory:");
  applySqlMigrations(sqlite);
  sqlite.pragma("foreign_keys = ON");
  return drizzle(sqlite, { schema });
}

test("A. empty both", () => {
  const result = diagnostic({});
  assert.equal(result.version, THOUGHT_TIMELINE_CONTEXT_DIAGNOSTIC_VERSION);
  assert.deepEqual(result.range, {
    firstOccurredAt: null,
    lastOccurredAt: null,
  });
  assert.deepEqual(result.coverage, {
    observationDateCount: 0,
    conceptOccurrenceDateCount: 0,
    unionDateCount: 0,
    datesWithObservationOnly: 0,
    datesWithConceptOnly: 0,
    datesWithBoth: 0,
  });
  assert.deepEqual(result.dates, []);
  assert.equal(result.conceptDensityPerDate.average, null);
});

test("B. Observation only date", () => {
  const result = diagnostic({
    timeline: timelineFrom([
      observation({ id: "obs-1", kind: "tension", lastSeenAt: "2026-08-02" }),
    ]),
  });
  assert.equal(result.coverage.datesWithObservationOnly, 1);
  assert.equal(result.coverage.datesWithConceptOnly, 0);
  assert.equal(result.coverage.datesWithBoth, 0);
  assert.equal(result.dates[0]?.presence, "observation_only");
  assert.equal(result.dates[0]?.observationCount, 1);
  assert.equal(result.dates[0]?.observationTypes.tension, 1);
  assert.equal(result.dates[0]?.conceptOccurrenceCount, 0);
  assert.deepEqual(result.dates[0]?.concepts, []);
});

test("C. Concept only date", () => {
  const result = diagnostic({
    concepts: [{ conceptId: "c-1", canonicalLabel: "ThemeA" }],
    occurrences: [
      { conceptId: "c-1", sessionId: "s-1", occurredAt: "2026-07-15" },
    ],
  });
  assert.equal(result.coverage.datesWithObservationOnly, 0);
  assert.equal(result.coverage.datesWithConceptOnly, 1);
  assert.equal(result.dates[0]?.presence, "concept_only");
  assert.equal(result.dates[0]?.observationCount, 0);
  assert.equal(result.dates[0]?.distinctConceptCount, 1);
  assert.equal(result.dates[0]?.concepts[0]?.canonicalLabel, "ThemeA");
});

test("D. both same date", () => {
  const result = diagnostic({
    timeline: timelineFrom([
      observation({
        id: "obs-1",
        kind: "connection",
        lastSeenAt: "2026-08-02",
      }),
    ]),
    concepts: [{ conceptId: "c-1", canonicalLabel: "ThemeA" }],
    occurrences: [
      { conceptId: "c-1", sessionId: "s-1", occurredAt: "2026-08-02" },
    ],
  });
  assert.equal(result.coverage.datesWithBoth, 1);
  assert.equal(result.dates[0]?.presence, "both");
  assert.equal(result.dates[0]?.observationCount, 1);
  assert.equal(result.dates[0]?.distinctConceptCount, 1);
});

test("E. multiple Concepts same date", () => {
  const result = diagnostic({
    concepts: [
      { conceptId: "c-1", canonicalLabel: "ThemeA" },
      { conceptId: "c-2", canonicalLabel: "ThemeB" },
    ],
    occurrences: [
      { conceptId: "c-1", sessionId: "s-1", occurredAt: "2026-07-15" },
      { conceptId: "c-2", sessionId: "s-1", occurredAt: "2026-07-15" },
    ],
  });
  assert.equal(result.dates[0]?.distinctConceptCount, 2);
  assert.equal(result.dates[0]?.conceptOccurrenceCount, 2);
});

test("F. same Concept multiple occurrence same date", () => {
  const result = diagnostic({
    concepts: [{ conceptId: "c-1", canonicalLabel: "ThemeA" }],
    occurrences: [
      { conceptId: "c-1", sessionId: "s-1", occurredAt: "2026-07-15T10:00:00.000Z" },
      { conceptId: "c-1", sessionId: "s-2", occurredAt: "2026-07-15T18:00:00.000Z" },
    ],
  });
  assert.equal(result.dates[0]?.conceptOccurrenceCount, 2);
  assert.equal(result.dates[0]?.distinctConceptCount, 1);
  assert.equal(result.dates[0]?.concepts[0]?.occurrenceCount, 2);
});

test("G. multiple Sessions same date", () => {
  const result = diagnostic({
    concepts: [
      { conceptId: "c-1", canonicalLabel: "ThemeA" },
      { conceptId: "c-2", canonicalLabel: "ThemeB" },
    ],
    occurrences: [
      { conceptId: "c-1", sessionId: "s-1", occurredAt: "2026-07-15" },
      { conceptId: "c-2", sessionId: "s-2", occurredAt: "2026-07-15" },
    ],
  });
  assert.equal(result.dates[0]?.distinctSessionCount, 2);
});

test("H. union date range uses MIN/MAX thought and occurrence times", () => {
  const result = diagnostic({
    timeline: timelineFrom([
      observation({ id: "obs-1", kind: "shift", lastSeenAt: "2026-08-02" }),
    ]),
    concepts: [{ conceptId: "c-1", canonicalLabel: "ThemeA" }],
    occurrences: [
      { conceptId: "c-1", sessionId: "s-1", occurredAt: "2026-07-12T22:00:00.000Z" },
    ],
  });
  assert.equal(result.range.firstOccurredAt, "2026-07-12T22:00:00.000Z");
  assert.equal(result.range.lastOccurredAt, "2026-08-02");
  assert.equal(result.coverage.unionDateCount, 2);
  assert.equal(result.coverage.observationDateCount, 1);
  assert.equal(result.coverage.conceptOccurrenceDateCount, 1);
});

test("I. dates are newest first", () => {
  const result = diagnostic({
    concepts: [{ conceptId: "c-1", canonicalLabel: "ThemeA" }],
    occurrences: [
      { conceptId: "c-1", sessionId: "s-1", occurredAt: "2026-07-12" },
      { conceptId: "c-1", sessionId: "s-1", occurredAt: "2026-08-02" },
      { conceptId: "c-1", sessionId: "s-1", occurredAt: "2026-07-15" },
    ],
  });
  assert.deepEqual(
    result.dates.map((row) => row.date),
    ["2026-08-02", "2026-07-15", "2026-07-12"],
  );
});

test("J. Concept ordering is deterministic", () => {
  const concepts = [
    { conceptId: "c-b", canonicalLabel: "Beta" },
    { conceptId: "c-a", canonicalLabel: "Alpha" },
    { conceptId: "c-c", canonicalLabel: "Alpha" },
  ];
  const occurrences = [
    { conceptId: "c-b", sessionId: "s-1", occurredAt: "2026-07-15" },
    { conceptId: "c-a", sessionId: "s-1", occurredAt: "2026-07-15" },
    { conceptId: "c-a", sessionId: "s-1", occurredAt: "2026-07-15T12:00:00.000Z" },
    { conceptId: "c-c", sessionId: "s-1", occurredAt: "2026-07-15" },
  ];
  const left = diagnostic({ concepts, occurrences });
  const right = diagnostic({
    concepts: [...concepts].reverse(),
    occurrences: [...occurrences].reverse(),
  });
  assert.deepEqual(left.dates[0]?.concepts, right.dates[0]?.concepts);
  assert.deepEqual(
    left.dates[0]?.concepts.map((row) => row.conceptId),
    ["c-a", "c-c", "c-b"],
  );
});

test("K. same date does not infer Observation↔Concept relation", () => {
  const result = diagnostic({
    timeline: timelineFrom([
      observation({
        id: "obs-1",
        kind: "connection",
        title: "ThemeA の接続",
        body: "ThemeA の接続",
        lastSeenAt: "2026-08-02",
      }),
    ]),
    concepts: [{ conceptId: "c-1", canonicalLabel: "ThemeA" }],
    occurrences: [
      { conceptId: "c-1", sessionId: "s-1", occurredAt: "2026-08-02" },
    ],
  });
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("related"), false);
  assert.equal(serialized.includes("relatedConcept"), false);
  assert.equal("relatedConcepts" in (result.dates[0] ?? {}), false);
});

test("L. Production ThoughtTimeline items stay Observation-only", () => {
  const timeline = timelineFrom([
    observation({ id: "obs-1", kind: "connection", lastSeenAt: "2026-08-02" }),
  ]);
  const before = structuredClone(timeline);
  const result = diagnostic({
    timeline,
    concepts: [{ conceptId: "c-1", canonicalLabel: "ThemeA" }],
    occurrences: [
      { conceptId: "c-1", sessionId: "s-1", occurredAt: "2026-07-15" },
      { conceptId: "c-1", sessionId: "s-1", occurredAt: "2026-08-02" },
    ],
  });
  assert.deepEqual(timeline, before);
  assert.equal(timeline.version, THOUGHT_TIMELINE_VERSION);
  assert.equal(timeline.groups.length, 1);
  assert.equal(timeline.groups[0]?.items.length, 1);
  assert.equal(timeline.groups[0]?.items[0]?.kind, "observation");
  assert.equal(result.coverage.unionDateCount, 2);
  assert.equal(
    JSON.stringify(timeline).includes('"kind":"concept_occurrence"'),
    false,
  );
});

test("M. Topic Signal classification is not used", () => {
  const files = [
    "lib/thought-timeline/context-diagnostic.ts",
    "lib/thought-timeline/context-load.ts",
  ];
  for (const file of files) {
    const sourceText = readFileSync(resolve(process.cwd(), file), "utf8");
    assert.doesNotMatch(sourceText, /recently_observed/);
    assert.doesNotMatch(sourceText, /cross_session_recurrence/);
    assert.doesNotMatch(sourceText, /buildTopicSignals/);
    assert.doesNotMatch(sourceText, /from "\.\/signals"/);
  }
});

test("N. USER本文なし", () => {
  const result = diagnostic({
    timeline: timelineFrom([
      observation({
        id: "obs-1",
        kind: "connection",
        title: USER,
        body: USER,
        lastSeenAt: "2026-08-02",
      }),
    ]),
    concepts: [{ conceptId: "c-1", canonicalLabel: "ThemeA" }],
    occurrences: [
      { conceptId: "c-1", sessionId: "s-1", occurredAt: "2026-08-02" },
    ],
  });
  const serialized = `${JSON.stringify(result)}\n${formatThoughtTimelineContextDiagnostic(result)}`;
  assert.equal(serialized.includes(USER), false);
  assert.equal(serialized.includes("surfaceForm"), false);
  assert.equal(serialized.includes("quote"), false);
});

test("O. LLM 0", () => {
  const files = [
    "lib/thought-timeline/context-diagnostic.ts",
    "lib/thought-timeline/context-load.ts",
  ];
  for (const file of files) {
    const sourceText = readFileSync(resolve(process.cwd(), file), "utf8");
    assert.doesNotMatch(sourceText, /from "openai"/);
    assert.doesNotMatch(sourceText, /importance/);
    assert.doesNotMatch(sourceText, /dominant topic/);
    assert.doesNotMatch(sourceText, /context score/);
  }
});

test("P. loader is SELECT-only and does not mutate the DB", () => {
  const db = openMemoryDb();
  db.insert(schema.reviews)
    .values({
      id: "review-1",
      title: "r",
      model: "test",
      promptVersion: "integrated-review-v5",
      payload: "{}",
      createdAt: "2026-08-18T00:00:00.000Z",
    })
    .run();
  db.insert(schema.sessions)
    .values({
      id: "session-a",
      title: "session-a",
      occurredAt: "2026-08-02",
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
  db.insert(schema.observations)
    .values({
      id: "obs-1",
      kind: "connection",
      projectionVersion: REVIEW_OBSERVATION_VERSION,
      sourceReviewId: "review-1",
      sourceRef: "obs-1",
      title: "接続",
      body: "接続",
      supportType: null,
      payload: connectionPayload("接続"),
      firstSeenAt: "2026-08-02",
      lastSeenAt: "2026-08-02",
      detectedAt: "2026-08-18T00:00:00.000Z",
      distinctSessionCount: 1,
      createdAt: "2026-08-18T00:00:00.000Z",
    })
    .run();
  db.insert(schema.observationSessions)
    .values({ observationId: "obs-1", sessionId: "session-a" })
    .run();
  const concept = insertConcept(
    {
      id: "c-1",
      canonicalLabel: "ThemeA",
      createdAt: "2026-07-01T00:00:00.000Z",
    },
    db,
  );
  assert.equal(concept.status, "inserted");
  db.insert(schema.messages)
    .values({
      id: "session-a-u",
      sessionId: "session-a",
      index: 0,
      role: "user",
      content: "x",
      charStart: 0,
      charEnd: 1,
      sourceMessageId: null,
      sourceCreatedAt: null,
      contentType: "text",
      attachmentsJson: null,
    })
    .run();
  const occurrence = insertConceptOccurrence(
    {
      id: "occ-1",
      conceptId: "c-1",
      sessionId: "session-a",
      messageId: "session-a-u",
      evidenceRef: "M001:E01",
      occurredAt: "2026-07-15",
      sourceRole: "user",
      sourceType: "evidence_unit",
      extractionVersion: CONCEPT_EXTRACTION_VERSION,
    },
    db,
  );
  assert.equal(occurrence.status, "inserted");
  const before = {
    observations: countObservations(db),
    concepts: countConcepts(db),
    occurrences: countConceptOccurrences(db),
  };
  const audit = loadThoughtTimelineContextAudit({ db });
  const after = {
    observations: countObservations(db),
    concepts: countConcepts(db),
    occurrences: countConceptOccurrences(db),
  };
  assert.deepEqual(after, before);
  assert.equal(audit.timeline.groups[0]?.items.length, 1);
  assert.equal(audit.timeline.groups[0]?.items[0]?.kind, "observation");
  assert.equal(audit.diagnostic.coverage.unionDateCount, 2);
  const loadSource = readFileSync(
    resolve(process.cwd(), "lib/thought-timeline/context-load.ts"),
    "utf8",
  );
  assert.doesNotMatch(loadSource, /\.insert\(/);
  assert.doesNotMatch(loadSource, /\.update\(/);
  assert.doesNotMatch(loadSource, /\.delete\(/);
  assert.doesNotMatch(loadSource, /getDb\(/);
});
