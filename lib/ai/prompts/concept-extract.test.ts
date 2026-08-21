import assert from "node:assert/strict";
import test from "node:test";
import {
  CONCEPT_EXTRACT_PROMPT_VERSION,
  CONCEPT_EXTRACT_SYSTEM_PROMPT,
  CONCEPT_EXTRACT_SYSTEM_PROMPT_V4,
  buildConceptExtractRepairUserPrompt,
  buildConceptExtractUserPrompt,
} from "./concept-extract";
import { emptyConceptCatalog } from "@/lib/concepts/catalog";
import { prepareUserEvidenceUnits } from "@/lib/concepts/user-units";

const LONG_USER =
  "高性能AIについて詳しく話したいと思っています。距離感の話も続けます。";
const LONG_ASSISTANT =
  "了解しました。高性能AIと距離感の両方について整理して返しますね。愛着不安かもしれません。";

test("現行 promptVersion は concept-extract-prompt-v5", () => {
  assert.equal(CONCEPT_EXTRACT_PROMPT_VERSION, "concept-extract-prompt-v5");
});

test("Prompt v4 定義は残し、現行は v5 を使う", () => {
  assert.match(CONCEPT_EXTRACT_SYSTEM_PROMPT_V4, /shortest identity-preserving span/);
  assert.equal(
    CONCEPT_EXTRACT_SYSTEM_PROMPT === CONCEPT_EXTRACT_SYSTEM_PROMPT_V4,
    false,
  );
});

test("Prompt v5 は Session-level selection と soft unique budget を明示する", () => {
  const prompt = CONCEPT_EXTRACT_SYSTEM_PROMPT;
  assert.match(prompt, /Session-level Concept selection/);
  assert.match(prompt, /網羅抽出ではない/);
  assert.match(prompt, /少数の安定 Node/);
  assert.match(prompt, /Session 全体を見て/);
  assert.match(prompt, /通常 3〜8 程度で十分/);
  assert.match(prompt, /unique の種類数/);
  assert.match(prompt, /20〜30 個の局所的な名詞句を大量 NEW することは通常誤り/);
});

test("Prompt v5 は Map \+ Timeline Test と Centrality を明示する", () => {
  const prompt = CONCEPT_EXTRACT_SYSTEM_PROMPT;
  assert.match(prompt, /Map \+ Timeline Test/);
  assert.match(prompt, /Thought Map の node として単独表示/);
  assert.match(prompt, /このテーマにまた戻ってきた/);
  assert.match(prompt, /判断・比較・設計・理解しようとしている/);
  assert.match(prompt, /エピソードの構成要素 → skip/);
});

test("Prompt v5 は generic SKIP と specific stable 保持を明示する", () => {
  const prompt = CONCEPT_EXTRACT_SYSTEM_PROMPT;
  assert.match(prompt, /気持ち \/ 高性能 \/ テーマ \/ ツール \/ データ \/ 設計/);
  assert.match(prompt, /辛い \/ 怖い \/ どうでもいい \/ 論理的 \/ 臨機応変/);
  assert.match(prompt, /感じ \/ 状態 \/ 方法/);
  assert.match(prompt, /人間関係 \/ 他者モデル構築 \/ 負の連鎖/);
  assert.match(prompt, /他者モデル構築は名詞句・specific・stable/);
  assert.match(prompt, /他者モデル構築 → 他者モデル構築/);
  assert.match(prompt, /高性能AI → 高性能AI（高性能 は通常 skip）/);
  assert.match(prompt, /統合支援ツール → 統合支援ツール（ツール は通常 skip）/);
  assert.match(prompt, /自分の気持ち → 文脈によって候補（気持ち は通常 skip）/);
  assert.match(prompt, /人間関係 → GOOD（関係 は skip）/);
});

test("Prompt v5 は clause / episodic SKIP と exact recurrence を明示する", () => {
  const prompt = CONCEPT_EXTRACT_SYSTEM_PROMPT;
  assert.match(prompt, /一生を1人で過ごすこと/);
  assert.match(prompt, /女性をともに過ごしたい欲求/);
  assert.match(prompt, /連鎖から抜け出す方法/);
  assert.match(prompt, /精神的にもしんどい状況/);
  assert.match(prompt, /プレゼント \/ 食事 \/ セッティング/);
  assert.match(prompt, /エピソードだから skip/);
  assert.match(prompt, /Catalog「人間関係」かつ Unit が「人間関係について〜」/);
  assert.match(prompt, /「高性能」exact MATCH をしない/);
  assert.match(prompt, /女性の気持ち \/ 相手の気持ち \/ 自分の気持ち \/ 人の気持ち は別 Identity/);
});

test("Prompt v5 は Related != Identity の negative を持つ", () => {
  const prompt = CONCEPT_EXTRACT_SYSTEM_PROMPT;
  assert.match(prompt, /寂しさ ≠ 女性の気持ち/);
  assert.match(prompt, /気持ち ≠ 自分の気持ち/);
  assert.match(prompt, /気持ち ≠ 相手の気持ち/);
  assert.match(prompt, /他者モデル構築 ≠ モデル/);
  assert.match(prompt, /統合支援ツール ≠ 第2の脳/);
  assert.match(prompt, /統合支援ツール ≠ 高性能AI/);
  assert.match(prompt, /高性能 ≠ 高性能AI/);
  assert.match(prompt, /ADHDの記憶力 ≠ 人の気持ちを考えられない/);
});

test("User prompt は Catalog exact surface と substring 禁止を指示する", () => {
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
  assert.match(userPrompt, /# Required EvidenceRefs/);
  for (const unit of units) {
    assert.match(userPrompt, new RegExp(`- ${unit.evidenceRef}`));
  }
  assert.match(userPrompt, /Session 全体の主要な思考対象を把握する/);
  assert.match(userPrompt, /通常 3〜8 unique Concept/);
  assert.match(userPrompt, /置き換え可能な同一 Concept 名なら MATCH/);
  assert.match(userPrompt, /Catalog canonicalLabel と同一の文字列/);
  assert.match(userPrompt, /Catalog「気持ち」に対し「自分の気持ち」から「気持ち」だけ MATCH しない/);
  assert.match(userPrompt, /Catalog「高性能」に対し「高性能AI」から「高性能」だけ MATCH しない/);
  assert.match(userPrompt, /\[M001:E01\]\[USER\]/);
  assert.doesNotMatch(userPrompt, /\[ASSISTANT\]/);
  assert.doesNotMatch(userPrompt, /了解しました/);
  assert.doesNotMatch(userPrompt, /愛着不安かもしれません/);
  assert.doesNotMatch(userPrompt, /Review/);
  assert.doesNotMatch(userPrompt, /Observation/);
});

test("repair prompt は missing / duplicate / unknown を示す", () => {
  const units = prepareUserEvidenceUnits({
    sessionId: "session-1",
    occurredAt: "2026-08-02",
    messages: [{ id: "msg-1", role: "user", content: LONG_USER }],
  });
  const repair = buildConceptExtractRepairUserPrompt({
    catalog: emptyConceptCatalog(),
    units,
    coverageReason: "duplicate_evidence_ref",
    coverageDetail: "M001:E01",
  });
  assert.match(repair, /Coverage repair/);
  assert.match(repair, /duplicate_evidence_ref/);
  assert.match(repair, /M001:E01/);
  assert.match(repair, /正確に1回だけ/);
});
