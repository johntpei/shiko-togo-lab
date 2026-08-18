/**
 * STEP 4 の入力上限。1か所で管理する。
 *
 * gpt-4o-mini など Structured Outputs 対応のコスト効率モデルは
 * 128k tokens 前後の context window を持つ。
 * 日本語は概ね 1〜2 tokens/字。システムプロンプトと出力（項目・引用）の余裕を
 * 大きく残し、本文入力は 40,000 字を上限とする（概算 20k〜40k tokens）。
 */
export const ANALYZE_SESSION_MAX_INPUT_CHARS = 40_000;

export const ANALYZE_SESSION_TIMEOUT_MS = 120_000;

/**
 * STEP 5 の複数Session統合レビュー入力上限。1か所で管理する。
 *
 * 単体Sessionの 40,000 字は維持したまま、複数Session合計用に別定数を置く。
 * 128k context を前提に、システムプロンプト・構造化出力の余裕を大きく残し、
 * 本文入力は 80,000 字を上限とする。
 */
export const INTEGRATED_REVIEW_MAX_INPUT_CHARS = 80_000;

export const INTEGRATED_REVIEW_TIMEOUT_MS = 180_000;

export const MIN_INTEGRATED_REVIEW_SESSIONS = 2;

export const MAX_NEXT_QUESTIONS = 3;
export const MAX_COMMON_THEMES = 3;
export const MAX_CROSS_INSIGHTS = 3;
export const MAX_HYPOTHESES = 2;
export const MAX_OPEN_QUESTIONS = 5;

export const MAX_REVIEW_EVIDENCE_REFS_PER_ITEM = 4;

export const CONTEXT_PACK_MAX_SOURCE_CHARS = 20_000;
export const CONTEXT_PACK_MAX_OUTPUT_CHARS = 8_000;
export const CONTEXT_PACK_TIMEOUT_MS = 90_000;

export const MAX_PACK_CONFIRMED = 5;
export const MAX_PACK_INSIGHTS = 3;
export const MAX_PACK_TENSIONS = 2;
export const MAX_PACK_HYPOTHESES = 2;
export const MAX_PACK_OPEN_QUESTIONS = 3;
export const MAX_PACK_USER_FACTS = 3;

export function isAnalyzeInputTooLong(labeledTranscript: string) {
  return labeledTranscript.length > ANALYZE_SESSION_MAX_INPUT_CHARS;
}

export function isIntegratedReviewInputTooLong(labeledTranscript: string) {
  return labeledTranscript.length > INTEGRATED_REVIEW_MAX_INPUT_CHARS;
}

export function isContextPackSourceTooLong(labeledSource: string) {
  return labeledSource.length > CONTEXT_PACK_MAX_SOURCE_CHARS;
}
