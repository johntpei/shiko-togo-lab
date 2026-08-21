import assert from "node:assert/strict";
import test from "node:test";
import {
  CONCEPT_EXTRACT_PROMPT_VERSION,
  CONCEPT_EXTRACT_SYSTEM_PROMPT,
  buildConceptExtractUserPrompt,
} from "./concept-extract";
import { emptyConceptCatalog } from "@/lib/concepts/catalog";
import { prepareUserEvidenceUnits } from "@/lib/concepts/user-units";

const LONG_USER =
  "高性能AIについて詳しく話したいと思っています。距離感の話も続けます。";
const LONG_ASSISTANT =
  "了解しました。高性能AIと距離感の両方について整理して返しますね。愛着不安かもしれません。";

test("現行 promptVersion は concept-extract-prompt-v1", () => {
  assert.equal(CONCEPT_EXTRACT_PROMPT_VERSION, "concept-extract-prompt-v1");
});

test("Prompt は USER 表現からの深層解釈・Claim・Relation・人名を禁止する", () => {
  const prompt = CONCEPT_EXTRACT_SYSTEM_PROMPT;
  assert.match(prompt, /返信を待っている/);
  assert.match(prompt, /愛着不安/);
  assert.match(prompt, /心理診断/);
  assert.match(prompt, /Claim/);
  assert.match(prompt, /自動化と人間判断/);
  assert.match(prompt, /個人名/);
  assert.match(prompt, /質問 \/ 相談 \/ 方法 \/ 今日/);
  assert.match(prompt, /ChatGPTに聞いてみた/);
  assert.match(prompt, /比較・判断の対象/);
  assert.match(prompt, /UNCERTAIN/);
  assert.match(prompt, /over-merge より fragmentation/);
  assert.match(prompt, /ConceptRef/);
  assert.match(prompt, /連続文字列/);
});

test("User prompt は USER Units だけで Assistant / Review を含めない", () => {
  const units = prepareUserEvidenceUnits({
    sessionId: "session-1",
    occurredAt: "2026-08-02",
    messages: [
      { id: "msg-1", role: "user", content: LONG_USER },
      { id: "msg-2", role: "assistant", content: LONG_ASSISTANT },
    ],
  });
  const userPrompt = buildConceptExtractUserPrompt({
    catalog: emptyConceptCatalog(),
    units,
  });
  assert.match(userPrompt, /\[M001:E01\]\[USER\]/);
  assert.doesNotMatch(userPrompt, /\[ASSISTANT\]/);
  assert.doesNotMatch(userPrompt, /了解しました/);
  assert.doesNotMatch(userPrompt, /愛着不安かもしれません/);
  assert.doesNotMatch(userPrompt, /Review/);
  assert.doesNotMatch(userPrompt, /Observation/);
});
