import assert from "node:assert/strict";
import test from "node:test";
import { currentProjectContext } from "@/lib/app/current-context";
import {
  INTEGRATED_REVIEW_PROMPT_V1,
  INTEGRATED_REVIEW_PROMPT_V2,
  INTEGRATED_REVIEW_PROMPT_V3,
  INTEGRATED_REVIEW_PROMPT_VERSION,
  INTEGRATED_REVIEW_SYSTEM_PROMPT,
  INTEGRATED_REVIEW_SYSTEM_PROMPT_V1,
  INTEGRATED_REVIEW_SYSTEM_PROMPT_V2,
  INTEGRATED_REVIEW_SYSTEM_PROMPT_V3,
  buildIntegratedReviewUserPromptV3,
} from "./integrated-review";

test("現行 promptVersion は integrated-review-v3", () => {
  assert.equal(INTEGRATED_REVIEW_PROMPT_VERSION, "integrated-review-v3");
  assert.equal(INTEGRATED_REVIEW_PROMPT_V3, "integrated-review-v3");
  assert.equal(INTEGRATED_REVIEW_SYSTEM_PROMPT, INTEGRATED_REVIEW_SYSTEM_PROMPT_V3);
});

test("v1 / v2 プロンプトは残している", () => {
  assert.equal(INTEGRATED_REVIEW_PROMPT_V1, "integrated-review-v1");
  assert.equal(INTEGRATED_REVIEW_PROMPT_V2, "integrated-review-v2");
  assert.match(INTEGRATED_REVIEW_SYSTEM_PROMPT_V1, /要約ではありません/);
  assert.match(INTEGRATED_REVIEW_SYSTEM_PROMPT_V2, /1段上の共通構造を優先する/);
});

test("v3 システムプロンプトにプロジェクト名をハードコードしない", () => {
  assert.doesNotMatch(
    INTEGRATED_REVIEW_SYSTEM_PROMPT_V3,
    new RegExp(currentProjectContext.projectName),
  );
});

test("Case A: CURRENT CONTEXT の現在名称を Summary で使う", () => {
  const user = buildIntegratedReviewUserPromptV3("SESSION S01\n古い名称");
  const contextIdx = user.indexOf("CURRENT CONTEXT");
  const sessionIdx = user.indexOf("SESSION S01");
  assert.ok(contextIdx >= 0);
  assert.ok(sessionIdx > contextIdx);
  assert.match(user, /Project Name:\n思考統合研究所/);
  assert.match(
    INTEGRATED_REVIEW_SYSTEM_PROMPT_V3,
    /現在のプロジェクト名は CURRENT CONTEXT の Project Name を使う/,
  );
});

test("Case B: 古い名称は削除せず歴史情報として扱う", () => {
  assert.match(
    INTEGRATED_REVIEW_SYSTEM_PROMPT_V3,
    /過去: 名称A（削除せず歴史情報として扱う）/,
  );
});

test("Case C: Current Context だけから名称変更 Shift を作らない", () => {
  assert.match(
    INTEGRATED_REVIEW_SYSTEM_PROMPT_V3,
    /CURRENT CONTEXT だけを根拠に「ユーザーが名称変更を決定した」/,
  );
  assert.match(
    INTEGRATED_REVIEW_SYSTEM_PROMPT_V3,
    /CURRENT CONTEXT だけから Shift を作らない/,
  );
});

test("Case D: 誇張した検証不能 Hypothesis を禁止する", () => {
  assert.match(INTEGRATED_REVIEW_SYSTEM_PROMPT_V3, /劇的に改善する/);
  assert.match(INTEGRATED_REVIEW_SYSTEM_PROMPT_V3, /誇張/);
});

test("Case E: 検証可能な Hypothesis と validationIdea を要求する", () => {
  assert.match(
    INTEGRATED_REVIEW_SYSTEM_PROMPT_V3,
    /単一Session分析では出なかった方針変化/,
  );
  assert.match(INTEGRATED_REVIEW_SYSTEM_PROMPT_V3, /validationIdea/);
});

test("Case G: Cross Insight と Hypothesis を重複させない", () => {
  assert.match(
    INTEGRATED_REVIEW_SYSTEM_PROMPT_V3,
    /Cross Insight と Hypothesis が重複していないか/,
  );
  assert.match(
    INTEGRATED_REVIEW_SYSTEM_PROMPT_V3,
    /Cross Insight と同文にしない/,
  );
});

test("Case H / I: 弱い Next Question を禁止し、境界の問いを推奨する", () => {
  assert.match(INTEGRATED_REVIEW_SYSTEM_PROMPT_V3, /次のステップは何か？/);
  assert.match(
    INTEGRATED_REVIEW_SYSTEM_PROMPT_V3,
    /自動化と本人判断の境界をどこに置くべきか/,
  );
});

test("Case J: 解決済みの問いを Open Question に残さない", () => {
  assert.match(INTEGRATED_REVIEW_SYSTEM_PROMPT_V3, /CursorかClaude Codeか/);
  assert.match(INTEGRATED_REVIEW_SYSTEM_PROMPT_V3, /その問いを残さない/);
});
