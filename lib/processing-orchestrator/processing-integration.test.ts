import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { INTEGRATED_REVIEW_PROMPT_V5 } from "@/lib/ai/prompts/integrated-review";
import type { StoredReviewPayload } from "@/lib/ai/review-schemas";
import { defaultReviewSettings } from "@/lib/ai/review-schemas";
import { hashSourceArtifactText } from "@/lib/concepts/admission/apply-manifest";
import type { IncrementalConceptSessionProcessorResult } from "@/lib/concepts/incremental/session-processor";
import { INCREMENTAL_CONCEPT_SESSION_PROCESSOR_VERSION } from "@/lib/concepts/incremental/session-processor";
import { CONCEPT_INCREMENTAL_PROCESSING_VERSION } from "@/lib/concepts/incremental/checkpoint";
import { loadInitialConceptProcessingCoverage } from "@/lib/concepts/incremental/eligibility";
import { CONCEPT_EXTRACTION_VERSION } from "@/lib/concepts/types";
import { applySqlMigrations } from "@/lib/db/client";
import { countObservations } from "@/lib/db/observation-queries";
import { insertReview } from "@/lib/db/queries";
import * as schema from "@/lib/db/schema";
import { projectPersistedReview } from "@/lib/observations/project-review";
import { executeDualPipelineProcessing } from "@/lib/processing-orchestrator/execute";
import {
  countReviewProcessingRuns,
  loadReviewProcessingRunByReviewId,
} from "@/lib/reviews/review-run-store";
import {
  resumeIntegratedReviewProjection,
} from "@/lib/reviews/integrated-review-processor";

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
      id: `m-${id}`,
      sessionId: id,
      index: 0,
      role: "user",
      content: "sample content for review projection",
      charStart: 0,
      charEnd: 10,
      sourceMessageId: null,
      sourceCreatedAt: null,
      contentType: "text",
      attachmentsJson: null,
    })
    .run();
}

function coverageFor(sessionIds: string[]) {
  const text = JSON.stringify({
    metadata: {
      promptVersion: "concept-extract-prompt-v4",
      extractionVersion: CONCEPT_EXTRACTION_VERSION,
      selectedSessionIds: sessionIds,
    },
    concepts: [],
    actions: sessionIds.map((sessionId) => ({
      sessionId,
      evidenceRef: "M001:E01",
      originalAction: "skip",
    })),
    failedSessions: [],
  });
  return loadInitialConceptProcessingCoverage({
    candidateReportText: text,
    expectedSourceHash: hashSourceArtifactText(text),
  });
}

