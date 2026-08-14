import assert from "node:assert/strict";
import test from "node:test";
import { ANALYZE_SESSION_MAX_INPUT_CHARS } from "./limits";
import { buildAnalyzeInput } from "./session-input";
import type { AnalyzeMessage } from "./session-input";

function message(
  id: string,
  role: string,
  content: string,
  attachmentsJson: string | null = null,
): AnalyzeMessage {
  return { id, role, content, attachmentsJson };
}

test("Case I: ChatGPT Export 由来の User / Assistant を参照ID付きで渡す", () => {
  const input = buildAnalyzeInput([
    message("u1", "user", "方針を決めたいです。"),
    message(
      "a1",
      "assistant",
      "A案とB案があります。",
      JSON.stringify([{ name: "diagram.png", mimeType: "image/png" }]),
    ),
    message("u2", "user", "A案で進める。"),
  ]);

  assert.equal(input.analyzableCount, 3);
  assert.match(input.labeledTranscript, /\[S1:M001\]\[USER\]/);
  assert.match(input.labeledTranscript, /方針を決めたいです。/);
  assert.match(input.labeledTranscript, /\[S1:M002\]\[ASSISTANT\]/);
  assert.match(input.labeledTranscript, /（添付ファイルあり）/);
  assert.doesNotMatch(input.labeledTranscript, /image\/png/);
  assert.equal(input.refToMessageId.get("M001"), "u1");
  assert.equal(input.refToMessageId.get("M003"), "u2");
});

test("Case J: 手動登録の unknown は分析対象にしない", () => {
  const input = buildAnalyzeInput([
    message("n1", "unknown", "ラベルのないメモ"),
    message("u1", "user", "この方針で進める。"),
    message("a1", "assistant", "了解しました。"),
  ]);

  assert.equal(input.analyzableCount, 2);
  assert.doesNotMatch(input.labeledTranscript, /ラベルのないメモ/);
  assert.equal(input.refToMessageId.get("M001"), "u1");
  assert.equal(input.refToMessageId.get("M002"), "a1");
});

test("Case H: 上限定数は1か所で、長大入力を判定できる", () => {
  const oversized = "あ".repeat(ANALYZE_SESSION_MAX_INPUT_CHARS + 1);
  const input = buildAnalyzeInput([message("u1", "user", oversized)]);
  assert.ok(input.labeledTranscript.length > ANALYZE_SESSION_MAX_INPUT_CHARS);
});
