import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import {
  INTEGRATED_REVIEW_PROMPT_V5,
  INTEGRATED_REVIEW_PROMPT_V8,
} from "@/lib/ai/prompts/integrated-review";
import type { ReviewSessionSource } from "@/lib/ai/review-input";
import type { StoredReviewPayload } from "@/lib/ai/review-schemas";
import { defaultReviewSettings } from "@/lib/ai/review-schemas";
import { applySqlMigrations } from "@/lib/db/client";
import { countObservations } from "@/lib/db/observation-queries";
import { insertReview } from "@/lib/db/queries";
import * as schema from "@/lib/db/schema";
import {
  projectPersistedReview,
} from "@/lib/observations/project-review";
import {
  processIntegratedReviewSelection,
  resumeIntegratedReviewProjection,
} from "@/lib/reviews/integrated-review-processor";
import {
  countReviewProcessingRuns,
  loadReviewProcessingRunByReviewId,
} from "@/lib/reviews/review-run-store";
import { classifyExactReviewSelectionState } from "@/lib/reviews/review-selection-state";
import {
  INTEGRATED_REVIEW_PROCESSING_VERSION,
  INTEGRATED_REVIEW_PROCESSING_VERSION_V1,
} from "@/lib/reviews/review-run-types";

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

function semanticPayload(valid: boolean): StoredReviewPayload {
  return {
    ...emptyPayload(),
    commonThemes: [
      {
        text: "synthetic theme",
        evidence: [],
        semanticValid: valid,
        invalidReason: valid ? null : "invalid_evidence_ref",
        guardType: "hard",
      },
    ],
  };
}

function seedReviewWithRun(input: {
  db: ReturnType<typeof openMemoryDb>;
  reviewId: string;
  payload: StoredReviewPayload | string;
  processingVersion: string;
  phase: "review_saved" | "projection_done";
}) {
  const payload =
    typeof input.payload === "string"
      ? input.payload
      : JSON.stringify(input.payload);
  input.db.insert(schema.reviews).values({
    id: input.reviewId,
    title: input.reviewId,
    model: "test",
    promptVersion: INTEGRATED_REVIEW_PROMPT_V5,
    payload,
    createdAt: "2026-08-18T00:00:00.000Z",
  }).run();
  input.db.insert(schema.reviewSessions).values([
    { reviewId: input.reviewId, sessionId: "s-a" },
    { reviewId: input.reviewId, sessionId: "s-b" },
  ]).run();
  input.db.insert(schema.reviewProcessingRuns).values({
    runId: `run-${input.reviewId}`,
    reviewId: input.reviewId,
    processingVersion: input.processingVersion,
    phase: input.phase,
    projectedObservationCount:
      input.phase === "projection_done" ? 0 : null,
    lastFailureStage: null,
    lastFailureCode: null,
    createdAt: "2026-08-18T00:00:00.000Z",
    updatedAt: "2026-08-18T00:00:00.000Z",
  }).run();
}

