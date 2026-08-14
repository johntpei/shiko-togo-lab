import assert from "node:assert/strict";
import test from "node:test";
import { resolveEvidenceRef, isV3UnsupportedClaim } from "./evidence-refs";
import { splitMessageIntoEvidenceUnits, toEvidenceRef } from "./evidence-units";
import type { EvidenceUnit } from "./evidence-units";

function unitFor(
  messageId: string,
  role: string,
  content: string,
  messageIndex: number,
): { unitsByRef: Map<string, EvidenceUnit>; contentByMessageId: Map<string, string> } {
  const slices = splitMessageIntoEvidenceUnits(content);
  const unitsByRef = new Map<string, EvidenceUnit>();
  const contentByMessageId = new Map<string, string>([[messageId, content]]);
  slices.forEach((slice, unitIndex) => {
    const ref = toEvidenceRef({ messageIndex, unitIndex });
    unitsByRef.set(ref, {
      ...slice,
      ref,
      messageRef: `M${String(messageIndex + 1).padStart(3, "0")}`,
      messageId,
      role,
    });
  });
  return { unitsByRef, contentByMessageId };
}

test("Case G: 有効な ref は validated = true で原文を quote にする", () => {
  const content = "この設計を支持します。次の話に進みます。";
  const { unitsByRef, contentByMessageId } = unitFor("msg-1", "user", content, 0);
  const result = resolveEvidenceRef("M001:E01", unitsByRef, contentByMessageId);
  assert.equal(result.validated, true);
  assert.equal(result.messageId, "msg-1");
  assert.ok(content.includes(result.quote));
  assert.equal(
    content.slice(
      unitsByRef.get("M001:E01")!.charStartInMessage,
      unitsByRef.get("M001:E01")!.charEndInMessage,
    ),
    result.quote,
  );
});

test("Case H: 存在しない ref は validated = false", () => {
  const { unitsByRef, contentByMessageId } = unitFor(
    "msg-1",
    "user",
    "この設計を支持します。",
    0,
  );
  const result = resolveEvidenceRef("M001:E99", unitsByRef, contentByMessageId);
  assert.equal(result.validated, false);
  assert.equal(result.reason, "invalid_evidence_ref");
  assert.equal(result.messageId, null);
});

test("Case I: 別 Message を指す不正 ref は validated = false", () => {
  const { unitsByRef, contentByMessageId } = unitFor(
    "msg-1",
    "user",
    "この設計を支持します。",
    0,
  );
  const result = resolveEvidenceRef("M002:E01", unitsByRef, contentByMessageId);
  assert.equal(result.validated, false);
  assert.equal(result.reason, "invalid_evidence_ref");
});

test("Decision は User Evidence が無ければ unsupported", () => {
  const { unitsByRef, contentByMessageId } = unitFor(
    "msg-a",
    "assistant",
    "次に実装しましょう。",
    1,
  );
  const evidence = [
    resolveEvidenceRef("M002:E01", unitsByRef, contentByMessageId),
  ];
  assert.equal(evidence[0]?.validated, true);
  assert.equal(isV3UnsupportedClaim("decision", evidence, unitsByRef), true);
  assert.equal(isV3UnsupportedClaim("action", evidence, unitsByRef), true);
});

test("User の支持は Decision の根拠になる", () => {
  const { unitsByRef, contentByMessageId } = unitFor(
    "msg-u",
    "user",
    "この設計を支持します。",
    0,
  );
  const evidence = [
    resolveEvidenceRef("M001:E01", unitsByRef, contentByMessageId),
  ];
  assert.equal(isV3UnsupportedClaim("decision", evidence, unitsByRef), false);
});
