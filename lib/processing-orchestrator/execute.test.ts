import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { CONCEPT_EXTRACT_PROMPT_VERSION } from "@/lib/ai/prompts/concept-extract";
import { hashSourceArtifactText } from "@/lib/concepts/admission/apply-manifest";
import { CONCEPT_INCREMENTAL_PROCESSING_VERSION } from "@/lib/concepts/incremental/checkpoint";
import { loadInitialConceptProcessingCoverage } from "@/lib/concepts/incremental/eligibility";
import type { IncrementalConceptSessionProcessorResult } from "@/lib/concepts/incremental/session-processor";
import { INCREMENTAL_CONCEPT_SESSION_PROCESSOR_VERSION } from "@/lib/concepts/incremental/session-processor";
import { CONCEPT_EXTRACTION_VERSION } from "@/lib/concepts/types";
import { applySqlMigrations } from "@/lib/db/client";
import * as schema from "@/lib/db/schema";
import type { IntegratedReviewProcessingResult } from "@/lib/reviews/integrated-review-processor";
import {
  DUAL_PIPELINE_ORCHESTRATOR_EXECUTE_HELP,
  parseDualPipelineOrchestratorExecuteArgs,
} from "./execute-args";
import { executeDualPipelineProcessing } from "./execute";
import { DUAL_PIPELINE_ORCHESTRATOR_EXECUTION_VERSION } from "./execution-types";
import { loadDualPipelineOrchestratorPlan } from "./load";

const USER_QUOTE = "SECRET_USER_QUOTE_executor";

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
}

function seedReviewRun(
  db: ReturnType<typeof openMemoryDb>,
  input: {
    reviewId: string;
    phase: "review_saved" | "projection_done";
    sessionIds: string[];
  },
) {
  db.insert(schema.reviews)
    .values({
      id: input.reviewId,
      title: input.reviewId,
      model: "test",
      promptVersion: "integrated-review-v5",
      payload: "{}",
      createdAt: "2026-08-18T00:00:00.000Z",
    })
    .run();
  db.insert(schema.reviewSessions)
    .values(
      input.sessionIds.map((sessionId) => ({
        reviewId: input.reviewId,
        sessionId,
      })),
    )
    .run();
  db.insert(schema.reviewProcessingRuns)
    .values({
      runId: `run-${input.reviewId}`,
      reviewId: input.reviewId,
      processingVersion: "integrated-review-processing-v1",
      phase: input.phase,
      projectedObservationCount: input.phase === "projection_done" ? 0 : null,
      lastFailureStage: null,
      lastFailureCode: null,
      createdAt: "2026-08-18T00:00:00.000Z",
      updatedAt: "2026-08-18T00:00:00.000Z",
    })
    .run();
}

function candidateReport(selectedSessionIds: string[]) {
  return {
    metadata: {
      promptVersion: CONCEPT_EXTRACT_PROMPT_VERSION,
      extractionVersion: CONCEPT_EXTRACTION_VERSION,
      selectedSessionIds,
    },
    concepts: [],
    actions: selectedSessionIds.map((sessionId) => ({
      sessionId,
      evidenceRef: "M001:E01",
      originalAction: "skip",
    })),
    failedSessions: [],
  };
}

function coverageFor(sessionIds: string[]) {
  const text = JSON.stringify(candidateReport(sessionIds));
  return loadInitialConceptProcessingCoverage({
    candidateReportText: text,
    expectedSourceHash: hashSourceArtifactText(text),
  });
}

