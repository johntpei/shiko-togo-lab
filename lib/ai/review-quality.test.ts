import assert from "node:assert/strict";
import test from "node:test";
import {
  claimLeapsToUnmentionedDomain,
  isGenericCommonTheme,
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
