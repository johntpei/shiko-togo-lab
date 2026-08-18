import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { INTEGRATED_REVIEW_MAX_INPUT_CHARS } from "@/lib/ai/limits";
import {
  INTEGRATED_REVIEW_PROMPT_V3,
  INTEGRATED_REVIEW_PROMPT_V4,
  INTEGRATED_REVIEW_PROMPT_V5,
} from "@/lib/ai/prompts/integrated-review";
import type {
  StoredReviewEvidence,
  StoredReviewItem,
  StoredReviewPayload,
  StoredReviewShiftItem,
} from "@/lib/ai/review-schemas";
import { applySqlMigrations } from "@/lib/db/client";
import {
  countObservations,
  createDbProjectStore,
  listObservationSessionIds,
  listObservations,
  type NewObservationInsert,
  type ProjectReviewStore,
} from "@/lib/db/observation-queries";
import * as schema from "@/lib/db/schema";
import { backfillObservationsFromReviews } from "./backfill-reviews";
import { projectReviewToObservations } from "./project-review";
import { REVIEW_OBSERVATION_VERSION } from "./types";

function evidence(input: {
  ref: string;
  quote: string;
  sessionId: string;
  occurredAt?: string | null;
}): StoredReviewEvidence {
  return {
    messageRef: input.ref,
    quote: input.quote,
    validated: true,
    messageId: input.ref,
    sessionId: input.sessionId,
    sessionTitle: input.sessionId,
    occurredAt: input.occurredAt ?? null,
    role: "user",
    reason: null,
  };
}

function shift(): StoredReviewShiftItem {
  const beforeEvidence = [
    evidence({
      ref: "S01:M001:E01",
      quote: "自由に考えたいです。",
      sessionId: "s1",
      occurredAt: "2026-07-18",
    }),
  ];
  const afterEvidence = [
    evidence({
      ref: "S02:M001:E01",
      quote: "締切があると動きやすいです。",
      sessionId: "s2",
      occurredAt: "2026-08-02",
    }),
  ];
  return {
    text: "制約の捉え方が変化している。",
    before: "自由に考えたい",
    after: "締切があると動きやすい",
    interpretation: "制約の捉え方が変化している。",
    beforeEvidence,
    afterEvidence,
    evidence: [...beforeEvidence, ...afterEvidence],
    semanticValid: true,
    invalidReason: null,
    guardType: "hard",
    supportType: "direct",
    distinctSessionCount: 2,
  };
}

function tension(): StoredReviewItem {
  const sideAEvidence = [
    evidence({
      ref: "S01:M001:E01",
      quote: "自由に考えたいです。",
      sessionId: "s1",
      occurredAt: "2026-07-18",
    }),
  ];
  const sideBEvidence = [
    evidence({
      ref: "S02:M001:E01",
      quote: "締切があると動きやすいです。",
      sessionId: "s2",
      occurredAt: "2026-08-02",
    }),
  ];
  return {
    text: "自由と締切は両立条件を考えるポイントになる。",
    evidence: [...sideAEvidence, ...sideBEvidence],
    semanticValid: true,
    invalidReason: null,
    guardType: "interpretation",
    supportType: "cross_session_interpretation",
    relationType: "contrast",
    distinctSessionCount: 2,
    sideA: { text: "自由に考えたい", evidence: sideAEvidence },
    sideB: { text: "締切があると動きやすい", evidence: sideBEvidence },
  };
}

function connection(): StoredReviewItem {
  return {
    text: "ボトルネックが人間側の知見管理へ移っている。",
    evidence: [
      evidence({
        ref: "S01:M002:E01",
        quote: "整理が追いつかない。",
        sessionId: "s1",
        occurredAt: "2026-07-18",
      }),
      evidence({
        ref: "S02:M002:E01",
        quote: "再利用できる形にしたい。",
        sessionId: "s2",
        occurredAt: "2026-08-02",
      }),
    ],
    semanticValid: true,
    invalidReason: null,
    guardType: "interpretation",
    supportType: "cross_session_interpretation",
    relationType: "complement",
    distinctSessionCount: 2,
  };
}

function payload(): StoredReviewPayload {
  return {
    summary: "運用の設計が主題になっている。",
    commonThemes: [],
    shifts: [shift()],
    tensions: [tension()],
    crossInsights: [connection()],
    hypotheses: [],
    openQuestions: [],
    nextQuestions: [],
    settings: {
      provider: "openai",
      store: false,
      maxInputChars: INTEGRATED_REVIEW_MAX_INPUT_CHARS,
    },
  };
}