function conceptResult(
  sessionId: string,
  status: IncrementalConceptSessionProcessorResult["status"],
  overrides: Partial<IncrementalConceptSessionProcessorResult> = {},
): IncrementalConceptSessionProcessorResult {
  return {
    version: INCREMENTAL_CONCEPT_SESSION_PROCESSOR_VERSION,
    processingVersion: CONCEPT_INCREMENTAL_PROCESSING_VERSION,
    sessionId,
    status,
    reason: overrides.reason ?? null,
    executionMode: overrides.executionMode ?? "fresh",
    runId: overrides.runId ?? null,
    resumedFromPhase: null,
    eligibility: { status: "eligible", reason: null },
    planning: {
      status: null,
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
    extractionCalls: overrides.extractionCalls ?? (status === "completed" ? 1 : 0),
    assessmentCalls: overrides.assessmentCalls ?? 0,
    stageOrder: [],
    ...overrides,
  };
}

function reviewResult(
  overrides: Partial<IntegratedReviewProcessingResult> = {},
): IntegratedReviewProcessingResult {
  return {
    status: "completed",
    executionMode: "fresh",
    reviewId: "review-1",
    llmCalls: 1,
    reason: null,
    code: null,
    projection: {
      status: "projected",
      observationCount: 0,
      code: null,
    },
    relationReconciliation: null,
    ...overrides,
  };
}

function makeConceptStub(
  results: Record<string, IncrementalConceptSessionProcessorResult>,
) {
  const calls: string[] = [];
  const fn = async (input: { sessionId: string }) => {
    calls.push(input.sessionId);
    return results[input.sessionId] ?? conceptResult(input.sessionId, "completed");
  };
  return { fn, calls };
}

test("empty selection is blocked with zero calls", async () => {
  const db = openMemoryDb();
  let conceptCalls = 0;
  let reviewCalls = 0;
  const result = await executeDualPipelineProcessing(
    { sessionIds: [] },
    {
      db,
      initialCoverage: coverageFor([]),
      processConceptSession: async () => {
        conceptCalls += 1;
        return conceptResult("s-a", "completed");
      },
      processReviewSelection: async () => {
        reviewCalls += 1;
        return reviewResult();
      },
    },
  );
  assert.equal(result.status, "blocked");
  assert.equal(result.reason, "no_selection");
  assert.equal(conceptCalls, 0);
  assert.equal(reviewCalls, 0);
  assert.equal(result.summary.reviewLlmCalls, 0);
});

test("invalid selection blocks all primary stages", async () => {
  const db = openMemoryDb();
  seedSession(db, "s-a");
  let conceptCalls = 0;
  let reviewCalls = 0;
  const result = await executeDualPipelineProcessing(
    { sessionIds: ["s-a", "missing-id"] },
    {
      db,
      initialCoverage: coverageFor(["s-a"]),
      processConceptSession: async () => {
        conceptCalls += 1;
        return conceptResult("s-a", "completed");
      },
      processReviewSelection: async () => {
        reviewCalls += 1;
        return reviewResult();
      },
    },
  );
  assert.equal(result.status, "blocked");
  assert.equal(result.reason, "invalid_session_selection");
  assert.deepEqual(result.selection.invalidSessionIds, ["missing-id"]);
  assert.equal(conceptCalls, 0);
  assert.equal(reviewCalls, 0);
});

test("concept processor call order is deterministic by sessionId ASC", async () => {
  const db = openMemoryDb();
  for (const id of ["s-3", "s-1", "s-2"]) {
    seedSession(db, id);
  }
  const conceptStub = makeConceptStub({
    "s-1": conceptResult("s-1", "completed"),
    "s-2": conceptResult("s-2", "completed"),
    "s-3": conceptResult("s-3", "completed"),
  });
  await executeDualPipelineProcessing(
    { sessionIds: ["s-3", "s-1", "s-2"] },
    {
      db,
      initialCoverage: coverageFor([]),
      processConceptSession: conceptStub.fn,
      processReviewSelection: async () => reviewResult({ llmCalls: 0 }),
    },
  );
  assert.deepEqual(conceptStub.calls, ["s-1", "s-2", "s-3"]);
});

test("covered concept sessions are skipped", async () => {
  const db = openMemoryDb();
  seedSession(db, "s-a");
  seedSession(db, "s-b");
  const conceptStub = makeConceptStub({});
  const result = await executeDualPipelineProcessing(
    { sessionIds: ["s-a", "s-b"] },
    {
      db,
      initialCoverage: coverageFor(["s-a", "s-b"]),
      processConceptSession: conceptStub.fn,
      processReviewSelection: async () => reviewResult({ llmCalls: 0 }),
    },
  );
  assert.equal(conceptStub.calls.length, 0);
  assert.equal(result.concept.sessions.every((row) => row.action === "not_needed"), true);
  assert.equal(result.summary.conceptExecutedCount, 0);
});

test("concept failure does not stop other concept sessions or review", async () => {
  const db = openMemoryDb();
  seedSession(db, "s-a");
  seedSession(db, "s-b");
  let reviewCalls = 0;
  const result = await executeDualPipelineProcessing(
    { sessionIds: ["s-a", "s-b"] },
    {
      db,
      initialCoverage: coverageFor([]),
      processConceptSession: async (input) =>
        input.sessionId === "s-a"
          ? conceptResult("s-a", "failed", {
              reason: "fixture_reason",
              executionMode: "fresh",
              extractionCalls: 1,
              assessmentCalls: 0,
              stageOrder: ["eligibility", "extraction", "new_primary"],
              newPrimary: {
                status: "failed",
                conceptsCreated: 0,
                occurrencesCreated: 0,
                aliasesCreated: 0,
                code: "fixture_code",
              },
            })
          : conceptResult("s-b", "completed"),
      processReviewSelection: async () => {
        reviewCalls += 1;
        return reviewResult();
      },
    },
  );
  assert.equal(result.status, "partial");
  assert.equal(result.concept.sessions[0]?.processorReason, "fixture_reason");
  assert.deepEqual(result.concept.sessions[0]?.failureDiagnostic, {
    failureStage: "new_primary",
    failureReason: "fixture_reason",
    failureCode: "fixture_code",
    extractionCalls: 1,
    assessmentCalls: 0,
  });
  assert.equal(result.concept.sessions[1]?.processorStatus, "completed");
  assert.equal(result.concept.sessions[1]?.failureDiagnostic, null);
  assert.equal(reviewCalls, 1);
  assert.equal(result.review.processorStatus, "completed");
});

test("concept failure diagnostics do not invent or expose unsafe tokens", async () => {
  const db = openMemoryDb();
  seedSession(db, "s-a");
  const result = await executeDualPipelineProcessing(
    { sessionIds: ["s-a"] },
    {
      db,
      initialCoverage: coverageFor([]),
      processConceptSession: async () =>
        conceptResult("s-a", "failed", {
          reason: USER_QUOTE,
          extractionCalls: 1,
          stageOrder: [],
        }),
    },
  );

  assert.deepEqual(result.concept.sessions[0]?.failureDiagnostic, {
    failureStage: null,
    failureReason: null,
    failureCode: null,
    extractionCalls: 1,
    assessmentCalls: 0,
  });
});

test("one session executes concept and blocks review minimum", async () => {
  const db = openMemoryDb();
  seedSession(db, "s-a");
  let reviewCalls = 0;
  const result = await executeDualPipelineProcessing(
    { sessionIds: ["s-a"] },
    {
      db,
      initialCoverage: coverageFor([]),
      processConceptSession: async () => conceptResult("s-a", "completed"),
      processReviewSelection: async () => {
        reviewCalls += 1;
        return reviewResult();
      },
    },
  );
  assert.equal(result.summary.conceptExecutedCount, 1);
  assert.equal(reviewCalls, 0);
  assert.equal(result.review.resolvedAction, "blocked");
  assert.equal(result.review.blockingReason, "review_requires_at_least_two_sessions");
  assert.equal(result.status, "partial");
});

test("exact completed review is not_needed with zero LLM", async () => {
  const db = openMemoryDb();
  seedSession(db, "s-a");
  seedSession(db, "s-b");
  seedReviewRun(db, {
    reviewId: "r-done",
    phase: "projection_done",
    sessionIds: ["s-a", "s-b"],
  });
  let reviewCalls = 0;
  const result = await executeDualPipelineProcessing(
    { sessionIds: ["s-a", "s-b"] },
    {
      db,
      initialCoverage: coverageFor(["s-a", "s-b"]),
      processConceptSession: async () => conceptResult("s-a", "completed"),
      processReviewSelection: async () => {
        reviewCalls += 1;
        return reviewResult();
      },
    },
  );
  assert.equal(reviewCalls, 0);
  assert.equal(result.review.resolvedAction, "not_needed");
  assert.equal(result.summary.reviewLlmCalls, 0);
  assert.equal(result.status, "completed");
});

test("exact pending review resumes with zero LLM", async () => {
  const db = openMemoryDb();
  seedSession(db, "s-a");
  seedSession(db, "s-b");
  seedReviewRun(db, {
    reviewId: "r-pending",
    phase: "review_saved",
    sessionIds: ["s-a", "s-b"],
  });
  let freshCalls = 0;
  let resumeCalls = 0;
  const result = await executeDualPipelineProcessing(
    { sessionIds: ["s-a", "s-b"] },
    {
      db,
      initialCoverage: coverageFor(["s-a", "s-b"]),
      processConceptSession: async () => conceptResult("s-a", "completed"),
      processReviewSelection: async () => {
        freshCalls += 1;
        return reviewResult();
      },
      resumeReviewProjection: async () => {
        resumeCalls += 1;
        return reviewResult({ executionMode: "resumed", llmCalls: 0 });
      },
    },
  );
  assert.equal(freshCalls, 0);
  assert.equal(resumeCalls, 1);
  assert.equal(result.review.resolvedAction, "resume_projection");
  assert.equal(result.summary.reviewLlmCalls, 0);
});

test("review projection failure is not retried in same invocation", async () => {
  const db = openMemoryDb();
  seedSession(db, "s-a");
  seedSession(db, "s-b");
  let freshCalls = 0;
  let resumeCalls = 0;
  const result = await executeDualPipelineProcessing(
    { sessionIds: ["s-a", "s-b"] },
    {
      db,
      initialCoverage: coverageFor([]),
      processConceptSession: async () => conceptResult("s-a", "completed"),
      processReviewSelection: async () => {
        freshCalls += 1;
        return reviewResult({
          status: "projection_failed",
          reviewId: "r-failed",
          llmCalls: 1,
        });
      },
      resumeReviewProjection: async () => {
        resumeCalls += 1;
        return reviewResult({ executionMode: "resumed", llmCalls: 0 });
      },
    },
  );
  assert.equal(freshCalls, 1);
  assert.equal(resumeCalls, 0);
  assert.equal(result.review.processorStatus, "projection_failed");
  assert.equal(result.review.reviewId, "r-failed");
  assert.equal(result.status, "partial");
});

test("review race: completed before stage avoids duplicate fresh review", async () => {
  const db = openMemoryDb();
  seedSession(db, "s-a");
  seedSession(db, "s-b");
  let freshCalls = 0;
  const result = await executeDualPipelineProcessing(
    { sessionIds: ["s-a", "s-b"] },
    {
      db,
      initialCoverage: coverageFor([]),
      processConceptSession: async () => conceptResult("s-a", "completed"),
      onAfterConceptStage: () => {
        seedReviewRun(db, {
          reviewId: "r-race-done",
          phase: "projection_done",
          sessionIds: ["s-a", "s-b"],
        });
      },
      processReviewSelection: async () => {
        freshCalls += 1;
        return reviewResult();
      },
    },
  );
  assert.equal(freshCalls, 0);
  assert.equal(result.review.resolvedAction, "not_needed");
  assert.equal(result.summary.reviewLlmCalls, 0);
});

test("review race: pending before stage resumes instead of fresh", async () => {
  const db = openMemoryDb();
  seedSession(db, "s-a");
  seedSession(db, "s-b");
  let freshCalls = 0;
  let resumeCalls = 0;
  const result = await executeDualPipelineProcessing(
    { sessionIds: ["s-a", "s-b"] },
    {
      db,
      initialCoverage: coverageFor([]),
      processConceptSession: async () => conceptResult("s-a", "completed"),
      onAfterConceptStage: () => {
        seedReviewRun(db, {
          reviewId: "r-race-pending",
          phase: "review_saved",
          sessionIds: ["s-a", "s-b"],
        });
      },
      processReviewSelection: async () => {
        freshCalls += 1;
        return reviewResult();
      },
      resumeReviewProjection: async () => {
        resumeCalls += 1;
        return reviewResult({ executionMode: "resumed", llmCalls: 0 });
      },
    },
  );
  assert.equal(freshCalls, 0);
  assert.equal(resumeCalls, 1);
  assert.equal(result.review.resolvedAction, "resume_projection");
});

test("second execution is idempotent with zero LLM", async () => {
  const db = openMemoryDb();
  seedSession(db, "s-a");
  seedSession(db, "s-b");
  seedReviewRun(db, {
    reviewId: "r-done",
    phase: "projection_done",
    sessionIds: ["s-a", "s-b"],
  });
  const deps = {
    db,
    initialCoverage: coverageFor(["s-a", "s-b"]),
    processConceptSession: async (input: { sessionId: string }) =>
      conceptResult(input.sessionId, "completed", { extractionCalls: 1 }),
    processReviewSelection: async () => reviewResult({ llmCalls: 1 }),
  };
  const first = await executeDualPipelineProcessing({ sessionIds: ["s-a", "s-b"] }, deps);
  assert.equal(first.status, "completed");
  const conceptCalls: string[] = [];
  let reviewCalls = 0;
  const second = await executeDualPipelineProcessing(
    { sessionIds: ["s-a", "s-b"] },
    {
      ...deps,
      processConceptSession: async (input) => {
        conceptCalls.push(input.sessionId);
        return conceptResult(input.sessionId, "completed", { extractionCalls: 1 });
      },
      processReviewSelection: async () => {
        reviewCalls += 1;
        return reviewResult({ llmCalls: 1 });
      },
    },
  );
  assert.equal(second.status, "completed");
  assert.equal(conceptCalls.length, 0);
  assert.equal(reviewCalls, 0);
  assert.equal(second.summary.conceptExtractionCalls, 0);
  assert.equal(second.summary.reviewLlmCalls, 0);
});

test("execution result does not include USER text", async () => {
  const db = openMemoryDb();
  seedSession(db, "s-a");
  seedSession(db, "s-b");
  const result = await executeDualPipelineProcessing(
    { sessionIds: ["s-a", "s-b"] },
    {
      db,
      initialCoverage: coverageFor(["s-a", "s-b"]),
      processConceptSession: async () => conceptResult("s-a", "completed"),
      processReviewSelection: async () => reviewResult({ llmCalls: 0 }),
    },
  );
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, new RegExp(USER_QUOTE));
  assert.doesNotMatch(serialized, /surfaceForm/);
  assert.equal(result.version, DUAL_PIPELINE_ORCHESTRATOR_EXECUTION_VERSION);
});