function reviewSources(): ReviewSessionSource[] {
  return ["s-a", "s-b"].map((id, index) => ({
    session: {
      id,
      title: id,
      occurredAt: `2026-08-${String(index + 1).padStart(2, "0")}`,
      source: "chatgpt",
      category: "test",
      createdAt: `2026-08-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
    },
    messages: [
      {
        id: `message-${id}`,
        index: 0,
        role: "user",
        content: `Synthetic evidence for ${id}.`,
        attachmentsJson: null,
      },
    ],
    analysis: null,
  }));
}

async function withReviewEnv(run: () => Promise<void>) {
  const previous = {
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.AI_MODEL,
    provider: process.env.AI_PROVIDER,
  };
  process.env.OPENAI_API_KEY = "sk-test-not-used";
  process.env.AI_MODEL = "test-model";
  process.env.AI_PROVIDER = "openai";
  try {
    await run();
  } finally {
    if (previous.apiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previous.apiKey;
    if (previous.model === undefined) delete process.env.AI_MODEL;
    else process.env.AI_MODEL = previous.model;
    if (previous.provider === undefined) delete process.env.AI_PROVIDER;
    else process.env.AI_PROVIDER = previous.provider;
  }
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

test("all-invalid v2 generation reports one LLM call and creates no durable Review", async () => {
  await withReviewEnv(async () => {
    const db = openMemoryDb();
    seedSession(db, "s-a");
    seedSession(db, "s-b");

    const result = await processIntegratedReviewSelection(
      reviewSources(),
      "synthetic",
      {
        db,
        generateStructured: async (request) => {
          assert.equal(request.schemaName, "integrated_review_v8");
          assert.match(request.user, /正確に 1 文字/);
          return {
            parsed: {
              summary: "summary",
              commonThemes: [
                {
                  text: "candidate",
                  relationType: "repetition",
                  evidenceGroups: [
                    { sessionRef: "S01", evidenceAliases: ["Z"] },
                  ],
                  evidenceAliases: ["Z"],
                },
              ],
              shifts: [],
              tensions: [],
              crossInsights: [],
              hypotheses: [],
              openQuestions: [],
              nextQuestions: [],
            },
            model: "test-model",
          };
        },
      },
    );

    assert.equal(result.status, "failed");
    assert.equal(result.executionMode, "fresh");
    assert.equal(result.reason, "evidence_validation_failed");
    assert.equal(result.code, "all_review_evidence_invalid");
    assert.equal(result.llmCalls, 1);
    assert.equal(result.reviewId, null);
    assert.equal(
      result.groundingDiagnostic?.aliasDiagnostics.exactMemberCount,
      0,
    );
    assert.equal(result.groundingDiagnostic?.usableValidatedEvidenceCount, 0);
    assert.equal(db.select().from(schema.reviews).all().length, 0);
    assert.equal(db.select().from(schema.reviewProcessingRuns).all().length, 0);
    assert.equal(db.select().from(schema.evidences).all().length, 0);
    assert.equal(db.select().from(schema.observations).all().length, 0);
  });
});

test("legacy completion predicate reopens only the conservative false signature", () => {
  const db = openMemoryDb();
  seedSession(db, "s-a");
  seedSession(db, "s-b");
  seedReviewWithRun({
    db,
    reviewId: "r-false",
    payload: semanticPayload(false),
    processingVersion: INTEGRATED_REVIEW_PROCESSING_VERSION_V1,
    phase: "projection_done",
  });

  const state = classifyExactReviewSelectionState(db, ["s-b", "s-a"]);
  assert.deepEqual(state.exactCompletedReviewIds, []);
  assert.deepEqual(state.exactPendingReviewIds, []);
  assert.deepEqual(state.exactLegacyUnknownReviewIds, []);
});

test("legacy grounded, genuine-empty, and ambiguous completions remain completed", () => {
  const db = openMemoryDb();
  seedSession(db, "s-a");
  seedSession(db, "s-b");
  seedReviewWithRun({
    db,
    reviewId: "r-grounded",
    payload: semanticPayload(true),
    processingVersion: INTEGRATED_REVIEW_PROCESSING_VERSION_V1,
    phase: "projection_done",
  });
  seedReviewWithRun({
    db,
    reviewId: "r-empty",
    payload: emptyPayload(),
    processingVersion: INTEGRATED_REVIEW_PROCESSING_VERSION_V1,
    phase: "projection_done",
  });
  seedReviewWithRun({
    db,
    reviewId: "r-ambiguous",
    payload: "not-json",
    processingVersion: INTEGRATED_REVIEW_PROCESSING_VERSION_V1,
    phase: "projection_done",
  });

  const state = classifyExactReviewSelectionState(db, ["s-a", "s-b"]);
  assert.deepEqual(state.exactCompletedReviewIds, [
    "r-ambiguous",
    "r-empty",
    "r-grounded",
  ]);
});

test("bad v1 plus valid v2 resolves deterministically to current completion", () => {
  const db = openMemoryDb();
  seedSession(db, "s-a");
  seedSession(db, "s-b");
  seedReviewWithRun({
    db,
    reviewId: "r-z-bad-v1",
    payload: semanticPayload(false),
    processingVersion: INTEGRATED_REVIEW_PROCESSING_VERSION_V1,
    phase: "projection_done",
  });
  seedReviewWithRun({
    db,
    reviewId: "r-a-good-v2",
    payload: emptyPayload(),
    processingVersion: INTEGRATED_REVIEW_PROCESSING_VERSION,
    phase: "projection_done",
  });

  const state = classifyExactReviewSelectionState(db, ["s-b", "s-a"]);
  assert.deepEqual(state.exactCompletedReviewIds, ["r-a-good-v2"]);
});

test("historical v1 review_saved recovery remains LLM-free after v2 bump", async () => {
  const db = openMemoryDb();
  seedSession(db, "s-a");
  seedSession(db, "s-b");
  seedReviewWithRun({
    db,
    reviewId: "r-v1-pending",
    payload: emptyPayload(),
    processingVersion: INTEGRATED_REVIEW_PROCESSING_VERSION_V1,
    phase: "review_saved",
  });

  const result = await resumeIntegratedReviewProjection(
    { reviewId: "r-v1-pending" },
    { db },
  );
  assert.equal(result.status, "completed");
  assert.equal(result.llmCalls, 0);
  const run = db
    .select()
    .from(schema.reviewProcessingRuns)
    .all()
    .find((row) => row.reviewId === "r-v1-pending");
  assert.equal(run?.processingVersion, INTEGRATED_REVIEW_PROCESSING_VERSION_V1);
  assert.equal(run?.phase, "projection_done");
});

test("new successful Review metadata targets prompt v8 and processing v2", () => {
  const db = openMemoryDb();
  seedSession(db, "s-a");
  seedSession(db, "s-b");
  const record = insertReview(
    {
      title: "v2",
      model: "test",
      promptVersion: INTEGRATED_REVIEW_PROMPT_V8,
      payload: emptyPayload(),
      sessionIds: ["s-a", "s-b"],
      evidences: [],
    },
    db,
  );
  const run = loadReviewProcessingRunByReviewId({ reviewId: record.id, db });
  assert.equal(run?.processingVersion, INTEGRATED_REVIEW_PROCESSING_VERSION);
});
