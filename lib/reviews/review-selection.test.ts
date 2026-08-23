import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeReviewSelectionSessionIds,
  reviewSessionSetsEqual,
} from "./review-selection";

test("normalizeReviewSelectionSessionIds dedupes trims and sorts", () => {
  assert.deepEqual(normalizeReviewSelectionSessionIds([" s-b ", "s-a", "s-b"]), [
    "s-a",
    "s-b",
  ]);
});

test("reviewSessionSetsEqual ignores order", () => {
  assert.equal(reviewSessionSetsEqual(["s-a", "s-b"], ["s-b", "s-a"]), true);
  assert.equal(reviewSessionSetsEqual(["s-a", "s-b"], ["s-a", "s-b", "s-c"]), false);
});
