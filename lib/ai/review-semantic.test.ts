import assert from "node:assert/strict";
import test from "node:test";
import { resolveEvidenceRefs } from "./evidence-refs";
import {
  buildIntegratedReviewInput,
  type ReviewSessionSource,
} from "./review-input";
import {
  validateCommonThemeSupport,
  validateCrossInsightSupport,
  validateHypothesisSupport,
  validateNextQuestionSupport,
  validateOptionalEvidence,
  validateShiftSupport,
  validateTensionSupport,
} from "./review-semantic";

function message(id: string, role: string, content: string) {
  return { id, role, content, attachmentsJson: null };
}

function source(
  id: string,
  title: string,
  occurredAt: string,
  messages: ReturnType<typeof message>[],
): ReviewSessionSource {
  return {
    session: {
      id,
      title,
      occurredAt,
      source: "chatgpt",
      category: "制作",
      createdAt: `${occurredAt}T00:00:00.000Z`,
    },
    messages,
    analysis: null,
  };
}

const sessionA = source("s1", "Session A", "2026-07-18", [
  message("u1", "user", "自由に考えたいです。枠がない方が深い対話になります。"),
  message("a1", "assistant", "KnowledgeをMVPに含めるのがおすすめです。"),
]);
const sessionB = source("s2", "Session B", "2026-08-02", [
  message("u2", "user", "外部締切がある方が動きやすいです。自分で期限を置きたいです。"),
  message("a2", "assistant", "KnowledgeはVersion 2へ回すのが良いと思います。"),
]);
const sessionC = source("s3", "Session C", "2026-08-10", [
  message("u3", "user", "過去の会話を次の対話へ再利用したいです。記憶が追いつきません。"),
]);

function built() {
  return buildIntegratedReviewInput([sessionA, sessionB, sessionC]);
}

function resolve(refs: string[]) {
  const input = built();
  return {
    input,
    evidence: resolveEvidenceRefs(
      refs,
      input.unitsByRef,
      input.contentByMessageId,
    ),
  };
}

test("Case C: commonTheme は 2 Session の Evidence なら valid", () => {
  const { input, evidence } = resolve(["S01:M001:E01", "S02:M001:E01"]);
  const result = validateCommonThemeSupport(evidence, input.unitsByRef);
  assert.equal(evidence.every((item) => item.validated), true);
  assert.equal(result.valid, true);
});

test("Case D: commonTheme は 1 Session のみなら invalid", () => {
  const { input, evidence } = resolve(["S01:M001:E01", "S01:M002:E01"]);
  const result = validateCommonThemeSupport(evidence, input.unitsByRef);
  assert.equal(result.valid, false);
  assert.equal(result.reason, "insufficient_distinct_sessions");
});

test("Case E: shift は before/after の USER Evidence と時系列が正しければ valid", () => {
  const input = built();
  const before = resolveEvidenceRefs(
    ["S01:M001:E01"],
    input.unitsByRef,
    input.contentByMessageId,
  );
  const after = resolveEvidenceRefs(
    ["S02:M001:E01"],
    input.unitsByRef,
    input.contentByMessageId,
  );
  const result = validateShiftSupport(before, after, input.unitsByRef, input.sessions);
  assert.equal(before[0]?.role, "user");
  assert.equal(after[0]?.role, "user");
  assert.equal(result.valid, true);
});

test("Case F: shift が Assistant Evidence のみなら invalid", () => {
  const input = built();
  const before = resolveEvidenceRefs(
    ["S01:M002:E01"],
    input.unitsByRef,
    input.contentByMessageId,
  );
  const after = resolveEvidenceRefs(
    ["S02:M002:E01"],
    input.unitsByRef,
    input.contentByMessageId,
  );
  const result = validateShiftSupport(before, after, input.unitsByRef, input.sessions);
  assert.equal(before[0]?.role, "assistant");
  assert.equal(after[0]?.role, "assistant");
  assert.equal(result.valid, false);
  assert.equal(result.reason, "evidence_role_mismatch");
});

test("Case G: shift の時系列逆転は invalid", () => {
  const input = built();
  const before = resolveEvidenceRefs(
    ["S02:M001:E01"],
    input.unitsByRef,
    input.contentByMessageId,
  );
  const after = resolveEvidenceRefs(
    ["S01:M001:E01"],
    input.unitsByRef,
    input.contentByMessageId,
  );
  const result = validateShiftSupport(before, after, input.unitsByRef, input.sessions);
  assert.equal(result.valid, false);
  assert.equal(result.reason, "invalid_chronology");
});

test("Case H: tension は異なる 2 Session なら valid", () => {
  const { input, evidence } = resolve(["S01:M001:E01", "S02:M001:E01"]);
  const result = validateTensionSupport(evidence, input.unitsByRef);
  assert.equal(result.valid, true);
});

test("Case I: crossInsight は異なる 3 Session なら valid", () => {
  const { input, evidence } = resolve([
    "S01:M001:E01",
    "S02:M001:E01",
    "S03:M001:E01",
  ]);
  const result = validateCrossInsightSupport(evidence, input.unitsByRef);
  assert.equal(evidence.length, 3);
  assert.equal(result.valid, true);
});