function createMemoryStore(
  sessions: Array<{ id: string; occurredAt: string }>,
) {
  const rows: NewObservationInsert[] = [];
  const store: ProjectReviewStore = {
    listSessionsByIds(ids) {
      return sessions.filter((session) => ids.includes(session.id));
    },
    findObservationByIdentity(identity) {
      const found = rows.find(
        (row) =>
          row.sourceReviewId === identity.sourceReviewId &&
          row.sourceRef === identity.sourceRef &&
          row.projectionVersion === identity.projectionVersion,
      );
      return found ? { id: found.id } : null;
    },
    insertObservation(row) {
      const duplicate = rows.some(
        (item) =>
          item.sourceReviewId === row.sourceReviewId &&
          item.sourceRef === row.sourceRef &&
          item.projectionVersion === row.projectionVersion,
      );
      if (duplicate) {
        throw new Error(
          "UNIQUE constraint failed: observations_source_identity_unique",
        );
      }
      rows.push({ ...row, sessionIds: [...row.sessionIds] });
    },
  };
  return { store, rows };
}

const sessions = [
  { id: "s1", occurredAt: "2026-07-18" },
  { id: "s2", occurredAt: "2026-08-02" },
  { id: "s3", occurredAt: "2020-01-01" },
];

test("v5 Review から Observation を保存し payload 構造を維持する", () => {
  const { store, rows } = createMemoryStore(sessions);
  const result = projectReviewToObservations(
    {
      reviewId: "review-1",
      promptVersion: INTEGRATED_REVIEW_PROMPT_V5,
      payload: payload(),
      sessions,
      detectedAt: "2026-08-18T06:00:00.000Z",
    },
    store,
  );
  assert.equal(result.status, "projected");
  assert.equal(result.inserted, 3);
  const shiftRow = rows.find((row) => row.kind === "shift");
  assert.ok(shiftRow);
  assert.equal(shiftRow.sourceRef, "R:SHIFT:01");
  assert.equal(shiftRow.projectionVersion, REVIEW_OBSERVATION_VERSION);
  const parsed = JSON.parse(shiftRow.payload) as StoredReviewShiftItem;
  assert.equal(parsed.before, "自由に考えたい");
  assert.equal(parsed.after, "締切があると動きやすい");
  assert.equal(parsed.interpretation, "制約の捉え方が変化している。");
  const tensionRow = rows.find((row) => row.kind === "tension");
  const tensionPayload = JSON.parse(tensionRow?.payload ?? "{}") as StoredReviewItem;
  assert.equal(tensionPayload.sideA?.text, "自由に考えたい");
  assert.equal(tensionPayload.sideB?.text, "締切があると動きやすい");
  const connectionRow = rows.find((row) => row.kind === "connection");
  const connectionPayload = JSON.parse(
    connectionRow?.payload ?? "{}",
  ) as StoredReviewItem;
  assert.equal(connectionPayload.relationType, "complement");
});

test("同じ Review を2回投影しても Observation は増えない", () => {
  const { store, rows } = createMemoryStore(sessions);
  const input = {
    reviewId: "review-1",
    promptVersion: INTEGRATED_REVIEW_PROMPT_V5,
    payload: payload(),
    sessions,
    detectedAt: "2026-08-18T06:00:00.000Z",
  };
  const first = projectReviewToObservations(input, store);
  const second = projectReviewToObservations(
    { ...input, detectedAt: "2026-08-18T07:00:00.000Z" },
    store,
  );
  assert.equal(first.inserted, 3);
  assert.equal(second.inserted, 0);
  assert.equal(second.skippedExisting, 3);
  assert.equal(rows.length, 3);
  assert.equal(
    rows.every((row) => row.detectedAt === "2026-08-18T06:00:00.000Z"),
    true,
  );
});

