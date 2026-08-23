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
} from "@/lib/db/concept-queries";
import { countObservations } from "@/lib/db/observation-queries";
import * as schema from "@/lib/db/schema";
import { REVIEW_OBSERVATION_VERSION } from "@/lib/observations/types";
import {
  buildThoughtTimelineDiagnostic,
  formatThoughtTimelineDiagnostic,
} from "./diagnostic";
import {
  loadThoughtTimeline,
  loadThoughtTimelineAudit,
  thoughtTimelinePreviewExtras,
} from "./load";
import { assembleThoughtTimeline, buildThoughtTimeline } from "./timeline";
import {
  THOUGHT_TIMELINE_VERSION,
  type ThoughtTimelineSourceObservation,
} from "./types";

const USER =
  "これまでの人間関係でなぜ上手くいかないのか理解できないと思った。";
const EVIDENCE_QUOTE = "SECRET_USER_EVIDENCE_QUOTE_thought_timeline";

function connectionPayload(text: string, quote?: string) {
  return JSON.stringify({
    text,
    evidence: quote
      ? [
          {
            messageRef: "m1",
            quote,
            validated: true,
            messageId: null,
          },
        ]
      : [],
    semanticValid: true,
    relationType: "complement",
  });
}

function shiftPayload(interpretation: string) {
  return JSON.stringify({
    text: interpretation,
    evidence: [],
    semanticValid: true,
    before: "以前",
    after: "いま",
    interpretation,
    beforeEvidence: [],
    afterEvidence: [],
  });
}

function tensionPayload(text: string) {
  return JSON.stringify({
    text,
    evidence: [],
    semanticValid: true,
    sideA: { text: "A", evidence: [] },
    sideB: { text: "B", evidence: [] },
  });
}

function source(
  overrides: Partial<ThoughtTimelineSourceObservation> &
    Pick<ThoughtTimelineSourceObservation, "id" | "kind">,
): ThoughtTimelineSourceObservation {
  const kind = overrides.kind;
  const title = overrides.title ?? overrides.id;
  const body = overrides.body ?? title;
  const payload =
    overrides.payload ??
    (kind === "shift"
      ? shiftPayload(body)
      : kind === "tension"
        ? tensionPayload(body)
        : connectionPayload(body));
  return {
    title,
    body,
    payload,
    firstSeenAt: "2026-07-18",
    lastSeenAt: "2026-08-02",
    detectedAt: "2099-01-01T00:00:00.000Z",
    createdAt: "2099-01-01T00:00:00.000Z",
    sessionIds: ["session-a"],
    relatedConcepts: [],
    ...overrides,
  };
}

function openMemoryDb() {
  const sqlite = new Database(":memory:");
  applySqlMigrations(sqlite);
  sqlite.pragma("foreign_keys = ON");
  return drizzle(sqlite, { schema });
}

function seedReview(db: ReturnType<typeof openMemoryDb>, id = "review-1") {
  db.insert(schema.reviews)
    .values({
      id,
      title: id,
      model: "test",
      promptVersion: "integrated-review-v5",
      payload: "{}",
      createdAt: "2026-08-18T00:00:00.000Z",
    })
    .run();
}

function seedSession(
  db: ReturnType<typeof openMemoryDb>,
  id: string,
  occurredAt = "2026-08-02",
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
}

function seedObservation(
  db: ReturnType<typeof openMemoryDb>,
  row: ThoughtTimelineSourceObservation,
  sourceReviewId = "review-1",
) {
  db.insert(schema.observations)
    .values({
      id: row.id,
      kind: row.kind,
      projectionVersion: REVIEW_OBSERVATION_VERSION,
      sourceReviewId,
      sourceRef: row.id,
      title: row.title,
      body: row.body,
      supportType: null,
      payload: row.payload,
      firstSeenAt: row.firstSeenAt,
      lastSeenAt: row.lastSeenAt,
      detectedAt: row.detectedAt,
      distinctSessionCount: new Set(row.sessionIds).size,
      createdAt: row.createdAt,
    })
    .run();
  for (const sessionId of row.sessionIds) {
    db.insert(schema.observationSessions)
      .values({ observationId: row.id, sessionId })
      .run();
  }
}

