import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { applySqlMigrations } from "@/lib/db/client";
import { CONCEPT_EXTRACTION_VERSION } from "@/lib/concepts/types";
import { buildTopicSignalSnapshot } from "@/lib/concepts/topic-signal/snapshot";
import {
  countConceptOccurrences,
  countConcepts,
  insertConcept,
  insertConceptOccurrence,
} from "@/lib/db/concept-queries";
import { countObservations } from "@/lib/db/observation-queries";
import * as schema from "@/lib/db/schema";
import { REVIEW_OBSERVATION_VERSION } from "@/lib/observations/types";
import { loadThoughtTimelinePresentation } from "./presentation-load";
import {
  THOUGHT_TIMELINE_PRESENTATION_COPY,
  THOUGHT_TIMELINE_PRESENTATION_VERSION,
  buildThoughtTimelinePresentation,
} from "./presentation";
import { buildThoughtTimeline } from "./timeline";
import {
  THOUGHT_TIMELINE_VERSION,
  type ThoughtTimeline,
  type ThoughtTimelineSourceObservation,
} from "./types";

const USER =
  "これまでの人間関係でなぜ上手くいかないのか理解できないと思った。";
const UUID = "9bbee31b-7590-40bc-8b59-f39790193937";

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

function observation(
  overrides: Partial<ThoughtTimelineSourceObservation> &
    Pick<ThoughtTimelineSourceObservation, "id" | "kind">,
): ThoughtTimelineSourceObservation {
  const body = overrides.body ?? overrides.title ?? overrides.id;
  return {
    title: overrides.title ?? body,
    body,
    payload:
      overrides.kind === "tension"
        ? tensionPayload(body)
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

function present(input: {
  timeline?: ThoughtTimeline;
  concepts?: Array<{ conceptId: string; canonicalLabel: string }>;
  occurrences?: Array<{
    conceptId: string;
    sessionId: string;
    occurredAt: string;
  }>;
}) {
  const occurrences = input.occurrences ?? [];
  return buildThoughtTimelinePresentation({
    timeline: input.timeline ?? timelineFrom([]),
    snapshot: buildTopicSignalSnapshot({
      concepts: input.concepts ?? [],
      occurrences,
    }),
    occurrences,
  });
}

function elevenConcepts() {
  return Array.from({ length: 11 }, (_, index) => ({
    conceptId: `c-${String(index + 1).padStart(2, "0")}`,
    canonicalLabel: `Theme ${String.fromCharCode(65 + index)}`,
  }));
}

function openMemoryDb() {
  const sqlite = new Database(":memory:");
  applySqlMigrations(sqlite);
  sqlite.pragma("foreign_keys = ON");
  return drizzle(sqlite, { schema });
}

test("A. empty groups", () => {
  const model = present({});
  assert.equal(model.version, THOUGHT_TIMELINE_PRESENTATION_VERSION);
  assert.deepEqual(model.groups, []);
  assert.deepEqual(model.range, { firstDate: null, lastDate: null });
  assert.equal(model.rangeLabel, null);
});

test("B. Observation-only date", () => {
  const model = present({
    timeline: timelineFrom([
      observation({
        id: "obs-1",
        kind: "tension",
        title: "揺れている",
        body: "揺れている",
        lastSeenAt: "2026-08-02",
      }),
    ]),
  });
  assert.equal(model.groups.length, 1);
  assert.equal(model.groups[0]?.date, "2026-08-02");
  assert.equal(model.groups[0]?.observations.length, 1);
  assert.equal(model.groups[0]?.observations[0]?.observationType, "tension");
  assert.equal(model.groups[0]?.observations[0]?.typeLabel, "緊張関係");
  assert.equal(model.groups[0]?.observations[0]?.summary, "揺れている");
  assert.deepEqual(model.groups[0]?.themes, []);
});

test("C. Concept-only date", () => {
  const model = present({
    concepts: [{ conceptId: "c-1", canonicalLabel: "ThemeA" }],
    occurrences: [
      { conceptId: "c-1", sessionId: "s-1", occurredAt: "2026-07-26" },
    ],
  });
  assert.equal(model.groups.length, 1);
  assert.equal(model.groups[0]?.date, "2026-07-26");
  assert.deepEqual(model.groups[0]?.observations, []);
  assert.deepEqual(model.groups[0]?.themes, [
    { canonicalLabel: "ThemeA", occurrenceCount: 1 },
  ]);
});

test("D. both date keeps Observation and themes", () => {
  const model = present({
    timeline: timelineFrom([
      observation({
        id: "obs-1",
        kind: "connection",
        body: "つながっている",
        lastSeenAt: "2026-08-02",
      }),
    ]),
    concepts: [{ conceptId: "c-1", canonicalLabel: "高性能AI" }],
    occurrences: [
      { conceptId: "c-1", sessionId: "s-1", occurredAt: "2026-08-02" },
    ],
  });
  assert.equal(model.groups[0]?.observations.length, 1);
  assert.equal(model.groups[0]?.themes.length, 1);
  assert.equal("relatedConcepts" in (model.groups[0]?.observations[0] ?? {}), false);
});

test("E. union dates from both sources", () => {
  const model = present({
    timeline: timelineFrom([
      observation({ id: "obs-1", kind: "connection", lastSeenAt: "2026-08-02" }),
    ]),
    concepts: [{ conceptId: "c-1", canonicalLabel: "ThemeA" }],
    occurrences: [
      { conceptId: "c-1", sessionId: "s-1", occurredAt: "2026-07-12" },
      { conceptId: "c-1", sessionId: "s-1", occurredAt: "2026-08-02" },
    ],
  });
  assert.deepEqual(
    model.groups.map((group) => group.date),
    ["2026-08-02", "2026-07-12"],
  );
  assert.equal(model.range.firstDate, "2026-07-12");
  assert.equal(model.range.lastDate, "2026-08-02");
  assert.equal(model.rangeLabel, "2026/07/12 — 2026/08/02");
});

test("F. dates are newest first", () => {
  const model = present({
    concepts: [{ conceptId: "c-1", canonicalLabel: "ThemeA" }],
    occurrences: [
      { conceptId: "c-1", sessionId: "s-1", occurredAt: "2026-07-12" },
      { conceptId: "c-1", sessionId: "s-1", occurredAt: "2026-07-26" },
      { conceptId: "c-1", sessionId: "s-1", occurredAt: "2026-07-15" },
    ],
  });
  assert.deepEqual(
    model.groups.map((group) => group.date),
    ["2026-07-26", "2026-07-15", "2026-07-12"],
  );
});

test("G. same Concept same date aggregates to one theme", () => {
  const model = present({
    concepts: [{ conceptId: "c-1", canonicalLabel: "人間関係" }],
    occurrences: [
      { conceptId: "c-1", sessionId: "s-1", occurredAt: "2026-07-15T10:00:00.000Z" },
      { conceptId: "c-1", sessionId: "s-2", occurredAt: "2026-07-15T18:00:00.000Z" },
    ],
  });
  assert.deepEqual(model.groups[0]?.themes, [
    { canonicalLabel: "人間関係", occurrenceCount: 2 },
  ]);
});

test("H. multiple Concepts use deterministic ordering", () => {
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
  const left = present({ concepts, occurrences });
  const right = present({
    concepts: [...concepts].reverse(),
    occurrences: [...occurrences].reverse(),
  });
  assert.deepEqual(left.groups[0]?.themes, right.groups[0]?.themes);
  assert.deepEqual(
    left.groups[0]?.themes.map((theme) => theme.canonicalLabel),
    ["Alpha", "Alpha", "Beta"],
  );
  assert.equal(left.groups[0]?.themes[0]?.occurrenceCount, 2);
});

test("I. 11 Concepts are not truncated", () => {
  const concepts = elevenConcepts();
  const model = present({
    concepts,
    occurrences: concepts.map((concept) => ({
      conceptId: concept.conceptId,
      sessionId: "s-1",
      occurredAt: "2026-07-15",
    })),
  });
  assert.equal(model.groups[0]?.themes.length, 11);
  assert.equal(JSON.stringify(model).includes("top"), false);
});

test("J. no inferred Observation↔Concept relation", () => {
  const timeline = timelineFrom([
    observation({
      id: "obs-1",
      kind: "connection",
      body: "高性能AIの接続",
      lastSeenAt: "2026-08-02",
      relatedConcepts: [
        { conceptId: UUID, canonicalLabel: "高性能AI" },
      ],
    }),
  ]);
  const model = present({
    timeline,
    concepts: [{ conceptId: UUID, canonicalLabel: "高性能AI" }],
    occurrences: [
      { conceptId: UUID, sessionId: "s-1", occurredAt: "2026-08-02" },
    ],
  });
  const serialized = JSON.stringify(model);
  assert.equal(serialized.includes("related"), false);
  assert.equal(serialized.includes("関連テーマ"), false);
  assert.equal(serialized.includes(UUID), false);
  assert.equal("relatedConcepts" in (model.groups[0]?.observations[0] ?? {}), false);
  assert.equal("conceptId" in (model.groups[0]?.themes[0] ?? {}), false);
});

test("K. Topic Signal classification is unused", () => {
  const files = [
    "lib/thought-timeline/presentation.ts",
    "lib/thought-timeline/presentation-load.ts",
    "components/app/thought-timeline-panel.tsx",
    "app/(app)/timeline/page.tsx",
  ];
  for (const file of files) {
    const sourceText = readFileSync(resolve(process.cwd(), file), "utf8");
    assert.doesNotMatch(sourceText, /recently_observed/);
    assert.doesNotMatch(sourceText, /cross_session_recurrence/);
    assert.doesNotMatch(sourceText, /buildTopicSignals/);
  }
});

test("L. Production ThoughtTimeline stays Observation-only", () => {
  const timeline = timelineFrom([
    observation({ id: "obs-1", kind: "connection", lastSeenAt: "2026-08-02" }),
  ]);
  const before = structuredClone(timeline);
  const model = present({
    timeline,
    concepts: [{ conceptId: "c-1", canonicalLabel: "ThemeA" }],
    occurrences: [
      { conceptId: "c-1", sessionId: "s-1", occurredAt: "2026-07-15" },
    ],
  });
  assert.deepEqual(timeline, before);
  assert.equal(timeline.version, THOUGHT_TIMELINE_VERSION);
  assert.equal(timeline.groups.length, 1);
  assert.equal(timeline.groups[0]?.items[0]?.kind, "observation");
  assert.equal(model.groups.length, 2);
});

test("M. USER transcript is absent from presentation model", () => {
  const model = present({
    timeline: timelineFrom([
      observation({
        id: "obs-1",
        kind: "connection",
        title: "つながっている",
        body: "つながっている",
        payload: connectionPayload("つながっている", USER),
        lastSeenAt: "2026-08-02",
      }),
    ]),
  });
  const serialized = JSON.stringify(model);
  assert.equal(serialized.includes(USER), false);
  assert.equal(serialized.includes("surfaceForm"), false);
  assert.equal(serialized.includes("quote"), false);
});

test("N. LLM is not used", () => {
  const files = [
    "lib/thought-timeline/presentation.ts",
    "lib/thought-timeline/presentation-load.ts",
    "components/app/thought-timeline-panel.tsx",
  ];
  for (const file of files) {
    const sourceText = readFileSync(resolve(process.cwd(), file), "utf8");
    assert.doesNotMatch(sourceText, /from "openai"/);
    assert.doesNotMatch(sourceText, /重要テーマ/);
    assert.doesNotMatch(sourceText, /会話履歴/);
    assert.doesNotMatch(sourceText, /"use client"/);
  }
});

test("O. loader is SELECT-only and markup is wrap-safe", () => {
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
  assert.equal(
    insertConcept(
      {
        id: "c-1",
        canonicalLabel: "ThemeA",
        createdAt: "2026-07-01T00:00:00.000Z",
      },
      db,
    ).status,
    "inserted",
  );
  assert.equal(
    insertConceptOccurrence(
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
    ).status,
    "inserted",
  );
  const before = {
    observations: countObservations(db),
    concepts: countConcepts(db),
    occurrences: countConceptOccurrences(db),
  };
  const model = loadThoughtTimelinePresentation({ db });
  const after = {
    observations: countObservations(db),
    concepts: countConcepts(db),
    occurrences: countConceptOccurrences(db),
  };
  assert.deepEqual(after, before);
  assert.equal(model.groups.length, 2);
  const loadSource = readFileSync(
    resolve(process.cwd(), "lib/thought-timeline/presentation-load.ts"),
    "utf8",
  );
  assert.doesNotMatch(loadSource, /\.insert\(/);
  assert.doesNotMatch(loadSource, /getDb\(/);
  const panel = readFileSync(
    resolve(process.cwd(), "components/app/thought-timeline-panel.tsx"),
    "utf8",
  );
  assert.match(panel, /<h1/);
  assert.match(panel, /<h2/);
  assert.match(panel, /<h3/);
  assert.match(panel, /flex-wrap/);
  assert.match(panel, /min-w-0/);
  assert.match(panel, /break-words/);
  assert.doesNotMatch(panel, /関連テーマ/);
  assert.doesNotMatch(panel, /今、見ておきたいこと/);
  assert.equal(THOUGHT_TIMELINE_PRESENTATION_COPY.themeHeading, "この日に見えていたテーマ");
  const page = readFileSync(
    resolve(process.cwd(), "app/(app)/timeline/page.tsx"),
    "utf8",
  );
  assert.match(page, /loadThoughtTimelinePresentation/);
  assert.doesNotMatch(page, /catch/);
  const sidebar = readFileSync(
    resolve(process.cwd(), "components/app/app-sidebar.tsx"),
    "utf8",
  );
  const homeAt = sidebar.indexOf('href: "/"');
  const timelineAt = sidebar.indexOf('href: "/timeline"');
  const sessionAt = sidebar.indexOf('href: "/sessions"');
  assert.ok(homeAt >= 0 && timelineAt >= 0 && sessionAt >= 0);
  assert.ok(homeAt < timelineAt && timelineAt < sessionAt);
});
