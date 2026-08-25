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

test("Review too-long keeps CTA enabled when Concept is actionable", () => {
  const plan = buildDualPipelineOrchestratorPlan({
    ...emptyInput(),
    requestedSessionIds: ["s-a", "s-b"],
    existingSessionIds: ["s-a", "s-b"],
    conceptEvaluations: [
      { sessionId: "s-a", status: "eligible", reason: "not_covered" },
      {
        sessionId: "s-b",
        status: "already_covered",
        reason: "initial_processing_coverage",
      },
    ],
    reviewInputPreflight: {
      serializationVersion: "review-evidence-compact-v1",
      serializedChars: 80_001,
      evidenceCount: 2,
      sessionCount: 2,
      withinLimit: false,
    },
  });
  const presentation = buildProcessingPlanPresentation({ plan });
  assert.equal(presentation.canExecute, true);
  assert.equal(presentation.review.summary, "今回は実行できません");
  assert.match(presentation.review.detail ?? "", /選んだ内容が長い/);
});

test("Review-only too-long disables CTA when all Concepts are covered", () => {
  const plan = buildDualPipelineOrchestratorPlan({
    ...emptyInput(),
    requestedSessionIds: ["s-a", "s-b"],
    existingSessionIds: ["s-a", "s-b"],
    conceptEvaluations: [
      {
        sessionId: "s-a",
        status: "already_covered",
        reason: "initial_processing_coverage",
      },
      {
        sessionId: "s-b",
        status: "already_covered",
        reason: "initial_processing_coverage",
      },
    ],
    reviewInputPreflight: {
      serializationVersion: "review-evidence-compact-v1",
      serializedChars: 80_001,
      evidenceCount: 2,
      sessionCount: 2,
      withinLimit: false,
    },
  });
  const presentation = buildProcessingPlanPresentation({ plan });
  assert.equal(presentation.canExecute, false);
  assert.match(presentation.executeDisabledReason ?? "", /選んだ内容が長い/);
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
          failureDiagnostic: null,
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
      processorCode: "projection_failed",
      executionMode: "fresh",
      llmCalls: 1,
      projectionStatus: "not_run",
      observationCount: 0,
      failureDiagnostic: {
        status: "projection_failed",
        executionMode: "fresh",
        failureReason: "projection_failed",
        failureCode: "projection_failed",
        llmCalls: 1,
      },
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

test("execution presentation preserves sanitized Concept failure diagnostics only", () => {
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
          processorReason: "SECRET_USER_MESSAGE presentation fixture",
          executionMode: "fresh",
          extractionCalls: 1,
          assessmentCalls: 0,
          failureDiagnostic: {
            failureStage: "checkpoint",
            failureReason: "checkpoint_failed",
            failureCode: "injected_checkpoint_failure",
            extractionCalls: 1,
            assessmentCalls: 0,
          },
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
      processorCode: null,
      executionMode: null,
      llmCalls: 0,
      projectionStatus: null,
      observationCount: 0,
      failureDiagnostic: null,
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
  const presentation = buildProcessingExecutionPresentation(
    result,
    new Map([["s-a", "Session A"]]),
  );
  assert.deepEqual(presentation.conceptFailures, [
    {
      sessionId: "s-a",
      title: "Session A",
      status: "failed",
      executionMode: "fresh",
      failureStage: "checkpoint",
      failureReason: "checkpoint_failed",
      failureCode: "injected_checkpoint_failure",
      extractionCalls: 1,
      assessmentCalls: 0,
    },
  ]);
  const serialized = JSON.stringify(presentation);
  assert.doesNotMatch(serialized, /SECRET_USER_MESSAGE/);
  assert.doesNotMatch(serialized, /processorReason/);
});

test("execution presentation keeps unknown Concept diagnostics null", () => {
  const result: DualPipelineOrchestratorExecutionResult = {
    version: DUAL_PIPELINE_ORCHESTRATOR_EXECUTION_VERSION,
    status: "partial",
    reason: null,
    planVersion: "dual-pipeline-orchestrator-plan-v0",
    operationalOrder: "concept_then_review",
    semanticDependency: "none",
    selection: {
      sessionIds: ["s-a"],
      validSessionIds: ["s-a"],
      invalidSessionIds: [],
    },
    concept: {
      sessions: [
        {
          sessionId: "s-a",
          action: "executed",
          planState: "needs_processing",
          planReason: "not_covered",
          processorStatus: "failed",
          processorReason: null,
          executionMode: "fresh",
          extractionCalls: 1,
          assessmentCalls: 0,
          failureDiagnostic: {
            failureStage: null,
            failureReason: null,
            failureCode: null,
            extractionCalls: 1,
            assessmentCalls: 0,
          },
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
      processorCode: null,
      executionMode: null,
      llmCalls: 0,
      projectionStatus: null,
      observationCount: 0,
      failureDiagnostic: null,
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

  assert.deepEqual(
    buildProcessingExecutionPresentation(result).conceptFailures[0],
    {
      sessionId: "s-a",
      title: null,
      status: "failed",
      executionMode: "fresh",
      failureStage: null,
      failureReason: null,
      failureCode: null,
      extractionCalls: 1,
      assessmentCalls: 0,
    },
  );
});

test("execution presentation exposes safe Review too_long diagnostics with human copy", () => {
  const result: DualPipelineOrchestratorExecutionResult = {
    version: DUAL_PIPELINE_ORCHESTRATOR_EXECUTION_VERSION,
    status: "partial",
    reason: null,
    planVersion: "dual-pipeline-orchestrator-plan-v0",
    operationalOrder: "concept_then_review",
    semanticDependency: "none",
    selection: {
      sessionIds: ["s-a", "s-b"],
      validSessionIds: ["s-a", "s-b"],
      invalidSessionIds: [],
    },
    concept: { sessions: [] },
    review: {
      action: "run_for_selection",
      resolvedAction: "run_for_selection",
      blockingReason: null,
      reviewId: null,
      processorStatus: "failed",
      processorReason: "SECRET_USER raw provider body stack fixture",
      processorCode: "too_long",
      executionMode: "fresh",
      llmCalls: 0,
      projectionStatus: "not_run",
      observationCount: 0,
      failureDiagnostic: {
        status: "failed",
        executionMode: "fresh",
        failureReason: null,
        failureCode: "too_long",
        llmCalls: 0,
      },
    },
    summary: {
      conceptExecutedCount: 0,
      conceptCompletedCount: 0,
      conceptFailedCount: 0,
      conceptExtractionCalls: 0,
      conceptAssessmentCalls: 0,
      reviewLlmCalls: 0,
    },
  };

  const presentation = buildProcessingExecutionPresentation(result);
  assert.equal(
    presentation.reviewSummary,
    "対話をまたいだ観測: 完了できませんでした",
  );
  assert.deepEqual(presentation.reviewFailure, {
    status: "failed",
    executionMode: "fresh",
    failureReason: null,
    failureCode: "too_long",
    llmCalls: 0,
    message:
      "選んだ対話の内容が長いため、対話をまたいだ観測を作成できませんでした。",
  });
  const serialized = JSON.stringify(presentation);
  assert.doesNotMatch(serialized, /SECRET_USER/);
  assert.doesNotMatch(serialized, /provider body/);
  assert.doesNotMatch(serialized, /stack fixture/);

  result.review.failureDiagnostic = {
    status: "failed",
    executionMode: "fresh",
    failureReason: "evidence_validation_failed",
    failureCode: "all_review_evidence_invalid",
    llmCalls: 1,
    groundingDiagnostic: {
      aliasAttemptCount: 2,
      resolvedAliasCount: 0,
      aliasDiagnostics: {
        totalAliasReferences: 2,
        uniqueReturnedAliasCount: 1,
        expectedAliasWidth: 2,
        base62OnlyCount: 2,
        expectedWidthCount: 0,
        exactMemberCount: 0,
        nonBase62Count: 0,
        unexpectedLengthCount: 2,
        leadingOrTrailingWhitespaceCount: 0,
        legacyEvidenceRefShapeCount: 0,
        wrapperShapeCount: 0,
        trimmedExactMemberCount: 0,
        caseInsensitiveMemberCount: 0,
        unwrappedExactMemberCount: 0,
      },
      usableValidatedEvidenceCount: 0,
    },
  };
  const groundingFailure = buildProcessingExecutionPresentation(result);
  assert.equal(
    groundingFailure.reviewFailure?.message,
    "観測結果の根拠を確認できなかったため、保存しませんでした。",
  );
  assert.equal(
    groundingFailure.reviewFailure?.groundingDiagnostic?.aliasDiagnostics
      .unexpectedLengthCount,
    2,
  );
  assert.doesNotMatch(JSON.stringify(groundingFailure), /returnedAlias/);
  assert.doesNotMatch(JSON.stringify(groundingFailure), /Evidence本文/);

  result.review.failureDiagnostic = {
    status: "failed",
    executionMode: "fresh",
    failureReason: "secret_like_unknown_reason",
    failureCode: "secret_like_unknown_code",
    llmCalls: 0,
  };
  const unknown = buildProcessingExecutionPresentation(result);
  assert.equal(unknown.reviewFailure?.failureReason, null);
  assert.equal(unknown.reviewFailure?.failureCode, null);
  assert.doesNotMatch(JSON.stringify(unknown), /secret_like_unknown/);
});

test("execution presentation omits Review failure diagnostics on success", () => {
  const result: DualPipelineOrchestratorExecutionResult = {
    version: DUAL_PIPELINE_ORCHESTRATOR_EXECUTION_VERSION,
    status: "completed",
    reason: null,
    planVersion: "dual-pipeline-orchestrator-plan-v0",
    operationalOrder: "concept_then_review",
    semanticDependency: "none",
    selection: {
      sessionIds: ["s-a", "s-b"],
      validSessionIds: ["s-a", "s-b"],
      invalidSessionIds: [],
    },
    concept: { sessions: [] },
    review: {
      action: "run_for_selection",
      resolvedAction: "run_for_selection",
      blockingReason: null,
      reviewId: "r-1",
      processorStatus: "completed",
      processorReason: null,
      processorCode: null,
      executionMode: "fresh",
      llmCalls: 1,
      projectionStatus: "projected",
      observationCount: 0,
      failureDiagnostic: null,
    },
    summary: {
      conceptExecutedCount: 0,
      conceptCompletedCount: 0,
      conceptFailedCount: 0,
      conceptExtractionCalls: 0,
      conceptAssessmentCalls: 0,
      reviewLlmCalls: 1,
    },
  };

  assert.equal(buildProcessingExecutionPresentation(result).reviewFailure, null);
});
