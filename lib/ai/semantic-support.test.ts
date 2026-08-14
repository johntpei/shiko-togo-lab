import assert from "node:assert/strict";
import test from "node:test";
import { resolveEvidenceRefs } from "./evidence-refs";
import { validateSemanticSupport } from "./semantic-support";
import {
  buildEvidenceAnalyzeInput,
  type AnalyzeMessage,
} from "./session-input";
import type { AnalysisKind, AnalysisSubject } from "./schemas";

function message(
  id: string,
  role: string,
  content: string,
): AnalyzeMessage {
  return { id, role, content, attachmentsJson: null };
}

function check(input: {
  messages: AnalyzeMessage[];
  kind: AnalysisKind;
  subject: AnalysisSubject;
  text?: string;
  evidenceRefs: string[];
}) {
  const built = buildEvidenceAnalyzeInput(input.messages);
  const evidence = resolveEvidenceRefs(
    input.evidenceRefs,
    built.unitsByRef,
    built.contentByMessageId,
  );
  const semantic = validateSemanticSupport(
    {
      kind: input.kind,
      subject: input.subject,
      evidenceRefs: input.evidenceRefs,
    },
    built.unitsByRef,
    evidence,
  );
  return { evidence, semantic, built };
}

test("Case A: USER Evidence の Decision は semantic valid", () => {
  const result = check({
    messages: [message("u1", "user", "この設計を支持します。この方針で進めます。")],
    kind: "decision",
    subject: "user",
    evidenceRefs: ["M001:E01"],
  });
  assert.equal(result.evidence[0]?.validated, true);
  assert.equal(result.evidence[0]?.role, "user");
  assert.equal(result.semantic.valid, true);
  assert.equal(result.semantic.reason, null);
});

test("Case B: ASSISTANT のみの Decision は semantic invalid", () => {
  const result = check({
    messages: [
      message("a1", "assistant", "この設計がおすすめです。この方針で進めるとよいです。"),
    ],
    kind: "decision",
    subject: "user",
    evidenceRefs: ["M001:E01"],
  });
  assert.equal(result.evidence[0]?.validated, true);
  assert.equal(result.evidence[0]?.role, "assistant");
  assert.equal(result.semantic.valid, false);
  assert.equal(result.semantic.reason, "evidence_role_mismatch");
});

test("Case C: USER Evidence の Action は semantic valid", () => {
  const result = check({
    messages: [message("u1", "user", "STEP 5へ進みたいです。実装に取りかかります。")],
    kind: "action",
    subject: "user",
    evidenceRefs: ["M001:E01"],
  });
  assert.equal(result.evidence[0]?.validated, true);
  assert.equal(result.semantic.valid, true);
});

test("Case D: ASSISTANT のみの Action は semantic invalid", () => {
  const result = check({
    messages: [
      message("a1", "assistant", "次はSTEP 5へ進みましょう。実装を始めるのがよいです。"),
    ],
    kind: "action",
    subject: "user",
    evidenceRefs: ["M001:E01"],
  });
  assert.equal(result.evidence[0]?.validated, true);
  assert.equal(result.semantic.valid, false);
  assert.equal(result.semantic.reason, "evidence_role_mismatch");
});

test("Case E: 質問への回答を User Fact にすると invalid", () => {
  const result = check({
    messages: [
      message("u1", "user", "Claude Codeだけで代替できますか？方針を確認したいです。"),
      message("a1", "assistant", "かなり代替できます。相当な部分をカバーできます。"),
    ],
    kind: "fact",
    subject: "user",
    text: "ユーザーは代替可能だと認識している",
    evidenceRefs: ["M002:E01"],
  });
  assert.equal(result.evidence[0]?.validated, true);
  assert.equal(result.evidence[0]?.role, "assistant");
  assert.equal(result.semantic.valid, false);
  assert.equal(result.semantic.reason, "evidence_role_mismatch");
});

