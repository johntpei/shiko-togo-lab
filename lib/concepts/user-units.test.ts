import assert from "node:assert/strict";
import test from "node:test";
import { toEvidenceRole } from "@/lib/ai/evidence-units";
import {
  prepareUserEvidenceUnits,
  type ConceptExtractSession,
} from "./user-units";

const LONG_USER =
  "高性能AIについて詳しく話したいと思っています。距離感の話も続けます。";
const LONG_ASSISTANT =
  "了解しました。高性能AIと距離感の両方について整理して返しますね。";

function session(
  messages: ConceptExtractSession["messages"],
): ConceptExtractSession {
  return {
    sessionId: "session-user-units",
    occurredAt: "2026-08-02",
    messages,
  };
}

test("USER Message だけを Evidence Unit 化する", () => {
  const units = prepareUserEvidenceUnits(
    session([
      {
        id: "msg-user-1",
        role: "user",
        content: LONG_USER,
        sourceCreatedAt: "2026-08-02T12:00:00.000Z",
      },
      {
        id: "msg-user-2",
        role: "USER",
        content: "自動化について同じセッションで触れていますよ今。",
      },
    ]),
  );

  assert.ok(units.length >= 2);
  assert.equal(
    units.every((unit) => unit.sessionId === "session-user-units"),
    true,
  );
  assert.equal(
    units.some((unit) => unit.messageId === "msg-user-1"),
    true,
  );
  assert.equal(
    units.some((unit) => unit.messageId === "msg-user-2"),
    true,
  );
  assert.equal(units[0]?.evidenceRef, "M001:E01");
  assert.equal(units[0]?.sourceCreatedAt, "2026-08-02T12:00:00.000Z");
  assert.equal(units[0]?.sessionOccurredAt, "2026-08-02");
  assert.ok(units[0]?.text.includes("高性能AI"));
  assert.equal(
    units.find((unit) => unit.messageId === "msg-user-2")?.sourceCreatedAt,
    null,
  );
});

test("Assistant Message は Unit 化しない", () => {
  const units = prepareUserEvidenceUnits(
    session([
      { id: "msg-assistant", role: "assistant", content: LONG_ASSISTANT },
      { id: "msg-user", role: "user", content: LONG_USER },
      { id: "msg-unknown", role: "system", content: LONG_ASSISTANT },
    ]),
  );

  assert.equal(
    units.every((unit) => unit.messageId === "msg-user"),
    true,
  );
  assert.equal(units[0]?.evidenceRef, "M001:E01");
  assert.equal(toEvidenceRole("assistant"), "assistant");
  assert.equal(
    units.some((unit) => unit.text.includes("了解しました")),
    false,
  );
});
