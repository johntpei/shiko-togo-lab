export const INTEGRATED_REVIEW_PROCESSING_VERSION_V1 =
  "integrated-review-processing-v1";
export const INTEGRATED_REVIEW_PROCESSING_VERSION_V2 =
  "integrated-review-processing-v2";
export const INTEGRATED_REVIEW_PROCESSING_VERSION =
  INTEGRATED_REVIEW_PROCESSING_VERSION_V2;

export const SUPPORTED_INTEGRATED_REVIEW_PROCESSING_VERSIONS = [
  INTEGRATED_REVIEW_PROCESSING_VERSION_V2,
  INTEGRATED_REVIEW_PROCESSING_VERSION_V1,
] as const;

export const REVIEW_PROCESSING_RUN_PHASES = [
  "review_saved",
  "projection_done",
] as const;

export type ReviewProcessingRunPhase =
  (typeof REVIEW_PROCESSING_RUN_PHASES)[number];

export type ReviewProcessingRunFailureStage =
  | "projection"
  | "run_phase_update";
