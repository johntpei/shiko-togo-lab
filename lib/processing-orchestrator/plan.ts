import { MIN_INTEGRATED_REVIEW_SESSIONS } from "@/lib/ai/limits";
import { INTEGRATED_REVIEW_PROMPT_VERSION } from "@/lib/ai/prompts/integrated-review";
import { REVIEW_EVIDENCE_TRANSPORT_VERSION } from "@/lib/ai/review-evidence-transport";
import { INTEGRATED_REVIEW_SCHEMA_NAME } from "@/lib/ai/review-schemas";
import { INTEGRATED_REVIEW_PROCESSING_VERSION } from "@/lib/reviews/review-run-types";
import {
  DUAL_PIPELINE_ORCHESTRATOR_CODE_FACTS,
  DUAL_PIPELINE_ORCHESTRATOR_PLAN_VERSION,
  type ConceptSessionPlanRow,
  type DualPipelineOrchestratorPlan,
  type DualPipelineOrchestratorPlanInput,
  type ReviewSelectionState,
  type ReviewStageAction,
} from "./types";

export function uniqueSortedSessionIds(ids: readonly string[]) {
  return [...new Set(ids.map((id) => id.trim()).filter((id) => id !== ""))].sort(
    (left, right) => left.localeCompare(right),
  );
}

function conceptRowFromEvaluation(
  evaluation: DualPipelineOrchestratorPlanInput["conceptEvaluations"][number],
): ConceptSessionPlanRow {
  if (evaluation.status === "already_covered") {
    return {
      sessionId: evaluation.sessionId,
      state: "covered",
      reason: evaluation.reason ?? "already_covered",
    };
  }
  if (evaluation.status === "eligible") {
    return {
      sessionId: evaluation.sessionId,
      state: "needs_processing",
      reason: evaluation.reason ?? "not_covered",
    };
  }
  return {
    sessionId: evaluation.sessionId,
    state: "blocked",
    reason: evaluation.reason ?? "blocked",
  };
}

export type ResolvedReviewStage = {
  action: ReviewStageAction;
  executionReady: boolean;
  blockingReason: string | null;
  selectionSessionIds: string[];
  exactCompletedReviewIds: string[];
  exactPendingReviewIds: string[];
  exactLegacyUnknownReviewIds: string[];
  resumeReviewId: string | null;
};

export function resolveReviewStageAction(input: {
  requestedSessionIds: readonly string[];
  validSessionIds: readonly string[];
  reviewSelectionState: ReviewSelectionState;
  reviewInputPreflight?: DualPipelineOrchestratorPlanInput["reviewInputPreflight"];
}): ResolvedReviewStage {
  const requestedSessionIds = uniqueSortedSessionIds(input.requestedSessionIds);
  const validSessionIds = uniqueSortedSessionIds(input.validSessionIds);
  const selectionState = input.reviewSelectionState;
  const exactCompletedReviewIds = [
    ...selectionState.exactCompletedReviewIds,
  ].sort((left, right) => left.localeCompare(right));
  const exactPendingReviewIds = [...selectionState.exactPendingReviewIds].sort(
    (left, right) => left.localeCompare(right),
  );
  const exactLegacyUnknownReviewIds = [
    ...selectionState.exactLegacyUnknownReviewIds,
  ].sort((left, right) => left.localeCompare(right));

  const review = (() => {
    if (requestedSessionIds.length === 0) {
      return {
        action: "no_selection" as const,
        executionReady: false,
        blockingReason: "no_selection",
      };
    }
    if (validSessionIds.length === 0) {
      return {
        action: "no_valid_session" as const,
        executionReady: false,
        blockingReason: "missing_session",
      };
    }
    if (validSessionIds.length < MIN_INTEGRATED_REVIEW_SESSIONS) {
      return {
        action: "blocked" as const,
        executionReady: false,
        blockingReason: "review_requires_at_least_two_sessions",
      };
    }
    if (exactCompletedReviewIds.length > 0) {
      return {
        action: "not_needed" as const,
        executionReady: false,
        blockingReason: null,
      };
    }
    if (exactPendingReviewIds.length > 1) {
      return {
        action: "blocked" as const,
        executionReady: false,
        blockingReason: "ambiguous_pending_reviews",
      };
    }
    if (exactPendingReviewIds.length === 1) {
      return {
        action: "resume_projection" as const,
        executionReady: true,
        blockingReason: null,
      };
    }
    if (exactLegacyUnknownReviewIds.length > 0) {
      return {
        action: "blocked" as const,
        executionReady: false,
        blockingReason: "legacy_review_completion_unknown",
      };
    }
    if (input.reviewInputPreflight && !input.reviewInputPreflight.withinLimit) {
      return {
        action: "blocked" as const,
        executionReady: false,
        blockingReason: "review_input_too_long",
      };
    }
    return {
      action: "run_for_selection" as const,
      executionReady: true,
      blockingReason: null,
    };
  })();

  return {
    action: review.action,
    executionReady: review.executionReady,
    blockingReason: review.blockingReason,
    selectionSessionIds: validSessionIds,
    exactCompletedReviewIds,
    exactPendingReviewIds,
    exactLegacyUnknownReviewIds,
    resumeReviewId:
      review.action === "resume_projection"
        ? (exactPendingReviewIds[0] ?? null)
        : null,
  };
}

