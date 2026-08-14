import assert from "node:assert/strict";
import test from "node:test";
import {
  assertMessageAnchors,
  parseTranscript,
} from "./parse-transcript";

function parseChecked(raw: string) {
  const messages = parseTranscript(raw);
  assertMessageAnchors(raw, messages);
  return messages;
}

test("Case A: User / Assistant の交互", () => {
  const raw = `User:
今日の予定を整理したいです。

Assistant:
まず最優先の3件を書き出しましょう。

User:
会議と原稿と買い物です。
`;
  const messages = parseChecked(raw);
  assert.equal(messages.length, 3);
  assert.equal(messages[0].role, "user");
  assert.equal(messages[1].role, "assistant");
  assert.equal(messages[2].role, "user");
  assert.match(messages[0].content, /今日の予定/);
  assert.match(messages[1].content, /最優先の3件/);
  assert.match(messages[2].content, /会議と原稿/);
  assert.ok(!messages[0].content.startsWith("User:"));
});

test("Case B: You said / ChatGPT said", () => {
  const raw = `You said:
この方針で進めてよい？

ChatGPT said:
前提が同じなら、その方針で問題ありません。
`;
  const messages = parseChecked(raw);
  assert.equal(messages.length, 2);
  assert.equal(messages[0].role, "user");
  assert.equal(messages[1].role, "assistant");
  assert.match(messages[0].content, /この方針/);
  assert.match(messages[1].content, /問題ありません/);
});

test("Case C: 日本語話者ラベル", () => {
  const raw = `ユーザー：
睡眠時間を伸ばしたい。

アシスタント：
就寝時刻を30分早める実験から始めましょう。
`;
  const messages = parseChecked(raw);
  assert.equal(messages.length, 2);
  assert.equal(messages[0].role, "user");
  assert.equal(messages[1].role, "assistant");
  assert.match(messages[0].content, /睡眠時間/);
  assert.match(messages[1].content, /30分/);
});

test("Case D: 話者ラベルがない文章は unknown で欠落しない", () => {
  const raw = `これはラベルのないメモです。

次の段落もあります。
どちらも残るべきです。`;
  const messages = parseChecked(raw);
  assert.ok(messages.length >= 1);
  assert.ok(messages.every((message) => message.role === "unknown"));
  const joined = messages.map((message) => message.content).join("");
  assert.ok(joined.includes("ラベルのないメモ"));
  assert.ok(joined.includes("次の段落もあります"));
  assert.equal(
    messages.reduce((sum, message) => sum + (message.charEnd - message.charStart), 0) +
      (raw.length - messages.reduce((sum, message) => sum + (message.charEnd - message.charStart), 0)),
    raw.length,
  );
});

test("Case E: 行中の Assistant: では誤分割しない", () => {
  const raw = `User:
本文の途中に Assistant: という文字列が登場します。

Assistant:
行頭のラベルだけを境界にします。
`;
  const messages = parseChecked(raw);
  assert.equal(messages.length, 2);
  assert.equal(messages[0].role, "user");
  assert.equal(messages[1].role, "assistant");
  assert.match(messages[0].content, /Assistant:/);
  assert.equal(
    messages.filter((message) => message.content.includes("行頭のラベル")).length,
    1,
  );
});

test("Case F: 非常に長い回答でも欠落しない", () => {
  const longAnswer = "あ".repeat(20000);
  const raw = `You:
短く質問します。

ChatGPT:
${longAnswer}
`;
  const messages = parseChecked(raw);
  assert.equal(messages.length, 2);
  assert.equal(messages[1].role, "assistant");
  assert.ok(messages[1].content.includes(longAnswer));
  assert.equal(messages[1].content.includes(longAnswer), true);
  assert.ok(messages[1].charEnd - messages[1].charStart >= longAnswer.length);
});

test("先頭のラベルなし文は unknown として残す", () => {
  const raw = `これは前置きです。

User:
本体の質問です。
`;
  const messages = parseChecked(raw);
  assert.equal(messages[0].role, "unknown");
  assert.match(messages[0].content, /前置き/);
  assert.equal(messages[1].role, "user");
});
