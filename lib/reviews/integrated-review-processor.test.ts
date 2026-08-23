import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { INTEGRATED_REVIEW_PROMPT_V5 } from "@/lib/ai/prompts/integrated-review";
import type { StoredReviewPayload } from "@/lib/ai/review-schemas";
import { defaultReviewSettings } from "@/lib/ai/review-schemas";
import { applySqlMigrations } from "@/lib/db/client";
import { countObservations } from "@/lib/db/observation-queries";
import { insertReview } from "@/lib/db/queries";
import * as schema from "@/lib/db/schema";
import {
  projectPersistedReview,
} from "@/lib/observations/project-review";
import { resumeIntegratedReviewProjection } from "@/lib/reviews/integrated-review-processor";
import {
  countReviewProcessingRuns,
  loadReviewProcessingRunByReviewId,
} from "@/lib/reviews/review-run-store";
import { classifyExactReviewSelectionState } from "@/lib/reviews/review-selection-state";

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
      occurredAt: "2099-01-01",
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

function emptyPayload(): StoredReviewPayload {
  return {
    summary: "summary",
    commonThemes: [],
    shifts: [],
    tensions: [],
    crossInsights: [],
    hypotheses: [],
    openQuestions: [],
    nextQuestions: [],
    settings: defaultReviewSettings("openai"),
    metrics: {
      evidenceCount: 0,
      validatedCount: 0,
      validationRate: 0,
      sessionCount: 2,
    },
  };
}

test("insertReview atomically creates review_processing_run(review_saved)", () => {
  const db = openMemoryDb();
  seedSession(db, "s-a");
  seedSession(db, "s-b");
  const record = insertReview(
    {
      title: "t",
      model: "test",
      promptVersion: INTEGRATED_REVIEW_PROMPT_V5,
      payload: emptyPayload(),
      sessionIds: ["s-a", "s-b"],
      evidences: [],
    },
    db,
  );
  const run = loadReviewProcessingRunByReviewId({ reviewId: record.id, db });
  assert.ok(run);
  assert.equal(run!.phase, "review_saved");
  assert.equal(countReviewProcessingRuns(db), 1);
});

test("zero Observation Review can reach projection_done", () => {
  const db = openMemoryDb();
  seedSession(db, "s-a");
  seedSession(db, "s-b");
  const record = insertReview(
    {
      title: "t",
      model: "test",
      promptVersion: INTEGRATED_REVIEW_PROMPT_V5,
      payload: emptyPayload(),
      sessionIds: ["s-a", "s-b"],
      evidences: [],
    },
    db,
  );
  const projected = projectPersistedReview({ reviewId: record.id, db });
  assert.equal(projected.ok, true);
  const run = loadReviewProcessingRunByReviewId({ reviewId: record.id, db });
  assert.equal(run!.phase, "projection_done");
  assert.equal(run!.projectedObservationCount, 0);
  assert.equal(countObservations(db), 0);
});

test("projection failure keeps review_saved; resume uses LLM 0", async () => {
  const db = openMemoryDb();
  seedSession(db, "s-a");
  seedSession(db, "s-b");
  const record = insertReview(
    {
      title: "t",
      model: "test",
      promptVersion: INTEGRATED_REVIEW_PROMPT_V5,
      payload: emptyPayload(),
      sessionIds: ["s-a", "s-b"],
      evidences: [],
    },
    db,
  );
  let projectCalls = 0;
  const first = await resumeIntegratedReviewProjection(
    { reviewId: record.id },
    {
      db,
      projectReview: () => {
        projectCalls += 1;
        throw new Error("injected_projection_failure");
      },
    },
  );
  assert.equal(first.status, "projection_failed");
  assert.equal(first.llmCalls, 0);
  assert.equal(projectCalls, 1);
  const runAfterFail = loadReviewProcessingRunByReviewId({
    reviewId: record.id,
    db,
  });
  assert.equal(runAfterFail!.phase, "review_saved");

  const second = await resumeIntegratedReviewProjection(
    { reviewId: record.id },
    { db },
  );
  assert.equal(second.status, "completed");
  assert.equal(second.llmCalls, 0);
  assert.equal(second.executionMode, "resumed");
  const runDone = loadReviewProcessingRunByReviewId({ reviewId: record.id, db });
  assert.equal(runDone!.phase, "projection_done");
});

test("resume is idempotent for partial projection via skippedExisting", async () => {
  const db = openMemoryDb();
  seedSession(db, "s-a");
  seedSession(db, "s-b");
  const record = insertReview(
    {
      title: "t",
      model: "test",
      promptVersion: INTEGRATED_REVIEW_PROMPT_V5,
      payload: emptyPayload(),
      sessionIds: ["s-a", "s-b"],
      evidences: [],
    },
    db,
  );
  projectPersistedReview({ reviewId: record.id, db });
  const before = countObservations(db);
  const resumed = await resumeIntegratedReviewProjection(
    { reviewId: record.id },
    { db },
  );
  assert.equal(resumed.status, "completed");
  assert.equal(resumed.llmCalls, 0);
  assert.equal(countObservations(db), before);
});

test("legacy Review without run is blocked on resume", async () => {
  const db = openMemoryDb();
  seedSession(db, "s-a");
  seedSession(db, "s-b");
  db.insert(schema.reviews)
    .values({
      id: "legacy-r",
      title: "legacy",
      model: "test",
      promptVersion: INTEGRATED_REVIEW_PROMPT_V5,
      payload: JSON.stringify(emptyPayload()),
      createdAt: "2026-08-18T00:00:00.000Z",
    })
    .run();
  db.insert(schema.reviewSessions)
    .values([
      { reviewId: "legacy-r", sessionId: "s-a" },
      { reviewId: "legacy-r", sessionId: "s-b" },
    ])
    .run();
  const result = await resumeIntegratedReviewProjection(
    { reviewId: "legacy-r" },
    { db },
  );
  assert.equal(result.status, "blocked");
  assert.equal(result.code, "legacy_review_completion_unknown");
  assert.equal(result.llmCalls, 0);
});

test("exact selection classifier distinguishes completed vs legacy", () => {
  const db = openMemoryDb();
  seedSession(db, "s-a");
  seedSession(db, "s-b");
  insertReview(
    {
      title: "done",
      model: "test",
      promptVersion: INTEGRATED_REVIEW_PROMPT_V5,
      payload: emptyPayload(),
      sessionIds: ["s-a", "s-b"],
      evidences: [],
    },
    db,
  );
  const doneId = db.select().from(schema.reviews).all()[0]!.id;
  projectPersistedReview({ reviewId: doneId, db });

  db.insert(schema.reviews)
    .values({
      id: "legacy-r",
      title: "legacy",
      model: "test",
      promptVersion: INTEGRATED_REVIEW_PROMPT_V5,
      payload: JSON.stringify(emptyPayload()),
      createdAt: "2026-08-18T00:00:00.000Z",
    })
    .run();
  db.insert(schema.reviewSessions)
    .values([
      { reviewId: "legacy-r", sessionId: "s-a" },
      { reviewId: "legacy-r", sessionId: "s-b" },
    ])
    .run();

  const state = classifyExactReviewSelectionState(db, ["s-b", "s-a"]);
  assert.deepEqual(state.exactCompletedReviewIds, [doneId]);
  assert.deepEqual(state.exactLegacyUnknownReviewIds, ["legacy-r"]);
});