/**
 * Pure dual-pipeline orchestrator plan. Does not authorize LLM or DB writes.
 * Concept coverage comes from supplied eligibility evaluations.
 * Review coverage comes from explicit review_sessions only.
 * Occurrence / Observation / Evidence links are not inputs.
 */
export function buildDualPipelineOrchestratorPlan(
  input: DualPipelineOrchestratorPlanInput,
): DualPipelineOrchestratorPlan {
  const requestedSessionIds = uniqueSortedSessionIds(input.requestedSessionIds);
  const existing = new Set(uniqueSortedSessionIds(input.existingSessionIds));
  const invalidSessionIds = requestedSessionIds.filter(
    (id) => !existing.has(id),
  );
  const validSessionIds = requestedSessionIds.filter((id) => existing.has(id));
  const validSet = new Set(validSessionIds);

  const evaluationById = new Map(
    input.conceptEvaluations.map((evaluation) => [
      evaluation.sessionId,
      evaluation,
    ]),
  );
  const conceptSessions: ConceptSessionPlanRow[] = validSessionIds.map(
    (sessionId) => {
      const evaluation = evaluationById.get(sessionId);
      if (!evaluation) {
        return {
          sessionId,
          state: "blocked",
          reason: "eligibility_unresolved",
        };
      }
      return conceptRowFromEvaluation(evaluation);
    },
  );
  for (const sessionId of invalidSessionIds) {
    conceptSessions.push({
      sessionId,
      state: "invalid",
      reason: "missing_session",
    });
  }
  conceptSessions.sort((left, right) =>
    left.sessionId.localeCompare(right.sessionId),
  );

  const coveredSessionIds = conceptSessions
    .filter((row) => row.state === "covered")
    .map((row) => row.sessionId);
  const needsProcessingSessionIds = conceptSessions
    .filter((row) => row.state === "needs_processing")
    .map((row) => row.sessionId);
  const blockedSessionIds = conceptSessions
    .filter((row) => row.state === "blocked")
    .map((row) => row.sessionId);

  const conceptAction = (() => {
    if (requestedSessionIds.length === 0) {
      return "no_selection" as const;
    }
    if (validSessionIds.length === 0) {
      return "no_valid_session" as const;
    }
    if (blockedSessionIds.length > 0 && needsProcessingSessionIds.length === 0) {
      return "blocked" as const;
    }
    if (needsProcessingSessionIds.length > 0) {
      return "needs_processing" as const;
    }
    return "not_needed" as const;
  })();

  const conceptBlockingReason =
    conceptAction === "no_selection"
      ? "no_selection"
      : conceptAction === "no_valid_session"
        ? "missing_session"
        : conceptAction === "blocked"
          ? (conceptSessions.find((row) => row.state === "blocked")?.reason ??
            "blocked")
          : conceptAction === "needs_processing"
            ? null
            : null;

  const reviewCoveredSet = new Set(
    uniqueSortedSessionIds(input.reviewCoveredSessionIds).filter((id) =>
      validSet.has(id),
    ),
  );
  const reviewCoveredSessionIds = validSessionIds.filter((id) =>
    reviewCoveredSet.has(id),
  );
  const reviewUncoveredSessionIds = validSessionIds.filter(
    (id) => !reviewCoveredSet.has(id),
  );

  const resolvedReview = resolveReviewStageAction({
    requestedSessionIds,
    validSessionIds,
    reviewSelectionState: input.reviewSelectionState,
    reviewInputPreflight: input.reviewInputPreflight,
  });

  return {
    version: DUAL_PIPELINE_ORCHESTRATOR_PLAN_VERSION,
    authorizesExecution: false,
    codeFacts: DUAL_PIPELINE_ORCHESTRATOR_CODE_FACTS,
    selection: {
      requestedSessionIds,
      validSessionIds,
      invalidSessionIds,
    },
    concept: {
      action: conceptAction,
      executionReady: conceptAction === "needs_processing",
      blockingReason: conceptBlockingReason,
      coveredSessionIds,
      needsProcessingSessionIds,
      blockedSessionIds,
      sessions: conceptSessions,
    },
    review: {
      action: resolvedReview.action,
      executionReady: resolvedReview.executionReady,
      blockingReason: resolvedReview.blockingReason,
      selectionSessionIds: resolvedReview.selectionSessionIds,
      exactCompletedReviewIds: resolvedReview.exactCompletedReviewIds,
      exactPendingReviewIds: resolvedReview.exactPendingReviewIds,
      exactLegacyUnknownReviewIds: resolvedReview.exactLegacyUnknownReviewIds,
      coveredSessionIds: reviewCoveredSessionIds,
      uncoveredSessionIds: reviewUncoveredSessionIds,
      inputPreflight: input.reviewInputPreflight ?? null,
      targetVersions: {
        prompt: INTEGRATED_REVIEW_PROMPT_VERSION,
        schema: INTEGRATED_REVIEW_SCHEMA_NAME,
        processing: INTEGRATED_REVIEW_PROCESSING_VERSION,
        transport: REVIEW_EVIDENCE_TRANSPORT_VERSION,
      },
    },
    relation: {
      isPrimaryStage: false,
      mode: "automatic_after_primary_commit",
    },
    workload: {
      conceptExtractionCallsKnown: needsProcessingSessionIds.length,
      conceptAssessmentCalls: "unknown_until_extraction",
      reviewCallsKnown:
        resolvedReview.action === "run_for_selection"
          ? 1
          : resolvedReview.action === "resume_projection"
            ? 0
            : 0,
    },
  };
}

