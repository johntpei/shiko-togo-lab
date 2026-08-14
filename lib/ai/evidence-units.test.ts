import assert from "node:assert/strict";
import test from "node:test";
import {
  assertUnitAnchors,
  splitMessageIntoEvidenceUnits,
  toEvidenceRef,
  toEvidenceRole,
  parseEvidenceRef,
} from "./evidence-units";

test("Case A: 日本語の複数文を Evidence Units へ分割する", () => {
  const content = `AIとの壁打ちは、AIが進化したからこそ、深く速くなっており、
正直それをADHDの記憶力では扱いきれないと感じる部分もありました。
せっかく議論されて出てきた素晴らしい内容を無駄にしないために、
複数のチャットをまとめて比較したいです。`;
  const units = splitMessageIntoEvidenceUnits(content);
  assert.ok(units.length >= 2);
  assertUnitAnchors(content, units);
  assert.ok(units.some((unit) => unit.text.includes("扱いきれない")));
  assert.ok(units.some((unit) => unit.text.includes("比較したいです")));
});

test("Case B: 長い1文は欠落しない", () => {
  const content = `${"あ".repeat(400)}これが末尾です`;
  const units = splitMessageIntoEvidenceUnits(content);
  assert.ok(units.length >= 1);
  assertUnitAnchors(content, units);
  const joined = units.map((unit) => unit.text).join("");
  assert.ok(joined.includes("これが末尾です"));
  assert.ok(joined.includes("あ".repeat(50)));
});

test("Case C: 箇条書きを安全に扱う", () => {
  const content = `- 保存する
- つなぐ
- 見抜く
- 次に進める`;
  const units = splitMessageIntoEvidenceUnits(content);
  assertUnitAnchors(content, units);
  const joined = units.map((unit) => unit.text).join("\n");
  assert.ok(joined.includes("- 保存する"));
  assert.ok(joined.includes("- 次に進める"));
});

test("Case D: Markdown を削除しない", () => {
  const content = "これは **重要** です。\n> 引用です。";
  const units = splitMessageIntoEvidenceUnits(content);
  assertUnitAnchors(content, units);
  const joined = units.map((unit) => unit.text).join("\n");
  assert.ok(joined.includes("**重要**"));
  assert.ok(joined.includes("> 引用です。"));
});

test("Case E: 改行の多い Message でも位置を保持する", () => {
  const content = "先頭です。\n\n\n途中です。\n\n末尾です。";
  const units = splitMessageIntoEvidenceUnits(content);
  assertUnitAnchors(content, units);
  for (const unit of units) {
    assert.equal(
      content.slice(unit.charStartInMessage, unit.charEndInMessage),
      unit.text,
    );
  }
});

test("Case F: text === content.slice(start, end)", () => {
  const content = "一文目です。二文目です。三文目も残します。";
  const units = splitMessageIntoEvidenceUnits(content);
  assert.ok(units.length >= 1);
  for (const unit of units) {
    assert.equal(
      content.slice(unit.charStartInMessage, unit.charEndInMessage),
      unit.text,
    );
  }
});

test("toEvidenceRole は Message.role から決定論的に決める", () => {
  assert.equal(toEvidenceRole("user"), "user");
  assert.equal(toEvidenceRole("assistant"), "assistant");
  assert.equal(toEvidenceRole("unknown"), "unknown");
  assert.equal(toEvidenceRole("system"), "unknown");
});

test("EvidenceRef は S01:M003:E02 へ拡張できる", () => {
  assert.equal(
    toEvidenceRef({ messageIndex: 2, unitIndex: 1 }),
    "M003:E02",
  );
  assert.equal(
    toEvidenceRef({ sessionIndex: 0, messageIndex: 2, unitIndex: 1 }),
    "S01:M003:E02",
  );
  assert.deepEqual(parseEvidenceRef("S01:M003:E02"), {
    sessionIndex: 0,
    messageIndex: 2,
    unitIndex: 1,
  });
  assert.deepEqual(parseEvidenceRef("M003:E02"), {
    sessionIndex: null,
    messageIndex: 2,
    unitIndex: 1,
  });
});
