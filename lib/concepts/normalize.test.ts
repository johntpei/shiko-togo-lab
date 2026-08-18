import assert from "node:assert/strict";
import test from "node:test";
import { normalizeConceptKey, normalizeConceptLabel } from "./normalize";

test("normalize は同じ入力なら同じキーになる", () => {
  assert.equal(normalizeConceptKey("AI性能"), normalizeConceptKey("AI性能"));
});

test("NFKC・空白・Latin case だけを正規化する", () => {
  assert.equal(normalizeConceptKey("ＡＩ　性能"), "ai性能");
  assert.equal(normalizeConceptKey("  AI  性能  "), "ai性能");
  assert.equal(normalizeConceptKey("ChatGPT"), "chatgpt");
  assert.equal(normalizeConceptLabel("  ＡＩ 性能  "), "AI 性能");
});

test("高性能AI と AI性能 は同一化しない", () => {
  assert.notEqual(normalizeConceptKey("高性能AI"), normalizeConceptKey("AI性能"));
});

test("AI と AI性能 は同一化しない", () => {
  assert.notEqual(normalizeConceptKey("AI"), normalizeConceptKey("AI性能"));
});
