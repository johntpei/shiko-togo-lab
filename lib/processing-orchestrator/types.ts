export const DUAL_PIPELINE_ORCHESTRATOR_PLAN_VERSION =
  "dual-pipeline-orchestrator-plan-v0";

export type DualPipelineOrchestratorPlanVersion =
  typeof DUAL_PIPELINE_ORCHESTRATOR_PLAN_VERSION;

export const CONCEPT_EXECUTION_READINESS = "composable_but_not_wired" as const;

export const REVIEW_PRODUCTION_ENTRY = "createIntegratedReviewAction" as const;

export const RECOMMENDED_NEXT_STEP =
  "unified_incremental_concept_session_processor" as const;

/**
 * Code-path facts. Not inferred from Session counts.
 * Concept stages exist as libraries / CLIs but are not one production
 * Session processor that writes a completion checkpoint.
 * Integrated Review already has a production UI/server entry.
 * Relation materialization is post-commit, not a primary stage.
 */
export const DUAL_PIPELINE_ORCHESTRATOR_CODE_FACTS = {
  triggerPolicy: "explicit_session_selection",
  authorizesExecution: false,
  conceptUnifiedSessionProcessor: false,
  conceptExistingAppendCli: "cli_concept_incremental_existing_append",
  conceptExistingAppendWritesCheckpoint: false,
  conceptNewAdmissionDedicatedCli: false,
  conceptNewAdmissionLibraryEntry:
    "applyIncrementalNewAdmissionManifestThenReconcile",
  conceptCheckpointWriter: "markIncrementalConceptSessionCompleted",
  conceptExecutionReadiness: CONCEPT_EXECUTION_READINESS,
  reviewProductionEntry: REVIEW_PRODUCTION_ENTRY,
  reviewRepeatCreatesNewRow: true,
  reviewDedupesBySessionSet: false,
  sessionAnalysesRequiredForReview: false,
  relationIsPrimaryStage: false,
  relationMode: "automatic_after_primary_commit",
  recommendedStageOrder: "independent",
  recommendedNextStep: RECOMMENDED_NEXT_STEP,
} as const;

export type DualPipelineOrchestratorCodeFacts =
  typeof DUAL_PIPELINE_ORCHESTRATOR_CODE_FACTS;

export type ConceptSessionPlanState =
  | "covered"
  | "needs_processing"
  | "blocked"
  | "invalid";

export type ConceptSessionPlanRow = {
  sessionId: string;
  state: ConceptSessionPlanState;
  reason: string;
};

export type ConceptStageAction =
  | "no_selection"
  | "no_valid_session"
  | "not_needed"
  | "needs_processing"
  | "blocked";

export type ReviewStageAction =
  | "no_selection"
  | "no_valid_session"
  | "blocked"
  | "not_needed"
  | "run_for_selection";

export type ConceptEvaluation = {
  sessionId: string;
  status: "eligible" | "already_covered" | "blocked";
  reason: string | null;
};

export type DualPipelineOrchestratorPlanInput = {
  requestedSessionIds: string[];
  existingSessionIds: string[];
  conceptEvaluations: ConceptEvaluation[];
  reviewCoveredSessionIds: string[];
};

export type DualPipelineOrchestratorPlan = {
  version: DualPipelineOrchestratorPlanVersion;
  authorizesExecution: false;
  codeFacts: DualPipelineOrchestratorCodeFacts;
  selection: {
    requestedSessionIds: string[];
    validSessionIds: string[];
    invalidSessionIds: string[];
  };
  concept: {
    action: ConceptStageAction;
    executionReady: false;
    blockingReason: string | null;
    coveredSessionIds: string[];
    needsProcessingSessionIds: string[];
    blockedSessionIds: string[];
    sessions: ConceptSessionPlanRow[];
  };
  review: {
    action: ReviewStageAction;
    executionReady: boolean;
    blockingReason: string | null;
    selectedSessionIds: string[];
    coveredSessionIds: string[];
    uncoveredSessionIds: string[];
  };
  relation: {
    isPrimaryStage: false;
    mode: "automatic_after_primary_commit";
  };
  workload: {
    conceptExtractionCallsKnown: number;
    conceptAssessmentCalls: "unknown_until_extraction";
    reviewCallsKnown: number;
  };
};
