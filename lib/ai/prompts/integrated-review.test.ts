import assert from "node:assert/strict";
import test from "node:test";
import { APP_NAME } from "@/lib/app/identity";
import {
  INTEGRATED_REVIEW_PROMPT_V1,
  INTEGRATED_REVIEW_PROMPT_V2,
  INTEGRATED_REVIEW_PROMPT_VERSION,
  INTEGRATED_REVIEW_SYSTEM_PROMPT,
  INTEGRATED_REVIEW_SYSTEM_PROMPT_V1,
  INTEGRATED_REVIEW_SYSTEM_PROMPT_V2,
} from "./integrated-review";

test("現行 promptVersion は integrated-review-v2", () => {
  assert.equal(INTEGRATED_REVIEW_PROMPT_VERSION, "integrated-review-v2");
  assert.equal(INTEGRATED_REVIEW_PROMPT_V2, "integrated-review-v2");
  assert.equal(INTEGRATED_REVIEW_SYSTEM_PROMPT, INTEGRATED_REVIEW_SYSTEM_PROMPT_V2);
});

test("v1 プロンプトは残している", () => {
  assert.equal(INTEGRATED_REVIEW_PROMPT_V1, "integrated-review-v1");
  assert.match(INTEGRATED_REVIEW_SYSTEM_PROMPT_V1, /要約ではありません/);
});

test("Case A: Evidenceにないリピートユーザー仮説を禁止する", () => {
  assert.match(INTEGRATED_REVIEW_SYSTEM_PROMPT_V2, /リピートユーザーを増やす/);
  assert.match(INTEGRATED_REVIEW_SYSTEM_PROMPT_V2, /Evidenceに存在しないテーマ領域へ飛躍しない/);
});

test("Case B: 一般的な「AI活用」だけの Common Theme を出さない", () => {
  assert.match(INTEGRATED_REVIEW_SYSTEM_PROMPT_V2, /悪い例: 「AI活用」/);
  assert.match(
    INTEGRATED_REVIEW_SYSTEM_PROMPT_V2,
    /1段上の共通構造を優先する/,
  );
});

test("Case C: 構造的な Cross Insight を最重要にする", () => {
  assert.match(INTEGRATED_REVIEW_SYSTEM_PROMPT_V2, /ボトルネックがAIの思考能力から/);
  assert.match(INTEGRATED_REVIEW_SYSTEM_PROMPT_V2, /crossInsights/);
  assert.match(INTEGRATED_REVIEW_SYSTEM_PROMPT_V2, /最重要/);
});

test("Case D: 現在名称と新しい Decision を優先する", () => {
  assert.match(INTEGRATED_REVIEW_SYSTEM_PROMPT_V2, new RegExp(APP_NAME));
  assert.match(INTEGRATED_REVIEW_SYSTEM_PROMPT_V2, /新しいSessionの明示的な USER Decision/);
  assert.match(INTEGRATED_REVIEW_SYSTEM_PROMPT_V2, /現在名称をそれで上書きしない/);
});

test("Case E: 解決済みの問いを Open Question に残さない", () => {
  assert.match(INTEGRATED_REVIEW_SYSTEM_PROMPT_V2, /CursorかClaude Codeか/);
  assert.match(INTEGRATED_REVIEW_SYSTEM_PROMPT_V2, /その問いを残さない/);
});

test("Case F / G: 弱い Next Question を禁止し、境界の問いを推奨する", () => {
  assert.match(INTEGRATED_REVIEW_SYSTEM_PROMPT_V2, /検討する必要があるか？/);
  assert.match(
    INTEGRATED_REVIEW_SYSTEM_PROMPT_V2,
    /自動化と本人判断の境界をどこに置くべきか/,
  );
});

test("Case H: Cross Insight は 2 Session 以上の Evidence が必須", () => {
  assert.match(
    INTEGRATED_REVIEW_SYSTEM_PROMPT_V2,
    /# crossInsights[\s\S]*異なる2 Session以上の EvidenceRef が必須/,
  );
});

test("Case I: Common Theme と Cross Insight の重複を避ける", () => {
  assert.match(
    INTEGRATED_REVIEW_SYSTEM_PROMPT_V2,
    /Common Theme と Cross Insight がほぼ同じ内容になっていないか/,
  );
});

test("Case J: 仮説が無ければ空配列を許可する", () => {
  assert.match(INTEGRATED_REVIEW_SYSTEM_PROMPT_V2, /hypotheses は空配列/);
  assert.match(INTEGRATED_REVIEW_SYSTEM_PROMPT_V2, /0件でも正常/);
});
