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

export function isAnalyzeInputTooLong(labeledTranscript: string) {
  return labeledTranscript.length > ANALYZE_SESSION_MAX_INPUT_CHARS;
}