test("Case F: USER が述べた本人 Fact は valid", () => {
  const result = check({
    messages: [
      message(
        "u1",
        "user",
        "Claude Codeでかなり代替できると思います。自分ではそう考えています。",
      ),
    ],
    kind: "fact",
    subject: "user",
    evidenceRefs: ["M001:E01"],
  });
  assert.equal(result.evidence[0]?.validated, true);
  assert.equal(result.semantic.valid, true);
});

test("Case G: interpretation Insight は USER / ASSISTANT Evidence で valid", () => {
  const result = check({
    messages: [
      message(
        "u1",
        "user",
        "運用作業を毎回手でやると漏れが出ます。自動化したいです。",
      ),
      message(
        "a1",
        "assistant",
        "このツールの価値はAIそのものより、運用作業の自動化にあります。",
      ),
    ],
    kind: "insight",
    subject: "interpretation",
    text: "このツールの価値はAIそのものより、運用作業の自動化にあると考えられる",
    evidenceRefs: ["M001:E01", "M002:E01"],
  });
  assert.equal(result.evidence.every((item) => item.validated), true);
  assert.equal(result.semantic.valid, true);
});

test("Case H: Assistant だけから本人 Insight は invalid", () => {
  const result = check({
    messages: [
      message(
        "a1",
        "assistant",
        "ユーザーは運用自動化の価値に気づいたはずです。そこが本丸です。",
      ),
    ],
    kind: "insight",
    subject: "user",
    text: "ユーザーは運用自動化の価値に気づいた",
    evidenceRefs: ["M001:E01"],
  });
  assert.equal(result.evidence[0]?.validated, true);
  assert.equal(result.semantic.valid, false);
  assert.equal(result.semantic.reason, "evidence_role_mismatch");
});

test("Case I: Hypothesis は interpretation で USER + ASSISTANT Evidence を許可", () => {
  const result = check({
    messages: [
      message("u1", "user", "毎回同じ確認作業を繰り返しています。時間がかかります。"),
      message("a1", "assistant", "確認作業の負荷が意思決定を遅らせている可能性があります。"),
    ],
    kind: "hypothesis",
    subject: "interpretation",
    evidenceRefs: ["M001:E01", "M002:E01"],
  });
  assert.equal(result.evidence.every((item) => item.validated), true);
  assert.equal(result.semantic.valid, true);
});

test("Case J: 存在しない EvidenceRef は Evidence も Semantic も成立しない", () => {
  const result = check({
    messages: [message("u1", "user", "この設計を支持します。この方針で進めます。")],
    kind: "decision",
    subject: "user",
    evidenceRefs: ["M999:E01"],
  });
  assert.equal(result.evidence[0]?.validated, false);
  assert.equal(result.evidence[0]?.reason, "invalid_evidence_ref");
  assert.equal(result.semantic.valid, false);
  assert.equal(result.semantic.reason, "invalid_evidence_ref");
});

test("Decision を Insight へ書き換えない（kind はそのまま invalid）", () => {
  const result = check({
    messages: [
      message("a1", "assistant", "この設計がおすすめです。この方針で進めるとよいです。"),
    ],
    kind: "decision",
    subject: "user",
    evidenceRefs: ["M001:E01"],
  });
  assert.equal(result.semantic.valid, false);
  assert.equal(result.semantic.reason, "evidence_role_mismatch");
});

test("Decision の subject が user 以外なら unsupported_subject_kind", () => {
  const result = check({
    messages: [message("u1", "user", "この設計を支持します。この方針で進めます。")],
    kind: "decision",
    subject: "interpretation",
    evidenceRefs: ["M001:E01"],
  });
  assert.equal(result.semantic.valid, false);
  assert.equal(result.semantic.reason, "unsupported_subject_kind");
});

test("USER Evidence が空の Decision は missing_user_evidence", () => {
  const result = check({
    messages: [message("u1", "user", "この設計を支持します。この方針で進めます。")],
    kind: "decision",
    subject: "user",
    evidenceRefs: [],
  });
  assert.equal(result.semantic.valid, false);
  assert.equal(result.semantic.reason, "missing_user_evidence");
});