test("execute CLI rejects without --apply", () => {
  const parsed = parseDualPipelineOrchestratorExecuteArgs(["--session", "s-a"]);
  assert.equal(parsed.ok, false);
  if (!parsed.ok) {
    assert.equal(parsed.code, "explicit_apply_required");
  }
});

test("execute CLI rejects missing --session", () => {
  const parsed = parseDualPipelineOrchestratorExecuteArgs(["--apply"]);
  assert.equal(parsed.ok, false);
  if (!parsed.ok) {
    assert.equal(parsed.code, "missing_session");
  }
});

test("execute CLI help is available", () => {
  const parsed = parseDualPipelineOrchestratorExecuteArgs(["--help"]);
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.help, true);
  }
  assert.match(DUAL_PIPELINE_ORCHESTRATOR_EXECUTE_HELP, /--apply/);
});

test("legacy exact review is blocked without fresh LLM", async () => {
  const db = openMemoryDb();
  seedSession(db, "s-a");
  seedSession(db, "s-b");
  db.insert(schema.reviews)
    .values({
      id: "legacy-r",
      title: "legacy",
      model: "test",
      promptVersion: "integrated-review-v5",
      payload: "{}",
      createdAt: "2026-08-18T00:00:00.000Z",
    })
    .run();
  db.insert(schema.reviewSessions)
    .values([
      { reviewId: "legacy-r", sessionId: "s-a" },
      { reviewId: "legacy-r", sessionId: "s-b" },
    ])
    .run();
  let freshCalls = 0;
  const result = await executeDualPipelineProcessing(
    { sessionIds: ["s-a", "s-b"] },
    {
      db,
      initialCoverage: coverageFor(["s-a", "s-b"]),
      processConceptSession: async () => conceptResult("s-a", "completed"),
      processReviewSelection: async () => {
        freshCalls += 1;
        return reviewResult();
      },
    },
  );
  assert.equal(freshCalls, 0);
  assert.equal(result.review.resolvedAction, "blocked");
  assert.equal(result.review.blockingReason, "legacy_review_completion_unknown");
});

