import assert from "node:assert/strict";
import test from "node:test";
import { groundSurfaceForm } from "./grounding";
import type { ConceptExtractUnit } from "./user-units";

function unit(
  overrides: Partial<ConceptExtractUnit> = {},
): ConceptExtractUnit {
  return {
    evidenceRef: "M001:E01",
    messageId: "msg-1",
    sessionId: "session-1",
    text: "高性能AIについて詳しく話したいと思っています",
    sourceCreatedAt: "2026-08-02T12:00:00.000Z",
    sessionOccurredAt: "2026-08-02",
    ...overrides,
  };
}

test("正しい surfaceForm は Unit 内の連続文字列として accept する", () => {
  const unitsByRef = new Map([["M001:E01", unit()]]);
  const result = groundSurfaceForm({
    evidenceRef: "M001:E01",
    surfaceForm: "高性能AI",
    unitsByRef,
  });
  assert.equal(result.ok, true);
});

test("Unit に無い surfaceForm は surface_not_in_unit で拒否する", () => {
  const unitsByRef = new Map([["M001:E01", unit()]]);
  const result = groundSurfaceForm({
    evidenceRef: "M001:E01",
    surfaceForm: "AI性能",
    unitsByRef,
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "surface_not_in_unit");
  }
});

test("別 EvidenceRef の surface は使えない", () => {
  const unitsByRef = new Map([
    ["M001:E01", unit()],
    [
      "M002:E01",
      unit({
        evidenceRef: "M002:E01",
        messageId: "msg-2",
        text: "距離感について同じ文で触れていますよ今",
      }),
    ],
  ]);
  const result = groundSurfaceForm({
    evidenceRef: "M002:E01",
    surfaceForm: "高性能AI",
    unitsByRef,
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "surface_not_in_unit");
  }
});

test("grounding 失敗理由を区別する", () => {
  const unitsByRef = new Map([["M001:E01", unit()]]);
  assert.equal(
    groundSurfaceForm({
      evidenceRef: "not-a-ref",
      surfaceForm: "高性能AI",
      unitsByRef,
    }).ok === false &&
      groundSurfaceForm({
        evidenceRef: "not-a-ref",
        surfaceForm: "高性能AI",
        unitsByRef,
      }).reason,
    "invalid_evidence_ref",
  );
  assert.equal(
    groundSurfaceForm({
      evidenceRef: "M099:E01",
      surfaceForm: "高性能AI",
      unitsByRef,
    }).ok === false &&
      groundSurfaceForm({
        evidenceRef: "M099:E01",
        surfaceForm: "高性能AI",
        unitsByRef,
      }).reason,
    "ref_not_in_batch",
  );
  assert.equal(
    groundSurfaceForm({
      evidenceRef: "M001:E01",
      surfaceForm: "   ",
      unitsByRef,
    }).ok === false &&
      groundSurfaceForm({
        evidenceRef: "M001:E01",
        surfaceForm: "   ",
        unitsByRef,
      }).reason,
    "empty_surface",
  );
});
