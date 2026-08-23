import assert from "node:assert/strict";
import test from "node:test";
import {
  buildProcessingExecutionPresentation,
  buildProcessingPlanPresentation,
  processingSelectionKey,
} from "./presentation";
import { buildDualPipelineOrchestratorPlan } from "./plan";
import type { DualPipelineOrchestratorPlanInput } from "./types";
import type { DualPipelineOrchestratorExecutionResult } from "./execution-types";
import { DUAL_PIPELINE_ORCHESTRATOR_EXECUTION_VERSION } from "./execution-types";

function emptyInput(): DualPipelineOrchestratorPlanInput {
  return {
    requestedSessionIds: [],
    existingSessionIds: [],
    conceptEvaluations: [],
    reviewSelectionState: {
      exactCompletedReviewIds: [],
      exactPendingReviewIds: [],
      exactLegacyUnknownReviewIds: [],
    },
    reviewCoveredSessionIds: [],
  };
}

test("plan presentation maps concept needs_processing", () => {
  const plan = buildDualPipelineOrchestratorPlan({
    ...emptyInput(),
    requestedSessionIds: ["s-a"],
    existingSessionIds: ["s-a"],
    conceptEvaluations: [
      { sessionId: "s-a", status: "eligible", reason: "not_covered" },
    ],
  });
  const presentation = buildProcessingPlanPresentation({ plan });
  assert.equal(presentation.concept.summary, "更新予定: 1件");
  assert.equal(presentation.concept.sessions[0]?.stateLabel, "更新予定");
  assert.equal(presentation.canExecute, true);
});

test("plan presentation maps review run_for_selection", () => {
  const plan = buildDualPipelineOrchestratorPlan({
    ...emptyInput(),
    requestedSessionIds: ["s-a", "s-b"],
    existingSessionIds: ["s-a", "s-b"],
    conceptEvaluations: [
      { sessionId: "s-a", status: "already_covered", reason: "initial_processing_coverage" },
      { sessionId: "s-b", status: "already_covered", reason: "initial_processing_coverage" },
    ],
  });
  const presentation = buildProcessingPlanPresentation({ plan });
  assert.equal(presentation.review.summary, "新しく観測します");
  assert.equal(presentation.canExecute, true);
});

test("plan presentation maps review resume_projection", () => {
  const plan = buildDualPipelineOrchestratorPlan({
    ...emptyInput(),
    requestedSessionIds: ["s-a", "s-b"],
    existingSessionIds: ["s-a", "s-b"],
    conceptEvaluations: [
      { sessionId: "s-a", status: "already_covered", reason: "initial_processing_coverage" },
      { sessionId: "s-b", status: "already_covered", reason: "initial_processing_coverage" },
    ],
    reviewSelectionState: {
      exactCompletedReviewIds: [],
      exactPendingReviewIds: ["r-pending"],
      exactLegacyUnknownReviewIds: [],
    },
  });
  const presentation = buildProcessingPlanPresentation({ plan });
  assert.equal(
    presentation.review.summary,
    "保存済みの結果から続きを処理します",
  );
});

test("plan presentation maps review minimum sessions for 1 selection", () => {
  const plan = buildDualPipelineOrchestratorPlan({
    ...emptyInput(),
    requestedSessionIds: ["s-a"],
    existingSessionIds: ["s-a"],
    conceptEvaluations: [
      { sessionId: "s-a", status: "eligible", reason: "not_covered" },
    ],
  });
  const presentation = buildProcessingPlanPresentation({ plan });
  assert.match(presentation.review.detail ?? "", /2つ以上/);
  assert.equal(presentation.canExecute, true);
});

test("plan presentation disables execute when all up to date", () => {
  const plan = buildDualPipelineOrchestratorPlan({
    ...emptyInput(),
    requestedSessionIds: ["s-a", "s-b"],
    existingSessionIds: ["s-a", "s-b"],
    conceptEvaluations: [
      { sessionId: "s-a", status: "already_covered", reason: "initial_processing_coverage" },
      { sessionId: "s-b", status: "already_covered", reason: "initial_processing_coverage" },
    ],
    reviewSelectionState: {
      exactCompletedReviewIds: ["r-done"],
      exactPendingReviewIds: [],
      exactLegacyUnknownReviewIds: [],
    },
  });
  const presentation = buildProcessingPlanPresentation({ plan });
  assert.equal(presentation.allUpToDate, true);
  assert.equal(presentation.canExecute, false);
});

