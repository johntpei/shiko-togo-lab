import assert from "node:assert/strict";
import test from "node:test";
import {
  INTEGRATED_REVIEW_PROMPT_V3,
  INTEGRATED_REVIEW_PROMPT_V4,
  INTEGRATED_REVIEW_PROMPT_V5,
  INTEGRATED_REVIEW_PROMPT_V6,
  INTEGRATED_REVIEW_PROMPT_V7,
} from "@/lib/ai/prompts/integrated-review";
import {
  isProjectableReviewVersion,
  PROJECTABLE_REVIEW_PROMPT_VERSION,
  reviewProjectionEligibility,
} from "./projection-eligibility";

test("v5/v6 backward compatibilityを保ち、現行v7も投影対象", () => {
  assert.equal(PROJECTABLE_REVIEW_PROMPT_VERSION, "integrated-review-v7");
  assert.equal(PROJECTABLE_REVIEW_PROMPT_VERSION, INTEGRATED_REVIEW_PROMPT_V7);
  assert.deepEqual(reviewProjectionEligibility(INTEGRATED_REVIEW_PROMPT_V5), {
    eligible: true,
    promptVersion: "integrated-review-v5",
  });
  assert.equal(isProjectableReviewVersion(INTEGRATED_REVIEW_PROMPT_V5), true);
  assert.deepEqual(reviewProjectionEligibility(INTEGRATED_REVIEW_PROMPT_V6), {
    eligible: true,
    promptVersion: "integrated-review-v6",
  });
  assert.equal(isProjectableReviewVersion(INTEGRATED_REVIEW_PROMPT_V6), true);
  assert.deepEqual(reviewProjectionEligibility(INTEGRATED_REVIEW_PROMPT_V7), {
    eligible: true,
    promptVersion: "integrated-review-v7",
  });
  assert.equal(isProjectableReviewVersion(INTEGRATED_REVIEW_PROMPT_V7), true);
});

test("v3 / v4 は例外を投げず projection 対象外", () => {
  assert.deepEqual(reviewProjectionEligibility(INTEGRATED_REVIEW_PROMPT_V3), {
    eligible: false,
    reason: "unsupported_review_version",
    promptVersion: "integrated-review-v3",
  });
  assert.deepEqual(reviewProjectionEligibility(INTEGRATED_REVIEW_PROMPT_V4), {
    eligible: false,
    reason: "unsupported_review_version",
    promptVersion: "integrated-review-v4",
  });
  assert.equal(isProjectableReviewVersion(INTEGRATED_REVIEW_PROMPT_V3), false);
  assert.equal(isProjectableReviewVersion(""), false);
});