function emptyReviewPayload(): StoredReviewPayload {
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

function completedConcept(sessionId: string): IncrementalConceptSessionProcessorResult {
  return {
    version: INCREMENTAL_CONCEPT_SESSION_PROCESSOR_VERSION,
    processingVersion: CONCEPT_INCREMENTAL_PROCESSING_VERSION,
    sessionId,
    status: "completed",
    reason: null,
    executionMode: "fresh",
    runId: null,
    resumedFromPhase: null,
    eligibility: { status: "eligible", reason: null },
    planning: {
      status: null,
      failureCode: null,
      existingMatchCount: 0,
      newCandidateCount: 0,
      provisionalNewCount: 0,
      groundingRejectedCount: 0,
    },
    existingPrimary: {
      status: "skipped",
      occurrencesCreated: 0,
      alreadyPresent: 0,
      code: null,
    },
    newPrimary: {
      status: "skipped",
      conceptsCreated: 0,
      occurrencesCreated: 0,
      aliasesCreated: 0,
      code: null,
    },
    checkpoint: { status: "completed", code: null },
    relationReconciliation: { existing: null, new: null, warnings: [] },
    frozenExistingIntentUsed: false,
    frozenNewIntentUsed: false,
    newAssessmentAttempted: false,
    retryAttempted: false,
    extractionCalls: 1,
    assessmentCalls: 0,
    stageOrder: [],
  };
}

test("integration: first execution creates review run and second is LLM-free", async () => {
  const db = openMemoryDb();
  seedSession(db, "s-a");
  seedSession(db, "s-b");
  const coverage = coverageFor(["s-a", "s-b"]);
  let reviewFreshCalls = 0;

  const first = await executeDualPipelineProcessing(
    { sessionIds: ["s-a", "s-b"] },
    {
      db,
      initialCoverage: coverage,
      processConceptSession: async (input) => ({
        ...completedConcept(input.sessionId),
        status: "already_covered",
        extractionCalls: 0,
      }),
      processReviewSelection: async (sources, title, deps) => {
        reviewFreshCalls += 1;
        const record = insertReview(
          {
            title,
            model: "test",
            promptVersion: INTEGRATED_REVIEW_PROMPT_V5,
            payload: emptyReviewPayload(),
            sessionIds: sources.map((source) => source.session.id),
            evidences: [],
          },
          deps.db ?? db,
        );
        projectPersistedReview({ reviewId: record.id, db: deps.db ?? db });
        return {
          status: "completed",
          executionMode: "fresh",
          reviewId: record.id,
          llmCalls: 1,
          reason: null,
          code: null,
          projection: {
            status: "projected",
            observationCount: 0,
            code: null,
          },
          relationReconciliation: null,
        };
      },
    },
  );

  assert.equal(first.status, "completed");
  assert.equal(reviewFreshCalls, 1);
  assert.equal(countReviewProcessingRuns(db), 1);
  assert.equal(db.select().from(schema.reviewProcessingRuns).all()[0]!.phase, "projection_done");
  assert.equal(countObservations(db), 0);

  reviewFreshCalls = 0;
  const second = await executeDualPipelineProcessing(
    { sessionIds: ["s-a", "s-b"] },
    {
      db,
      initialCoverage: coverage,
      processConceptSession: async (input) => ({
        ...completedConcept(input.sessionId),
        status: "already_covered",
        extractionCalls: 0,
      }),
      processReviewSelection: async () => {
        reviewFreshCalls += 1;
        throw new Error("fresh review must not run");
      },
    },
  );

  assert.equal(second.status, "completed");
  assert.equal(reviewFreshCalls, 0);
  assert.equal(second.summary.conceptExtractionCalls, 0);
  assert.equal(second.summary.reviewLlmCalls, 0);
  assert.equal(countReviewProcessingRuns(db), 1);
});

test("integration: review projection failure then second execution resumes with LLM 0", async () => {
  const db = openMemoryDb();
  seedSession(db, "s-a");
  seedSession(db, "s-b");
  const coverage = coverageFor(["s-a", "s-b"]);
  let reviewFreshCalls = 0;
  let reviewId = "";

  const first = await executeDualPipelineProcessing(
    { sessionIds: ["s-a", "s-b"] },
    {
      db,
      initialCoverage: coverage,
      processConceptSession: async (input) => ({
        ...completedConcept(input.sessionId),
        status: "already_covered",
        extractionCalls: 0,
      }),
      processReviewSelection: async (sources, title, deps) => {
        reviewFreshCalls += 1;
        const record = insertReview(
          {
            title,
            model: "test",
            promptVersion: INTEGRATED_REVIEW_PROMPT_V5,
            payload: emptyReviewPayload(),
            sessionIds: sources.map((source) => source.session.id),
            evidences: [],
          },
          deps.db ?? db,
        );
        reviewId = record.id;
        return {
          status: "projection_failed",
          executionMode: "fresh",
          reviewId: record.id,
          llmCalls: 1,
          reason: "projection_failed",
          code: "projection_failed",
          projection: {
            status: "not_run",
            observationCount: 0,
            code: "projection_failed",
          },
          relationReconciliation: null,
        };
      },
    },
  );
  assert.equal(first.review.processorStatus, "projection_failed");
  assert.equal(reviewFreshCalls, 1);
  assert.equal(
    loadReviewProcessingRunByReviewId({ reviewId, db })!.phase,
    "review_saved",
  );

  reviewFreshCalls = 0;
  const second = await executeDualPipelineProcessing(
    { sessionIds: ["s-a", "s-b"] },
    {
      db,
      initialCoverage: coverage,
      processConceptSession: async (input) => ({
        ...completedConcept(input.sessionId),
        status: "already_covered",
        extractionCalls: 0,
      }),
      processReviewSelection: async () => {
        reviewFreshCalls += 1;
        throw new Error("fresh review must not run");
      },
      resumeReviewProjection: (input, deps) =>
        resumeIntegratedReviewProjection(input, deps),
    },
  );

  assert.equal(reviewFreshCalls, 0);
  assert.equal(second.summary.reviewLlmCalls, 0);
  assert.equal(second.review.processorStatus, "completed");
  assert.equal(
    loadReviewProcessingRunByReviewId({ reviewId, db })!.phase,
    "projection_done",
  );
});