test("A. empty Observation set → empty groups", () => {
  const timeline = buildThoughtTimeline({ observations: [] });
  assert.equal(timeline.version, THOUGHT_TIMELINE_VERSION);
  assert.deepEqual(timeline.range, {
    firstOccurredAt: null,
    lastOccurredAt: null,
  });
  assert.deepEqual(timeline.groups, []);
});

test("B. single Observation → 1 date / 1 item", () => {
  const timeline = buildThoughtTimeline({
    observations: [
      source({
        id: "obs-1",
        kind: "shift",
        title: "考え方が変わった",
        body: "考え方が変わった",
        lastSeenAt: "2026-08-02T18:00:00.000Z",
      }),
    ],
  });
  assert.equal(timeline.groups.length, 1);
  assert.equal(timeline.groups[0]?.date, "2026-08-02");
  assert.equal(timeline.groups[0]?.items.length, 1);
  assert.equal(timeline.groups[0]?.items[0]?.observationId, "obs-1");
  assert.equal(timeline.groups[0]?.items[0]?.observationType, "shift");
});

test("C. multiple Observations same day → same group", () => {
  const timeline = buildThoughtTimeline({
    observations: [
      source({
        id: "obs-b",
        kind: "connection",
        lastSeenAt: "2026-08-02T10:00:00.000Z",
      }),
      source({
        id: "obs-a",
        kind: "shift",
        lastSeenAt: "2026-08-02T18:00:00.000Z",
      }),
    ],
  });
  assert.equal(timeline.groups.length, 1);
  assert.deepEqual(
    timeline.groups[0]?.items.map((item) => item.observationId),
    ["obs-a", "obs-b"],
  );
});

test("D. multiple dates are newest first", () => {
  const timeline = buildThoughtTimeline({
    observations: [
      source({ id: "old", kind: "tension", lastSeenAt: "2026-07-15" }),
      source({ id: "new", kind: "shift", lastSeenAt: "2026-08-02" }),
      source({ id: "mid", kind: "connection", lastSeenAt: "2026-07-20" }),
    ],
  });
  assert.deepEqual(
    timeline.groups.map((group) => group.date),
    ["2026-08-02", "2026-07-20", "2026-07-15"],
  );
  assert.equal(timeline.range.firstOccurredAt, "2026-07-15");
  assert.equal(timeline.range.lastOccurredAt, "2026-08-02");
});

test("E. same timestamp uses observationId ASC", () => {
  const timeline = buildThoughtTimeline({
    observations: [
      source({ id: "obs-z", kind: "shift", lastSeenAt: "2026-08-02" }),
      source({ id: "obs-a", kind: "connection", lastSeenAt: "2026-08-02" }),
    ],
  });
  assert.deepEqual(
    timeline.groups[0]?.items.map((item) => item.observationId),
    ["obs-a", "obs-z"],
  );
});

test("F. occurredAt is thoughtDate, not createdAt / detectedAt", () => {
  const timeline = buildThoughtTimeline({
    observations: [
      source({
        id: "obs-1",
        kind: "shift",
        firstSeenAt: "2026-07-18",
        lastSeenAt: "2026-08-02",
        createdAt: "2099-01-01T00:00:00.000Z",
        detectedAt: "2099-01-01T00:00:00.000Z",
      }),
    ],
  });
  const item = timeline.groups[0]?.items[0];
  assert.equal(item?.occurredAt, "2026-08-02");
  assert.equal(item?.occurredAt.includes("2099"), false);
  const serialized = JSON.stringify(timeline);
  assert.equal(serialized.includes("2099-01-01"), false);
});

test("G. Observation types are preserved, not reclassified", () => {
  const timeline = buildThoughtTimeline({
    observations: [
      source({ id: "s", kind: "shift", lastSeenAt: "2026-08-02" }),
      source({ id: "c", kind: "connection", lastSeenAt: "2026-08-02" }),
      source({ id: "t", kind: "tension", lastSeenAt: "2026-08-02" }),
    ],
  });
  const types = timeline.groups[0]?.items.map((item) => item.observationType);
  assert.deepEqual(new Set(types), new Set(["shift", "connection", "tension"]));
  const serialized = JSON.stringify(timeline);
  assert.equal(serialized.includes("insight"), false);
  assert.equal(serialized.includes("major_event"), false);
  assert.equal(serialized.includes("important_change"), false);
});

