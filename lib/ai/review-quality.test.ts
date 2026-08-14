import assert from "node:assert/strict";
import test from "node:test";
import {
  claimLeapsToUnmentionedDomain,
  hasUnsupportedExaggeration,
  isGenericCommonTheme,
  isUnverifiableHypothesis,
  isVagueValidationIdea,
  isWeakNextQuestion,
  textsAreNearDuplicates,
} from "./review-quality";

test("Case A: Evidenceにないリピートユーザー概念への飛躍を検出する", () => {
  const evidence =
    "AIとの対話が大量に増えた。過去の知見を整理したい。AI活用を自動化したい。";
  assert.equal(
    claimLeapsToUnmentionedDomain(
      "リピートユーザーを増やす鍵が得られる。",
      evidence,
    ),
    true,
  );
  assert.equal(
    claimLeapsToUnmentionedDomain(
      "保存より再利用がボトルネックである可能性がある。",
      evidence,
    ),
    false,
  );
});

test("Case B: 「AI活用」だけの Common Theme は generic", () => {
  assert.equal(isGenericCommonTheme("AI活用"), true);
  assert.equal(
    isGenericCommonTheme(
      "高性能AIそのものより、人間側の情報整理や運用設計へ価値の中心が移っている。",
    ),
    false,
  );
});

test("Case F: 「検討する必要があるか？」は弱い Next Question", () => {
  assert.equal(
    isWeakNextQuestion("今後のセッションで、具体的な運用フローをさらに検討する必要があるか？"),
    true,
  );
});

test("Case G: 境界を問う Next Question は適格", () => {
  assert.equal(
    isWeakNextQuestion("自動化と本人判断の境界をどこに置くべきか？"),
    false,
  );
});

test("Case I: Cross Insight と Common Theme のほぼ同一を検出する", () => {
  const theme = "AI活用の価値とその方法";
  assert.equal(textsAreNearDuplicates(theme, "AI活用の価値とその方法。"), true);
  assert.equal(
    textsAreNearDuplicates(
      theme,
      "AI性能の向上によって、ボトルネックが人間側の知見管理へ移っている。",
    ),
    false,
  );
});

test("Case D: 定量情報なしの『劇的に効率が向上する』は不適格", () => {
  assert.equal(hasUnsupportedExaggeration("劇的に効率が向上する"), true);
  assert.equal(isUnverifiableHypothesis("劇的に改善する可能性がある"), true);
});

test("Case E: 検証可能な Hypothesis は誇張でも曖昧 validation でもない", () => {
  const text =
    "統合Reviewで単体分析にはないShiftを検出できる可能性がある。";
  const idea =
    "同じ3 Sessionについて、単体分析と統合Reviewの出力を比較し、統合Reviewでのみ現れた新規Insightの数と有用性を確認する。";
  assert.equal(hasUnsupportedExaggeration(text), false);
  assert.equal(isUnverifiableHypothesis(text), false);
  assert.equal(isVagueValidationIdea(idea), false);
});

test("Case F: 『今後確認する』は validationIdea として不適格", () => {
  assert.equal(isVagueValidationIdea("今後確認する"), true);
  assert.equal(isVagueValidationIdea("使ってみる"), true);
});

test("Case G: Cross Insight と同文の Hypothesis は重複", () => {
  const insight =
    "AI性能向上により、人間側の知見整理が新しいボトルネックになっている。";
  assert.equal(textsAreNearDuplicates(insight, insight), true);
});

test("Case H: 『次のステップは何か？』は弱い Next Question", () => {
  assert.equal(isWeakNextQuestion("次のステップは何か？"), true);
});

test("Case I: 境界を問う Next Question は適格", () => {
  assert.equal(
    isWeakNextQuestion("自動化と本人判断の境界をどこに置くべきか？"),
    false,
  );
});
