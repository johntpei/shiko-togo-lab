export const INTEGRATED_REVIEW_PROCESSING_VERSION =
  "integrated-review-processing-v1";

export const REVIEW_PROCESSING_RUN_PHASES = [
  "review_saved",
  "projection_done",
] as const;

export type ReviewProcessingRunPhase =
  (typeof REVIEW_PROCESSING_RUN_PHASES)[number];

export type ReviewProcessingRunFailureStage =
  | "projection"
  | "run_phase_update";