test("v3 / v4 / unknown は例外なく skip する", () => {
  const { store, rows } = createMemoryStore(sessions);
  const input = {
    reviewId: "review-old",
    payload: payload(),
    sessions,
  };
  assert.doesNotThrow(() => {
    projectReviewToObservations(
      { ...input, promptVersion: INTEGRATED_REVIEW_PROMPT_V3 },
      store,
    );
  });
  const v3 = projectReviewToObservations(
    { ...input, promptVersion: INTEGRATED_REVIEW_PROMPT_V3 },
    store,
  );
  const v4 = projectReviewToObservations(
    { ...input, promptVersion: INTEGRATED_REVIEW_PROMPT_V4 },
    store,
  );
  const unknown = projectReviewToObservations(
    { ...input, promptVersion: "integrated-review-v2" },
    store,
  );
  assert.equal(v3.status, "skipped");
  assert.equal(v4.status, "skipped");
  assert.equal(unknown.status, "skipped");
  assert.equal(rows.length, 0);
});

test("observation_sessions は Evidence が参照する Session だけ", () => {
  const { store, rows } = createMemoryStore(sessions);
  projectReviewToObservations(
    {
      reviewId: "review-1",
      promptVersion: INTEGRATED_REVIEW_PROMPT_V5,
      payload: payload(),
      sessions,
    },
    store,
  );
  for (const row of rows) {
    assert.deepEqual([...row.sessionIds].sort(), ["s1", "s2"]);
    assert.equal(row.sessionIds.includes("s3"), false);
  }
  assert.equal(rows[0]?.firstSeenAt, "2026-07-18");
  assert.equal(rows[0]?.lastSeenAt, "2026-08-02");
});

test("Backfill は同じ fromReview 経路で、2回実行しても増えない", () => {
  const { store, rows } = createMemoryStore(sessions);
  const reviews = [
    {
      id: "review-v5",
      promptVersion: INTEGRATED_REVIEW_PROMPT_V5,
      payload: JSON.stringify(payload()),
      sessions,
    },
    {
      id: "review-v4",
      promptVersion: INTEGRATED_REVIEW_PROMPT_V4,
      payload: JSON.stringify(payload()),
      sessions,
    },
  ];
  const first = backfillObservationsFromReviews(reviews, store);
  const second = backfillObservationsFromReviews(reviews, store);
  assert.equal(first.considered, 2);
  assert.equal(first.projected, 1);
  assert.equal(first.skippedUnsupported, 1);
  assert.equal(first.inserted, 3);
  assert.equal(second.inserted, 0);
  assert.equal(second.skippedExisting, 3);
  assert.equal(rows.length, 3);
});

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
) {
  db.insert(schema.sessions)
    .values({
      id,
      title: id,
      occurredAt,
      source: "chatgpt",
      category: "制作",
      rawContent: "x",
      status: "draft",
      sourceConversationId: null,
      importSource: "manual",
      sourceStartAt: null,
      sourceEndAt: null,
      createdAt: "2026-08-18T00:00:00.000Z",
      updatedAt: "2026-08-18T00:00:00.000Z",
    })
    .run();
}

test("SQLite に Observation を保存し unique 制約で重複しない", () => {
  const db = openMemoryDb();
  seedSession(db, "s1", "2026-07-18");
  seedSession(db, "s2", "2026-08-02");
  seedSession(db, "s3", "2020-01-01");
  db.insert(schema.reviews)
    .values({
      id: "review-1",
      title: "レビュー",
      model: "test",
      promptVersion: INTEGRATED_REVIEW_PROMPT_V5,
      payload: JSON.stringify(payload()),
      createdAt: "2026-08-18T00:00:00.000Z",
    })
    .run();

  const store = createDbProjectStore(db);
  const input = {
    reviewId: "review-1",
    promptVersion: INTEGRATED_REVIEW_PROMPT_V5,
    payload: payload(),
    sessionIds: ["s1", "s2", "s3"],
    detectedAt: "2026-08-18T06:00:00.000Z",
  };
  const first = projectReviewToObservations(input, store);
  const second = projectReviewToObservations(input, store);
  assert.equal(first.inserted, 3);
  assert.equal(second.inserted, 0);
  assert.equal(countObservations(db), 3);

  const shifts = listObservations({ kind: "shift", sourceReviewId: "review-1" }, db);
  assert.equal(shifts.length, 1);
  assert.equal(shifts[0]?.sourceRef, "R:SHIFT:01");
  const parsed = JSON.parse(shifts[0]?.payload ?? "{}") as StoredReviewShiftItem;
  assert.equal(parsed.before, "自由に考えたい");

  const sessionIds = listObservationSessionIds(shifts[0]?.id ?? "", db).sort();
  assert.deepEqual(sessionIds, ["s1", "s2"]);
});