test("H. related Concepts are explicit input only", () => {
  const timeline = buildThoughtTimeline({
    observations: [
      source({
        id: "obs-1",
        kind: "connection",
        lastSeenAt: "2026-08-02",
        relatedConcepts: [
          { conceptId: "c-2", canonicalLabel: "両親" },
          { conceptId: "c-1", canonicalLabel: "人間関係" },
        ],
      }),
    ],
  });
  assert.deepEqual(timeline.groups[0]?.items[0]?.relatedConcepts, [
    { conceptId: "c-1", canonicalLabel: "人間関係" },
    { conceptId: "c-2", canonicalLabel: "両親" },
  ]);
});

test("I. Concept relations are not inferred from Observation text", () => {
  const timeline = buildThoughtTimeline({
    observations: [
      source({
        id: "obs-1",
        kind: "connection",
        title: "高性能AIと寂しさの話",
        body: "高性能AIと寂しさの話",
        lastSeenAt: "2026-08-02",
        relatedConcepts: [],
      }),
    ],
  });
  assert.deepEqual(timeline.groups[0]?.items[0]?.relatedConcepts, []);
  const builder = readFileSync(
    resolve(process.cwd(), "lib/thought-timeline/timeline.ts"),
    "utf8",
  );
  const loader = readFileSync(
    resolve(process.cwd(), "lib/thought-timeline/load.ts"),
    "utf8",
  );
  assert.doesNotMatch(builder, /body\.includes/);
  assert.doesNotMatch(builder, /title\.includes/);
  assert.doesNotMatch(builder, /from "\.\/concepts"/);
  assert.match(loader, /relatedConcepts: \[\]/);
  assert.doesNotMatch(loader, /from\(concepts\)/);
  assert.doesNotMatch(
    readFileSync(resolve(process.cwd(), "lib/db/schema.ts"), "utf8"),
    /observationConcepts|observation_concepts/,
  );
});

test("J. USER transcript / Evidence quote are absent from timeline items", () => {
  const timeline = buildThoughtTimeline({
    observations: [
      source({
        id: "obs-1",
        kind: "connection",
        title: "つながっている",
        body: "つながっている",
        payload: connectionPayload("つながっている", EVIDENCE_QUOTE),
        lastSeenAt: "2026-08-02",
      }),
    ],
  });
  const serialized = JSON.stringify(timeline);
  assert.equal(serialized.includes(USER), false);
  assert.equal(serialized.includes(EVIDENCE_QUOTE), false);
  assert.equal(serialized.includes("surfaceForm"), false);
  assert.equal(serialized.includes("quote"), false);
  assert.equal(serialized.includes("rawContent"), false);
});

test("K. Observation derived summary is preserved, not rewritten", () => {
  const body = "既存の観測文はそのまま使う";
  const timeline = buildThoughtTimeline({
    observations: [
      source({
        id: "obs-1",
        kind: "shift",
        title: "見出し",
        body,
        lastSeenAt: "2026-08-02",
      }),
    ],
  });
  const item = timeline.groups[0]?.items[0];
  assert.equal(item?.title, "見出し");
  assert.equal(item?.summary, body);
});

test("L. input order does not change output", () => {
  const observations = [
    source({ id: "c", kind: "tension", lastSeenAt: "2026-07-15" }),
    source({ id: "a", kind: "shift", lastSeenAt: "2026-08-02" }),
    source({ id: "b", kind: "connection", lastSeenAt: "2026-08-02" }),
  ];
  const left = buildThoughtTimeline({ observations });
  const right = buildThoughtTimeline({ observations: [...observations].reverse() });
  assert.deepEqual(left, right);
});