test("plan presentation maps legacy review blocked copy", () => {
  const plan = buildDualPipelineOrchestratorPlan({
    ...emptyInput(),
    requestedSessionIds: ["s-a", "s-b"],
    existingSessionIds: ["s-a", "s-b"],
    conceptEvaluations: [
      { sessionId: "s-a", status: "already_covered", reason: "initial_processing_coverage" },
      { sessionId: "s-b", status: "already_covered", reason: "initial_processing_coverage" },
    ],
    reviewSelectionState: {
      exactCompletedReviewIds: [],
      exactPendingReviewIds: [],
      exactLegacyUnknownReviewIds: ["legacy-r"],
    },
  });
  const presentation = buildProcessingPlanPresentation({ plan });
  assert.match(presentation.review.detail ?? "", /以前のレビュー履歴/);
});

test("selection key changes when selection changes", () => {
  assert.notEqual(
    processingSelectionKey(["s-a", "s-b"]),
    processingSelectionKey(["s-a"]),
  );
});

test("execution presentation maps projection_failed recovery hint", () => {
  const result: DualPipelineOrchestratorExecutionResult = {
    version: DUAL_PIPELINE_ORCHESTRATOR_EXECUTION_VERSION,
    status: "partial",
    reason: null,
    planVersion: "dual-pipeline-orchestrator-plan-v0",
    operationalOrder: "concept_then_review",
    semanticDependency: "none",
    selection: { sessionIds: ["s-a", "s-b"], validSessionIds: ["s-a", "s-b"], invalidSessionIds: [] },
    concept: {
      sessions: [
        {
          sessionId: "s-a",
          action: "executed",
          planState: "needs_processing",
          planReason: "not_covered",
          processorStatus: "completed",
          processorReason: null,
          executionMode: "fresh",
          extractionCalls: 1,
          assessmentCalls: 0,
        },
      ],
    },
    review: {
      action: "run_for_selection",
      resolvedAction: "run_for_selection",
      blockingReason: null,
      reviewId: "r-1",
      processorStatus: "projection_failed",
      processorReason: "projection_failed",
      executionMode: "fresh",
      llmCalls: 1,
      projectionStatus: "not_run",
      observationCount: 0,
    },
    summary: {
      conceptExecutedCount: 1,
      conceptCompletedCount: 1,
      conceptFailedCount: 0,
      conceptExtractionCalls: 1,
      conceptAssessmentCalls: 0,
      reviewLlmCalls: 1,
    },
  };
  const presentation = buildProcessingExecutionPresentation(result);
  assert.equal(presentation.headline, "一部の観測を更新しました");
  assert.match(presentation.recoveryHint ?? "", /もう一度/);
  assert.doesNotMatch(JSON.stringify(presentation), /partial_primary_commit/);
});

test("execution presentation avoids raw technical codes in JSON", () => {
  const result: DualPipelineOrchestratorExecutionResult = {
    version: DUAL_PIPELINE_ORCHESTRATOR_EXECUTION_VERSION,
    status: "partial",
    reason: null,
    planVersion: "dual-pipeline-orchestrator-plan-v0",
    operationalOrder: "concept_then_review",
    semanticDependency: "none",
    selection: { sessionIds: ["s-a"], validSessionIds: ["s-a"], invalidSessionIds: [] },
    concept: {
      sessions: [
        {
          sessionId: "s-a",
          action: "executed",
          planState: "needs_processing",
          planReason: "not_covered",
          processorStatus: "failed",
          processorReason: "checkpoint_failed",
          executionMode: "fresh",
          extractionCalls: 1,
          assessmentCalls: 0,
        },
      ],
    },
    review: {
      action: "blocked",
      resolvedAction: "blocked",
      blockingReason: "review_requires_at_least_two_sessions",
      reviewId: null,
      processorStatus: null,
      processorReason: null,
      executionMode: null,
      llmCalls: 0,
      projectionStatus: null,
      observationCount: 0,
    },
    summary: {
      conceptExecutedCount: 1,
      conceptCompletedCount: 0,
      conceptFailedCount: 1,
      conceptExtractionCalls: 1,
      conceptAssessmentCalls: 0,
      reviewLlmCalls: 0,
    },
  };
  const serialized = JSON.stringify(buildProcessingExecutionPresentation(result));
  assert.doesNotMatch(serialized, /checkpoint_failed/);
});