export function formatDualPipelineOrchestratorPlan(
  plan: DualPipelineOrchestratorPlan,
) {
  return [
    `version: ${plan.version}`,
    `authorizesExecution: ${plan.authorizesExecution}`,
    `triggerPolicy: ${plan.codeFacts.triggerPolicy}`,
    `requestedSessionIds: ${plan.selection.requestedSessionIds.join(",") || "(none)"}`,
    `validSessionIds: ${plan.selection.validSessionIds.join(",") || "(none)"}`,
    `invalidSessionIds: ${plan.selection.invalidSessionIds.join(",") || "(none)"}`,
    `concept.action: ${plan.concept.action}`,
    `concept.executionReady: ${plan.concept.executionReady}`,
    `concept.blockingReason: ${plan.concept.blockingReason ?? "(none)"}`,
    `concept.executionReadiness: ${plan.codeFacts.conceptExecutionReadiness}`,
    `concept.coveredSessionIds: ${plan.concept.coveredSessionIds.join(",") || "(none)"}`,
    `concept.needsProcessingSessionIds: ${plan.concept.needsProcessingSessionIds.join(",") || "(none)"}`,
    `review.action: ${plan.review.action}`,
    `review.executionReady: ${plan.review.executionReady}`,
    `review.blockingReason: ${plan.review.blockingReason ?? "(none)"}`,
    `review.selectedSessionIds: ${plan.review.selectionSessionIds.join(",") || "(none)"}`,
    `review.exactCompletedReviewIds: ${plan.review.exactCompletedReviewIds.join(",") || "(none)"}`,
    `review.exactPendingReviewIds: ${plan.review.exactPendingReviewIds.join(",") || "(none)"}`,
    `review.exactLegacyUnknownReviewIds: ${plan.review.exactLegacyUnknownReviewIds.join(",") || "(none)"}`,
    `review.coveredSessionIds: ${plan.review.coveredSessionIds.join(",") || "(none)"}`,
    `review.uncoveredSessionIds: ${plan.review.uncoveredSessionIds.join(",") || "(none)"}`,
    `review.inputChars: ${plan.review.inputPreflight?.serializedChars ?? "(not measured)"}`,
    `review.inputWithinLimit: ${plan.review.inputPreflight?.withinLimit ?? "(not measured)"}`,
    `review.targetPrompt: ${plan.review.targetVersions.prompt}`,
    `review.targetSchema: ${plan.review.targetVersions.schema}`,
    `review.targetProcessing: ${plan.review.targetVersions.processing}`,
    `review.targetTransport: ${plan.review.targetVersions.transport}`,
    `relation.isPrimaryStage: ${plan.relation.isPrimaryStage}`,
    `relation.mode: ${plan.relation.mode}`,
    `workload.conceptExtractionCallsKnown: ${plan.workload.conceptExtractionCallsKnown}`,
    `workload.conceptAssessmentCalls: ${plan.workload.conceptAssessmentCalls}`,
    `workload.reviewCallsKnown: ${plan.workload.reviewCallsKnown}`,
    `recommendedStageOrder: ${plan.codeFacts.recommendedStageOrder}`,
    `recommendedNextStep: ${plan.codeFacts.recommendedNextStep}`,
  ].join("\n");
}