test("Case H: 1 Session だけの Cross Insight は Semantic Guard で不可", () => {
  const { input, evidence } = resolve(["S03:M001:E01"]);
  const result = validateCrossInsightSupport(evidence, input.unitsByRef);
  assert.equal(result.valid, false);
  assert.equal(result.reason, "insufficient_distinct_sessions");
});

test("Case K: 存在しない EvidenceRef は invalid", () => {
  const { input, evidence } = resolve(["S09:M001:E01"]);
  assert.equal(evidence[0]?.validated, false);
  assert.equal(evidence[0]?.reason, "invalid_evidence_ref");
  const theme = validateCommonThemeSupport(evidence, input.unitsByRef);
  assert.equal(theme.valid, false);
  assert.equal(theme.reason, "invalid_evidence_ref");
  const optional = validateOptionalEvidence(evidence);
  assert.equal(optional.valid, false);
  assert.equal(optional.reason, "invalid_evidence_ref");
});

test("hypothesis も 2 Session 未満なら invalid", () => {
  const { input, evidence } = resolve(["S01:M001:E01"]);
  const result = validateHypothesisSupport(evidence, input.unitsByRef);
  assert.equal(result.valid, false);
  assert.equal(result.reason, "insufficient_distinct_sessions");
  assert.equal(result.guardType, "interpretation");
});

function insightBuilt() {
  return buildIntegratedReviewInput([
    source("t1", "Talk", "2026-07-18", [
      message(
        "tu1",
        "user",
        "AIとの対話が大量に増えて、壁打ちが速く深くなった。",
      ),
    ]),
    source("t2", "Burden", "2026-08-02", [
      message(
        "tu2",
        "user",
        "量が多くて整理が追いつかない。記憶が追いつきません。",
      ),
    ]),
    source("t3", "Reuse", "2026-08-10", [
      message(
        "tu3",
        "user",
        "可能な限り自動化したい。ただし本人が最終判断する仕組みは残したい。",
      ),
    ]),
  ]);
}

function insightResolve(refs: string[]) {
  const input = insightBuilt();
  return {
    input,
    evidence: resolveEvidenceRefs(
      refs,
      input.unitsByRef,
      input.contentByMessageId,
    ),
  };
}

test("Case A: 対話量増加と整理負担から知見管理ボトルネックは interpretation valid", () => {
  const { input, evidence } = insightResolve(["S01:M001:E01", "S02:M001:E01"]);
  const claim =
    "人間側の知見管理が新しいボトルネックになっている。";
  const result = validateCrossInsightSupport(evidence, input.unitsByRef, claim);
  assert.equal(result.valid, true);
  assert.equal(result.guardType, "interpretation");
});

test("Case B: Cross Insight が原文に同じ文章として存在しなくても invalid にしない", () => {
  const { input, evidence } = insightResolve(["S01:M001:E01", "S02:M001:E01"]);
  const claim =
    "AI性能の向上によって、ボトルネックがAI側から人間側の知見管理へ移っている。";
  assert.equal(
    evidence.some((item) => item.quote.includes(claim)),
    false,
  );
  const result = validateCrossInsightSupport(evidence, input.unitsByRef, claim);
  assert.equal(result.valid, true);
});

test("Case C: 個人のAI活用から顧客獲得へ飛躍すると invalid", () => {
  const { input, evidence } = insightResolve(["S01:M001:E01", "S02:M001:E01"]);
  const result = validateCrossInsightSupport(
    evidence,
    input.unitsByRef,
    "このサービスは顧客獲得増加につながる。",
  );
  assert.equal(result.valid, false);
  assert.equal(result.reason, "domain_leap");
  assert.equal(result.guardType, "hard");
});

test("Case D: 自動化と本人判断の Tension は valid", () => {
  const { input, evidence } = insightResolve(["S01:M001:E01", "S03:M001:E01"]);
  const result = validateTensionSupport(
    evidence,
    input.unitsByRef,
    "自動化と本人判断の境界設定が必要。",
  );
  assert.equal(result.valid, true);
  assert.equal(result.guardType, "interpretation");
});

test("Case E: 検証可能な Hypothesis は未証明でも valid", () => {
  const { input, evidence } = insightResolve(["S01:M001:E01", "S02:M001:E01"]);
  const result = validateHypothesisSupport(
    evidence,
    input.unitsByRef,
    "統合Reviewによって単体分析では見えなかったShiftを発見できる可能性がある。",
  );
  assert.equal(result.valid, true);
  assert.equal(result.guardType, "interpretation");
});

test("Case F: 『劇的に人生が改善する』Hypothesis は invalid", () => {
  const { input, evidence } = insightResolve(["S01:M001:E01", "S02:M001:E01"]);
  const result = validateHypothesisSupport(
    evidence,
    input.unitsByRef,
    "劇的に人生が改善する。",
  );
  assert.equal(result.valid, false);
  assert.equal(result.reason, "unsupported_exaggeration");
  assert.equal(result.guardType, "interpretation");
});

test("Case G: 『次のステップは何か？』は Next Question として invalid", () => {
  const result = validateNextQuestionSupport("次のステップは何か？", []);
  assert.equal(result.valid, false);
  assert.equal(result.reason, "weak_next_question");
});

test("Case H: 境界の Next Question は Evidence なしでも valid", () => {
  const result = validateNextQuestionSupport(
    "自動化と本人判断の境界をどこに置くべきか？",
    [],
  );
  assert.equal(result.valid, true);
});
