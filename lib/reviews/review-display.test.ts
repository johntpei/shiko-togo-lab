import assert from "node:assert/strict";
import test from "node:test";
import {
  formatEvidenceMetric,
  formatHardGuardExcluded,
  formatInterpretationMetric,
  supportTypeLabel,
} from "./review-display";

test("Case A: Open Question の direct は過去Sessionで確認された問い", () => {
  assert.equal(
    supportTypeLabel("openQuestion", "direct"),
    "過去Sessionで確認された問い",
  );
  assert.notEqual(supportTypeLabel("openQuestion", "direct"), "確認できたこと");
});

test("Case B: Cross Insight は AIによる横断的な解釈", () => {
  assert.equal(
    supportTypeLabel("insight", "cross_session_interpretation"),
    "AIによる横断的な解釈",
  );
});

test("Case C: Hypothesis は まだ確認されていない仮説", () => {
  assert.equal(
    supportTypeLabel("hypothesis", "hypothesis"),
    "まだ確認されていない仮説",
  );
});

test("Case D: Hard Guard は成功率ではなく除外件数", () => {
  const label = formatHardGuardExcluded({
    hardItemCount: 1,
    hardValidCount: 0,
    hardExcludedCount: 1,
  });
  assert.equal(label, "Hard Guard除外 1件");
  assert.doesNotMatch(label ?? "", /0\/1/);
  assert.doesNotMatch(label ?? "", /0%/);
});

test("Case E: Evidence は 根拠 30/30（100%）", () => {
  assert.equal(
    formatEvidenceMetric({
      evidenceCount: 30,
      validatedCount: 30,
      validationRate: 1,
    }),
    "根拠 30/30（100%）",
  );
});

test("Case F: Interpretation は 横断解釈 11/11（100%）", () => {
  assert.equal(
    formatInterpretationMetric({
      interpretationItemCount: 11,
      interpretationValidCount: 11,
      interpretationValidationRate: 1,
    }),
    "横断解釈 11/11（100%）",
  );
});

test("Case G: Next Question に direct ラベルを付けない", () => {
  assert.equal(supportTypeLabel("nextQuestion", "direct"), null);
});

test("Shift の direct は 元発言から確認", () => {
  assert.equal(supportTypeLabel("shift", "direct"), "元発言から確認");
});

test("Hard Guard除外 0件も表示できる", () => {
  assert.equal(
    formatHardGuardExcluded({
      hardItemCount: 0,
      hardValidCount: 0,
      hardExcludedCount: 0,
    }),
    "Hard Guard除外 0件",
  );
});