test("ambiguous pending exact reviews are blocked", async () => {
  const db = openMemoryDb();
  seedSession(db, "s-a");
  seedSession(db, "s-b");
  seedReviewRun(db, {
    reviewId: "r-p1",
    phase: "review_saved",
    sessionIds: ["s-a", "s-b"],
  });
  seedReviewRun(db, {
    reviewId: "r-p2",
    phase: "review_saved",
    sessionIds: ["s-a", "s-b"],
  });
  let freshCalls = 0;
  let resumeCalls = 0;
  const result = await executeDualPipelineProcessing(
    { sessionIds: ["s-a", "s-b"] },
    {
      db,
      initialCoverage: coverageFor(["s-a", "s-b"]),
      processConceptSession: async () => conceptResult("s-a", "completed"),
      processReviewSelection: async () => {
        freshCalls += 1;
        return reviewResult();
      },
      resumeReviewProjection: async () => {
        resumeCalls += 1;
        return reviewResult({ executionMode: "resumed", llmCalls: 0 });
      },
    },
  );
  assert.equal(freshCalls, 0);
  assert.equal(resumeCalls, 0);
  assert.equal(result.review.blockingReason, "ambiguous_pending_reviews");
});

test("stale concept plan yields already_covered inside processor", async () => {
  const db = openMemoryDb();
  seedSession(db, "s-a");
  let processorCalls = 0;
  const result = await executeDualPipelineProcessing(
    { sessionIds: ["s-a"] },
    {
      db,
      initialCoverage: coverageFor([]),
      onBeforeConceptSession: () => {
        db.insert(schema.conceptProcessingCheckpoints)
          .values({
            sessionId: "s-a",
            processingVersion: CONCEPT_INCREMENTAL_PROCESSING_VERSION,
            completedAt: "2026-08-18T00:00:00.000Z",
            existingMatchCount: 0,
            newCandidateCount: 0,
            provisionalNewCount: 0,
            groundingRejectedCount: 0,
          })
          .run();
      },
      processConceptSession: async () => {
        processorCalls += 1;
        return conceptResult("s-a", "already_covered", {
          executionMode: null,
          extractionCalls: 0,
        });
      },
      processReviewSelection: async () => reviewResult({ llmCalls: 0 }),
    },
  );
  assert.equal(processorCalls, 1);
  assert.equal(result.concept.sessions[0]?.processorStatus, "already_covered");
  assert.equal(result.summary.conceptExtractionCalls, 0);
});

test("fresh plan is loaded on each executor invocation", async () => {
  const db = openMemoryDb();
  seedSession(db, "s-a");
  seedSession(db, "s-b");
  let planLoads = 0;
  const result = await executeDualPipelineProcessing(
    { sessionIds: ["s-a", "s-b"] },
    {
      db,
      initialCoverage: coverageFor([]),
      loadPlan: (input) => {
        planLoads += 1;
        return loadDualPipelineOrchestratorPlan(input);
      },
      processConceptSession: async () => conceptResult("s-a", "completed"),
      processReviewSelection: async () => reviewResult(),
    },
  );
  assert.equal(planLoads, 1);
  assert.equal(result.planVersion, "dual-pipeline-orchestrator-plan-v0");
});
