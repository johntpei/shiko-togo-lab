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
  executionMode: IntegratedReviewProcessingResult["executionMode"] | null;
  llmCalls: number;
  projectionStatus: IntegratedReviewProcessingResult["projection"]["status"] | null;
  observationCount: number;
};

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
