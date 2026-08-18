import assert from "node:assert/strict";
import test from "node:test";
import {
  CONTEXT_PACK_PROMPT_VERSION,
  CONTEXT_PACK_SYSTEM_PROMPT,
  buildContextPackUserPrompt,
} from "./context-pack";

test("promptVersion は context-pack-v1", () => {
  assert.equal(CONTEXT_PACK_PROMPT_VERSION, "context-pack-v1");
});

test("Case J: currentQuestion がある場合は関連性を優先する", () => {
  assert.match(CONTEXT_PACK_SYSTEM_PROMPT, /その質問への関連性を最優先/);
  const user = buildContextPackUserPrompt({
    currentQuestion: "専用ツール独自の価値をどう作るか相談したい",
    labeledCandidates: "[R:INSIGHT:01] text",
  });
  assert.match(user, /専用ツール独自の価値をどう作るか相談したい/);
});

test("Case K: currentQuestion なしでも汎用Packとして生成できる", () => {
  const user = buildContextPackUserPrompt({
    currentQuestion: "  ",
    labeledCandidates: "[C:PROJECT_NAME] 思考統合研究所",
  });
  assert.match(user, /汎用Context Pack/);
});

test("Case L: Raw Message を送らない", () => {
  assert.match(CONTEXT_PACK_SYSTEM_PROMPT, /新しいFact・Insight・Hypothesisの文章は一切書かない/);
  const user = buildContextPackUserPrompt({
    currentQuestion: "",
    labeledCandidates: "[R:SUMMARY] 運用設計が主題。",
  });
  assert.match(user, /原文Messageは渡していません/);
  assert.doesNotMatch(user, /SESSION S01/);
});
