import type { IncrementalConceptSessionProcessorResult } from "@/lib/concepts/incremental/session-processor";
import type { IntegratedReviewProcessingResult } from "@/lib/reviews/integrated-review-processor";
import type { ReviewStageAction } from "./types";

export const DUAL_PIPELINE_ORCHESTRATOR_EXECUTION_VERSION =
  "dual-pipeline-orchestrator-execution-v0";

export type DualPipelineOrchestratorExecutionVersion =
  typeof DUAL_PIPELINE_ORCHESTRATOR_EXECUTION_VERSION;

export type DualPipelineExecutionStatus =
  | "completed"
  | "partial"
  | "blocked"
  | "failed";

export type DualPipelineConceptSessionAction = "not_needed" | "executed";

export type DualPipelineConceptFailureDiagnostic = {
  failureStage: string | null;
  failureReason: string | null;
  failureCode: string | null;
  extractionCalls: number;
  assessmentCalls: number;
};

export type DualPipelineConceptSessionResult = {
  sessionId: string;
  action: DualPipelineConceptSessionAction;
  planState: "covered" | "needs_processing" | "blocked" | "invalid";
  planReason: string;
  processorStatus: IncrementalConceptSessionProcessorResult["status"] | null;
  processorReason: string | null;
  executionMode: IncrementalConceptSessionProcessorResult["executionMode"];
  extractionCalls: number;
  assessmentCalls: number;
  failureDiagnostic: DualPipelineConceptFailureDiagnostic | null;
};

export type DualPipelineReviewExecutionResult = {
  action: ReviewStageAction;
  resolvedAction: ReviewStageAction;
  blockingReason: string | null;
  reviewId: string | null;
  processorStatus: IntegratedReviewProcessingResult["status"] | null;
  processorReason: string | null;
  processorCode: string | null;
  executionMode: IntegratedReviewProcessingResult["executionMode"] | null;
  llmCalls: number;
  projectionStatus: IntegratedReviewProcessingResult["projection"]["status"] | null;
  observationCount: number;
  failureDiagnostic: DualPipelineReviewFailureDiagnostic | null;
};

export type DualPipelineReviewFailureDiagnostic = {
  status: Exclude<IntegratedReviewProcessingResult["status"], "completed">;
  executionMode: IntegratedReviewProcessingResult["executionMode"];
  failureReason: string | null;
  failureCode: string | null;
  llmCalls: number;
};

const SAFE_REVIEW_FAILURE_TOKENS = new Set([
  "not_configured",
  "unsupported_provider",
  "too_few_sessions",
  "too_long",
  "api",
  "timeout",
  "schema",
  "save",
  "projection_failed",
  "legacy_review_completion_unknown",
  "missing_review",
  "unsupported_review_version",
  "invalid_payload",
  "observation_projection_failed",
]);

export function sanitizeDualPipelineReviewFailureToken(
  value: string | null,
): string | null {
  return value && SAFE_REVIEW_FAILURE_TOKENS.has(value) ? value : null;
}

export type DualPipelineOrchestratorExecutionResult = {
  version: DualPipelineOrchestratorExecutionVersion;
  status: DualPipelineExecutionStatus;
  reason: string | null;
  planVersion: string;
  operationalOrder: "concept_then_review";
  semanticDependency: "none";
  selection: {
    sessionIds: string[];
    validSessionIds: string[];
    invalidSessionIds: string[];
  };
  concept: {
    sessions: DualPipelineConceptSessionResult[];
  };
  review: DualPipelineReviewExecutionResult;
  summary: {
    conceptExecutedCount: number;
    conceptCompletedCount: number;
    conceptFailedCount: number;
    conceptExtractionCalls: number;
    conceptAssessmentCalls: number;
    reviewLlmCalls: number;
  };
};
