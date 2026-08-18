import assert from "node:assert/strict";
import test from "node:test";
import { isGenericDeniedConcept } from "./deny-list";
import {
  isCompoundRelationLabel,
  validateConceptCandidate,
} from "./candidate";

test("generic deny-list は完全一致の会話語だけ拒否する", () => {
  for (const term of ["今日", "質問", "相談", "重要", "方法"]) {
    assert.equal(isGenericDeniedConcept(term), true);
    assert.equal(validateConceptCandidate(term).ok, false);
    if (!validateConceptCandidate(term).ok) {
      assert.equal(validateConceptCandidate(term).reason, "generic_term");
    }
  }
});

test("製品名は hard deny しない", () => {
  assert.equal(isGenericDeniedConcept("ChatGPT"), false);
  assert.equal(isGenericDeniedConcept("Claude"), false);
  assert.equal(validateConceptCandidate("ChatGPT").ok, true);
  assert.equal(validateConceptCandidate("Claude").ok, true);
});

test("方法論など deny 語を含む複合は除外しない", () => {
  assert.equal(isGenericDeniedConcept("方法論"), false);
  assert.equal(validateConceptCandidate("方法論").ok, true);
});

test("A × B / A ↔ B / A vs B は結合ラベルとして拒否する", () => {
  assert.equal(isCompoundRelationLabel("自動化 × 人間判断"), true);
  assert.equal(isCompoundRelationLabel("距離感 ↔ 執着"), true);
  assert.equal(isCompoundRelationLabel("AI vs 人間"), true);
  assert.equal(validateConceptCandidate("自動化 × 人間判断").ok, false);
  assert.equal(validateConceptCandidate("距離感 ↔ 執着").ok, false);
  assert.equal(validateConceptCandidate("AI vs 人間").ok, false);
});

test("漢字複合の AとB は拒否し、普通の名詞句は残す", () => {
  assert.equal(validateConceptCandidate("自動化と人間判断").ok, false);
  assert.equal(validateConceptCandidate("距離感").ok, true);
  assert.equal(validateConceptCandidate("思考整理").ok, true);
  assert.equal(validateConceptCandidate("AI性能").ok, true);
  assert.equal(validateConceptCandidate("ほっとする").ok, true);
});

test("空ラベルは拒否する", () => {
  const result = validateConceptCandidate("   ");
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "empty");
  }
});
