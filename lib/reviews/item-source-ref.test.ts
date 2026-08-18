import assert from "node:assert/strict";
import test from "node:test";
import { reviewItemSourceRef } from "./item-source-ref";

test("canonical SourceRef は payload 元 index の 1始まり", () => {
  assert.equal(reviewItemSourceRef("shift", 0), "R:SHIFT:01");
  assert.equal(reviewItemSourceRef("shift", 1), "R:SHIFT:02");
  assert.equal(reviewItemSourceRef("insight", 0), "R:INSIGHT:01");
  assert.equal(reviewItemSourceRef("tension", 9), "R:TENSION:10");
  assert.equal(reviewItemSourceRef("theme", 0), "R:THEME:01");
});
