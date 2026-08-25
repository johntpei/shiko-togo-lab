import {
  INTEGRATED_REVIEW_PROMPT_V5,
  INTEGRATED_REVIEW_PROMPT_V6,
  INTEGRATED_REVIEW_PROMPT_V7,
  INTEGRATED_REVIEW_PROMPT_V8,
} from "@/lib/ai/prompts/integrated-review";

/**
 * Observation へ投影してよい Review promptVersion。
 * v3/v4 は履歴として残すが、v5/v6/v7/v8 と同等の Evidence-first / Guard 品質は保証しない。
 */
export const PROJECTABLE_REVIEW_PROMPT_VERSION = INTEGRATED_REVIEW_PROMPT_V8;
export const PROJECTABLE_REVIEW_PROMPT_VERSIONS = [
  INTEGRATED_REVIEW_PROMPT_V5,
  INTEGRATED_REVIEW_PROMPT_V6,
  INTEGRATED_REVIEW_PROMPT_V7,
  INTEGRATED_REVIEW_PROMPT_V8,
] as const;

export type ReviewProjectionSkipReason = "unsupported_review_version";

export type ReviewProjectionEligibility =
  | { eligible: true; promptVersion: string }
  | {
      eligible: false;
      reason: ReviewProjectionSkipReason;
      promptVersion: string;
    };

export function reviewProjectionEligibility(
  promptVersion: string,
): ReviewProjectionEligibility {
  if ((PROJECTABLE_REVIEW_PROMPT_VERSIONS as readonly string[]).includes(promptVersion)) {
    return { eligible: true, promptVersion };
  }
  return {
    eligible: false,
    reason: "unsupported_review_version",
    promptVersion,
  };
}

export function isProjectableReviewVersion(promptVersion: string) {
  return reviewProjectionEligibility(promptVersion).eligible;
}
