import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyEvidenceFailure,
  computeEvidenceStats,
  isUnsupportedClaim,
  quoteExistsInContent,
  validateEvidence,
} from "./evidence";
import { parseStoredAnalysisPayload } from "./schemas";

test("v1 形式の payload も読める", () => {
  const parsed = parseStoredAnalysisPayload(
    JSON.stringify({
      summary: "旧分析",
      items: [
        {
          kind: "fact",
          text: "事実",
          evidence: [
            {
              messageRef: "M001",
              quote: "原文",
              validated: true,
              messageId: "msg-1",
            },
          ],
        },
      ],
      settings: {
        provider: "openai",
        store: false,
        maxInputChars: 40000,
      },
    }),
  );
  assert.ok(parsed);
  assert.equal(parsed?.items[0]?.evidence[0]?.validated, true);
  assert.equal(parsed?.metrics, undefined);
});

test("v3 形式の payload も subject / semanticValid なしで読める", () => {
  const parsed = parseStoredAnalysisPayload(
    JSON.stringify({
      summary: "v3分析",
      items: [
        {
          kind: "decision",
          text: "この設計を支持した",
          evidence: [
            {
              messageRef: "M001:E01",
              quote: "この設計を支持します",
              validated: true,
              messageId: "msg-1",
            },
          ],
          unsupportedClaim: false,
        },
      ],
      settings: {
        provider: "openai",
        store: false,
        maxInputChars: 40000,
      },
      metrics: {
        evidenceCount: 1,
        validatedCount: 1,
        validationRate: 1,
      },
    }),
  );
  assert.ok(parsed);
  assert.equal(parsed?.items[0]?.subject, undefined);
  assert.equal(parsed?.items[0]?.semanticValid, undefined);
});


const messageId = "msg-user-1";
const content = "来週から週3回歩くことにします。";

const refToMessageId = new Map([["M001", messageId]]);
const contentByMessageId = new Map([[messageId, content]]);

test("Case A: 原文から完全コピーした quote は validated = true", () => {
  const result = validateEvidence(
    { messageRef: "M001", quote: "週3回歩くことにします。" },
    refToMessageId,
    contentByMessageId,
  );
  assert.equal(result.validated, true);
  assert.equal(result.reason, null);
  assert.equal(result.messageId, messageId);
});

test("Case B: 意味は同じでも言い換えた quote は validated = false", () => {
  const paraphrased = "来週から週3回歩く方針にします。";
  const result = validateEvidence(
    { messageRef: "M001", quote: paraphrased },
    refToMessageId,
    contentByMessageId,
  );
  assert.equal(result.validated, false);
  assert.equal(result.reason, "quote_not_found");
  assert.equal(result.quote, paraphrased);
  assert.equal(quoteExistsInContent(content, paraphrased), false);
});

test("Case C: 句読点を変更した quote は validated = false", () => {
  const punctuated = "来週から週3回、歩くことにします。";
  const result = validateEvidence(
    { messageRef: "M001", quote: punctuated },
    refToMessageId,
    contentByMessageId,
  );
  assert.equal(result.validated, false);
  assert.equal(result.reason, "quote_not_found");
  assert.equal(quoteExistsInContent(content, punctuated), false);
});

test("Case D: 存在しない messageRef は validated = false", () => {
  const result = validateEvidence(
    { messageRef: "M999", quote: "週3回歩く" },
    refToMessageId,
    contentByMessageId,
  );
  assert.equal(result.validated, false);
  assert.equal(result.reason, "invalid_message_ref");
  assert.equal(result.messageId, null);
});

test("empty_quote を分類できる", () => {
  assert.equal(
    classifyEvidenceFailure(
      { messageRef: "M001", quote: "  " },
      refToMessageId,
      contentByMessageId,
    ),
    "empty_quote",
  );
});

test("CRLF / NFC の技術的差だけなら一致する", () => {
  const windowsContent = "この方向で進めます。\r\n次に試します。";
  assert.equal(
    quoteExistsInContent(windowsContent, "この方向で進めます。\n次に試します。"),
    true,
  );
});

test("Markdown を削除した quote は一致させない", () => {
  const markdown = "これは **重要** です。";
  assert.equal(quoteExistsInContent(markdown, "これは 重要 です。"), false);
});

test("Fact/Decision/Action は検証済み Evidence が無ければ unsupported_claim", () => {
  assert.equal(isUnsupportedClaim("decision", [{ validated: false }]), true);
  assert.equal(isUnsupportedClaim("action", []), true);
  assert.equal(isUnsupportedClaim("fact", [{ validated: true }]), false);
  assert.equal(isUnsupportedClaim("insight", []), false);
});

test("Evidence validation rate を計算できる", () => {
  const stats = computeEvidenceStats([
    { evidence: [{ validated: true }, { validated: false }] },
    { evidence: [{ validated: true }] },
  ]);
  assert.equal(stats.evidenceCount, 3);
  assert.equal(stats.validatedCount, 2);
  assert.equal(stats.validationRate, 2 / 3);
});
