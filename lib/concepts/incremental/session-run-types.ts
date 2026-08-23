export const INCREMENTAL_CONCEPT_SESSION_RUN_VERSION =
  "incremental-concept-session-run-v1";

export const INCREMENTAL_CONCEPT_SESSION_PREPARED_VERSION =
  "incremental-concept-session-prepared-v1";

export const INCREMENTAL_SESSION_RUN_PHASES = [
  "prepared",
  "existing_primary_done",
  "new_primary_done",
  "checkpoint_done",
] as const;

export type IncrementalSessionRunPhase =
  (typeof INCREMENTAL_SESSION_RUN_PHASES)[number];

export type IncrementalSessionRunFailureStage =
  | "prepared_persist"
  | "existing_primary"
  | "new_primary"
  | "checkpoint"
  | "run_phase_update";

export type PreparedPlanningSummary = {
  status: "planned" | "no_actions";
  existingMatchCount: number;
  newCandidateCount: number;
  provisionalNewCount: number;
  groundingRejectedCount: number;
};

export type IncrementalConceptSessionExecutionMode = "fresh" | "resumed";
