import assert from "node:assert/strict";
import test from "node:test";
import { currentProjectContext } from "@/lib/app/current-context";
import {
  INTEGRATED_REVIEW_PROMPT_V1,
  INTEGRATED_REVIEW_PROMPT_V2,
  INTEGRATED_REVIEW_PROMPT_V3,
  INTEGRATED_REVIEW_PROMPT_V4,
  INTEGRATED_REVIEW_PROMPT_V5,
  INTEGRATED_REVIEW_PROMPT_VERSION,
  INTEGRATED_REVIEW_SYSTEM_PROMPT,
  INTEGRATED_REVIEW_SYSTEM_PROMPT_V1,
  INTEGRATED_REVIEW_SYSTEM_PROMPT_V4,
  INTEGRATED_REVIEW_SYSTEM_PROMPT_V5,
  buildIntegratedReviewUserPromptV5,
} from "./integrated-review";

test("現行 promptVersion は integrated-review-v5", () => {
  assert.equal(INTEGRATED_REVIEW_PROMPT_VERSION, "integrated-review-v5");
  assert.equal(INTEGRATED_REVIEW_PROMPT_V5, "integrated-review-v5");
  assert.equal(INTEGRATED_REVIEW_SYSTEM_PROMPT, INTEGRATED_REVIEW_SYSTEM_PROMPT_V5);
});

test("v1〜v4 プロンプトは残している", () => {
  assert.equal(INTEGRATED_REVIEW_PROMPT_V1, "integrated-review-v1");
  assert.equal(INTEGRATED_REVIEW_PROMPT_V2, "integrated-review-v2");
  assert.equal(INTEGRATED_REVIEW_PROMPT_V3, "integrated-review-v3");
  assert.equal(INTEGRATED_REVIEW_PROMPT_V4, "integrated-review-v4");
  assert.match(INTEGRATED_REVIEW_SYSTEM_PROMPT_V1, /要約ではありません/);
  assert.match(INTEGRATED_REVIEW_SYSTEM_PROMPT_V4, /解釈文そのものが原文に無くてよい/);
});

test("v5 は Evidence-first でありプロジェクト名をハードコードしない", () => {
  assert.match(INTEGRATED_REVIEW_SYSTEM_PROMPT_V5, /Claimを先に考え、後からEvidenceを探してはいけない/);
  assert.match(INTEGRATED_REVIEW_SYSTEM_PROMPT_V5, /PHASE A/);
  assert.match(INTEGRATED_REVIEW_SYSTEM_PROMPT_V5, /PHASE B/);
  assert.match(INTEGRATED_REVIEW_SYSTEM_PROMPT_V5, /PHASE C/);
  assert.match(INTEGRATED_REVIEW_SYSTEM_PROMPT_V5, /evidenceGroups/);
  assert.match(INTEGRATED_REVIEW_SYSTEM_PROMPT_V5, /relationType/);
  assert.doesNotMatch(
    INTEGRATED_REVIEW_SYSTEM_PROMPT_V5,
    new RegExp(currentProjectContext.projectName),
  );
});

test("Case L: Current Context は Evidence に数えない", () => {
  assert.match(
    INTEGRATED_REVIEW_SYSTEM_PROMPT_V5,
    /Current Context は Evidence ではない。session数にも数えない/,
  );
  const user = buildIntegratedReviewUserPromptV5("SESSION S01");
  const contextIdx = user.indexOf("CURRENT CONTEXT");
  const sessionIdx = user.indexOf("SESSION S01");
  assert.ok(contextIdx >= 0 && sessionIdx > contextIdx);
});

test("Case H: fake EvidenceRef を作らない", () => {
  assert.match(INTEGRATED_REVIEW_SYSTEM_PROMPT_V5, /存在しないrefを作らない/);
  assert.match(INTEGRATED_REVIEW_SYSTEM_PROMPT_V5, /fake ref を作らず/);
});

test("Case M / N: Next Question は発見から作り、一般質問は禁止", () => {
  assert.match(
    INTEGRATED_REVIEW_SYSTEM_PROMPT_V5,
    /有効になった Cross Insight \/ Tension \/ Shift \/ Hypothesis \/ Open Question から作る/,
  );
  assert.match(INTEGRATED_REVIEW_SYSTEM_PROMPT_V5, /次のステップは何か？/);
  assert.match(INTEGRATED_REVIEW_SYSTEM_PROMPT_V5, /保存・統合・再利用のどこを最も優先/);
});