test("M. malformed / unsupported Observations are skipped with reasons", () => {
  const assembled = assembleThoughtTimeline({
    observations: [
      source({ id: "ok", kind: "shift", lastSeenAt: "2026-08-02" }),
      source({ id: "bad-kind", kind: "hypothesis", lastSeenAt: "2026-08-02" }),
      source({
        id: "bad-json",
        kind: "connection",
        payload: "{not-json",
        lastSeenAt: "2026-08-02",
      }),
      source({
        id: "hidden",
        kind: "connection",
        payload: JSON.stringify({
          text: "hidden",
          evidence: [],
          semanticValid: false,
        }),
        lastSeenAt: "2026-08-02",
      }),
      source({
        id: "no-thought",
        kind: "shift",
        firstSeenAt: null,
        lastSeenAt: null,
      }),
      source({
        id: "bad-date",
        kind: "tension",
        firstSeenAt: "not-a-date",
        lastSeenAt: "not-a-date",
      }),
    ],
  });
  assert.equal(assembled.timeline.groups.length, 1);
  assert.equal(assembled.timeline.groups[0]?.items[0]?.observationId, "ok");
  const byId = Object.fromEntries(
    assembled.skipped.map((skip) => [skip.observationId, skip.skipReason]),
  );
  assert.equal(byId["bad-kind"], "unsupported_kind");
  assert.equal(byId["bad-json"], "unparseable_payload");
  assert.equal(byId["hidden"], "not_visible");
  assert.equal(byId["no-thought"], "missing_thought_occurrence");
  assert.equal(byId["bad-date"], "invalid_thought_occurrence");
  const diagnostic = buildThoughtTimelineDiagnostic({
    sourceObservationCount: 6,
    timeline: assembled.timeline,
    skipped: assembled.skipped,
    hasObservationConceptsRelation: false,
    conceptOccurrenceCount: 20,
  });
  assert.equal(diagnostic.includedCount, 1);
  assert.equal(diagnostic.skippedObservationCount, 5);
  assert.equal(diagnostic.timelineIncludesConceptOccurrence, false);
  assert.equal(diagnostic.conceptOccurrenceCount, 20);
  assert.doesNotMatch(
    formatThoughtTimelineDiagnostic(diagnostic),
    /SECRET_USER/,
  );
});

test("N. LLM is not used", () => {
  const files = [
    "lib/thought-timeline/timeline.ts",
    "lib/thought-timeline/load.ts",
    "lib/thought-timeline/diagnostic.ts",
    "lib/thought-timeline/types.ts",
  ];
  for (const file of files) {
    const sourceText = readFileSync(resolve(process.cwd(), file), "utf8");
    assert.doesNotMatch(sourceText, /from "openai"/);
    assert.doesNotMatch(sourceText, /runConceptAssessment/);
    assert.doesNotMatch(sourceText, /importance/);
    assert.doesNotMatch(sourceText, /signalScore/);
    assert.doesNotMatch(sourceText, /major_event/);
  }
});

test("O. loader is SELECT-only and does not mutate the DB", () => {
  const db = openMemoryDb();
  seedReview(db);
  seedSession(db, "session-a");
  seedSession(db, "session-b");
  seedObservation(
    db,
    source({
      id: "obs-1",
      kind: "shift",
      title: "変化",
      body: "変化",
      sessionIds: ["session-a", "session-b"],
      lastSeenAt: "2026-08-02",
    }),
  );
  const before = {
    observations: countObservations(db),
    concepts: countConcepts(db),
    occurrences: countConceptOccurrences(db),
  };
  const audit = loadThoughtTimelineAudit({ db });
  const after = {
    observations: countObservations(db),
    concepts: countConcepts(db),
    occurrences: countConceptOccurrences(db),
  };
  assert.deepEqual(after, before);
  assert.equal(audit.timeline.groups[0]?.items[0]?.observationType, "shift");
  assert.deepEqual(audit.timeline.groups[0]?.items[0]?.sessionIds, [
    "session-a",
    "session-b",
  ]);
  assert.deepEqual(audit.timeline.groups[0]?.items[0]?.relatedConcepts, []);
  assert.equal(audit.diagnostic.hasObservationConceptsRelation, false);
  assert.equal(audit.diagnostic.timelineIncludesConceptOccurrence, false);
  const loadSource = readFileSync(
    resolve(process.cwd(), "lib/thought-timeline/load.ts"),
    "utf8",
  );
  assert.doesNotMatch(loadSource, /\.insert\(/);
  assert.doesNotMatch(loadSource, /\.update\(/);
  assert.doesNotMatch(loadSource, /\.delete\(/);
  assert.doesNotMatch(loadSource, /getDb\(/);
  const timeline = loadThoughtTimeline({ db });
  assert.deepEqual(timeline, audit.timeline);
  const extras = thoughtTimelinePreviewExtras(timeline);
  assert.equal(extras.dateCounts[0]?.count, 1);
  assert.equal(extras.sessionCounts.length, 2);
});
