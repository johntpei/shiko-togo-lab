import assert from "node:assert/strict";
import test from "node:test";
import { currentProjectContext } from "@/lib/app/current-context";
import {
  INTEGRATED_REVIEW_PROMPT_V1,
  INTEGRATED_REVIEW_PROMPT_V2,
  INTEGRATED_REVIEW_PROMPT_V3,
  INTEGRATED_REVIEW_PROMPT_V4,
  INTEGRATED_REVIEW_PROMPT_VERSION,
  INTEGRATED_REVIEW_SYSTEM_PROMPT,
  INTEGRATED_REVIEW_SYSTEM_PROMPT_V1,
  INTEGRATED_REVIEW_SYSTEM_PROMPT_V2,
  INTEGRATED_REVIEW_SYSTEM_PROMPT_V3,
  INTEGRATED_REVIEW_SYSTEM_PROMPT_V4,
  buildIntegratedReviewUserPromptV4,
} from "./integrated-review";

test("現行 promptVersion は integrated-review-v4", () => {
  assert.equal(INTEGRATED_REVIEW_PROMPT_VERSION, "integrated-review-v4");
  assert.equal(INTEGRATED_REVIEW_PROMPT_V4, "integrated-review-v4");
  assert.equal(INTEGRATED_REVIEW_SYSTEM_PROMPT, INTEGRATED_REVIEW_SYSTEM_PROMPT_V4);
});

test("v1 / v2 / v3 プロンプトは残している", () => {
  assert.equal(INTEGRATED_REVIEW_PROMPT_V1, "integrated-review-v1");
  assert.equal(INTEGRATED_REVIEW_PROMPT_V2, "integrated-review-v2");
  assert.equal(INTEGRATED_REVIEW_PROMPT_V3, "integrated-review-v3");
  assert.match(INTEGRATED_REVIEW_SYSTEM_PROMPT_V1, /要約ではありません/);
  assert.match(INTEGRATED_REVIEW_SYSTEM_PROMPT_V2, /1段上の共通構造を優先する/);
  assert.match(INTEGRATED_REVIEW_SYSTEM_PROMPT_V3, /validationIdea/);
});

test("v4 システムプロンプトにプロジェクト名をハードコードしない", () => {
  assert.doesNotMatch(
    INTEGRATED_REVIEW_SYSTEM_PROMPT_V4,
    new RegExp(currentProjectContext.projectName),
  );
});

test("Case I: CURRENT CONTEXT の現在名称を Summary で使う", () => {
  const user = buildIntegratedReviewUserPromptV4("SESSION S01\n思考補完計画｜統合研究所");
  const contextIdx = user.indexOf("CURRENT CONTEXT");
  const sessionIdx = user.indexOf("SESSION S01");
  assert.ok(contextIdx >= 0);
  assert.ok(sessionIdx > contextIdx);
  assert.match(user, /Project Name:\n思考統合研究所/);
  assert.match(user, /Core Purpose:/);
  assert.match(
    INTEGRATED_REVIEW_SYSTEM_PROMPT_V4,
    /古い名称は歴史として残し、現在名にしない/,
  );
});

test("Case B: 解釈文が原文に無くても出してよい", () => {
  assert.match(
    INTEGRATED_REVIEW_SYSTEM_PROMPT_V4,
    /解釈文そのものが原文に無くてよい/,
  );
});

test("Case G / H: Next Question の品質", () => {
  assert.match(INTEGRATED_REVIEW_SYSTEM_PROMPT_V4, /次のステップは何か？/);
  assert.match(
    INTEGRATED_REVIEW_SYSTEM_PROMPT_V4,
    /自動化と本人判断の境界をどこに置くべきか/,
  );
  assert.match(
    INTEGRATED_REVIEW_SYSTEM_PROMPT_V4,
    /EvidenceRef は必須ではない/,
  );
});

test("Case J: Common Theme / Cross Insight / Hypothesis の重複を避ける", () => {
  assert.match(
    INTEGRATED_REVIEW_SYSTEM_PROMPT_V4,
    /Common Theme \/ Cross Insight \/ Hypothesis が重複していないか/,
  );
});
