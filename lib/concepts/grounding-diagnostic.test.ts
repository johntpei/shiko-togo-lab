import assert from "node:assert/strict";
import test from "node:test";
import { hashArtifactText } from "@/lib/concepts/admission/canonical-json";
import { groundSurfaceForm } from "./grounding";
import {
  diagnoseSurfaceNotInUnit,
  type SurfaceNotInUnitDiagnostic,
} from "./grounding-diagnostic";
import type { ConceptExtractUnit } from "./user-units";

const UNIT_TEXT = "高性能AIについて詳しく話したいと思っています";
const SURFACE = "高性能AI";

function unit(
  overrides: Partial<ConceptExtractUnit> = {},
): ConceptExtractUnit {
  return {
    evidenceRef: "M001:E01",
    messageId: "msg-1",
    sessionId: "session-1",
    text: UNIT_TEXT,
    sourceCreatedAt: "2026-08-02T12:00:00.000Z",
    sessionOccurredAt: "2026-08-02",
    ...overrides,
  };
}

function diagnose(
  surfaceForm: string,
  unitText = UNIT_TEXT,
  evidenceRef = "M001:E01",
) {
  return diagnoseSurfaceNotInUnit({
    actionIndex: 0,
    evidenceRef,
    surfaceForm,
    unitText,
  });
}

function serialized(diagnostic: SurfaceNotInUnitDiagnostic) {
  return JSON.stringify(diagnostic);
}

test("A. exact valid surface → grounding success, diagnostic not required", () => {
  const unitsByRef = new Map([["M001:E01", unit()]]);
  const result = groundSurfaceForm({
    evidenceRef: "M001:E01",
    surfaceForm: SURFACE,
    unitsByRef,
  });
  assert.equal(result.ok, true);
  const helper = diagnose(SURFACE);
  assert.equal(helper.exactMatch, true);
  assert.equal(helper.diagnosticMatches.trimmed, false);
  assert.equal(helper.diagnosticMatches.nfkc, false);
});

test("B. exact invalid surface → surface_not_in_unit + diagnostic", () => {
  const unitsByRef = new Map([["M001:E01", unit()]]);
  const surfaceForm = "存在しない表層XYZ";
  const result = groundSurfaceForm({
    evidenceRef: "M001:E01",
    surfaceForm,
    unitsByRef,
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "surface_not_in_unit");
  }
  const diagnostic = diagnose(surfaceForm);
  assert.equal(diagnostic.code, "surface_not_in_unit");
  assert.equal(diagnostic.exactMatch, false);
  assert.equal(diagnostic.evidenceRef, "M001:E01");
  assert.equal(diagnostic.surfaceFormLength, surfaceForm.length);
  assert.equal(diagnostic.evidenceUnitLength, UNIT_TEXT.length);
});

test("C. trim-only mismatch: trimmedMatch=true; diagnostic is not accept", () => {
  const padded = `  ${SURFACE}  `;
  const diagnostic = diagnose(padded);
  assert.equal(diagnostic.exactMatch, false);
  assert.equal(diagnostic.diagnosticMatches.trimmed, true);
  const unitsByRef = new Map([["M001:E01", unit()]]);
  const grounded = groundSurfaceForm({
    evidenceRef: "M001:E01",
    surfaceForm: padded,
    unitsByRef,
  });
  assert.equal(
    grounded.ok,
    true,
    "existing quoteExistsInContent already trims; diagnostic must not change that",
  );
  assert.equal("accept" in diagnostic, false);
});

test("D. NFKC-only mismatch stays blocked; nfkcMatch=true", () => {
  const surfaceForm = "ＡＩ";
  const unitsByRef = new Map([["M001:E01", unit()]]);
  const grounded = groundSurfaceForm({
    evidenceRef: "M001:E01",
    surfaceForm,
    unitsByRef,
  });
  assert.equal(grounded.ok, false);
  if (!grounded.ok) {
    assert.equal(grounded.reason, "surface_not_in_unit");
  }
  const diagnostic = diagnose(surfaceForm);
  assert.equal(diagnostic.exactMatch, false);
  assert.equal(diagnostic.diagnosticMatches.nfkc, true);
});

test("E. whitespace-only mismatch stays blocked; whitespaceNormalized=true", () => {
  const unitText = "高性能  AIについて詳しく話したいと思っています";
  const surfaceForm = "高性能 AI";
  const unitsByRef = new Map([["M001:E01", unit({ text: unitText })]]);
  const grounded = groundSurfaceForm({
    evidenceRef: "M001:E01",
    surfaceForm,
    unitsByRef,
  });
  assert.equal(grounded.ok, false);
  if (!grounded.ok) {
    assert.equal(grounded.reason, "surface_not_in_unit");
  }
  const diagnostic = diagnose(surfaceForm, unitText);
  assert.equal(diagnostic.exactMatch, false);
  assert.equal(diagnostic.diagnosticMatches.whitespaceNormalized, true);
});

test("F. outer-quote-only mismatch stays blocked; outerQuoteStripped=true", () => {
  const surfaceForm = "「高性能AI」";
  const unitsByRef = new Map([["M001:E01", unit()]]);
  const grounded = groundSurfaceForm({
    evidenceRef: "M001:E01",
    surfaceForm,
    unitsByRef,
  });
  assert.equal(grounded.ok, false);
  if (!grounded.ok) {
    assert.equal(grounded.reason, "surface_not_in_unit");
  }
  const diagnostic = diagnose(surfaceForm);
  assert.equal(diagnostic.exactMatch, false);
  assert.equal(diagnostic.diagnosticMatches.outerQuoteStripped, true);
});

test("G. unrelated surface → all transformation flags false, blocked", () => {
  const surfaceForm = "完全に無関係な表層QQQ";
  const unitsByRef = new Map([["M001:E01", unit()]]);
  const grounded = groundSurfaceForm({
    evidenceRef: "M001:E01",
    surfaceForm,
    unitsByRef,
  });
  assert.equal(grounded.ok, false);
  const diagnostic = diagnose(surfaceForm);
  assert.equal(diagnostic.exactMatch, false);
  assert.equal(diagnostic.diagnosticMatches.trimmed, false);
  assert.equal(diagnostic.diagnosticMatches.nfkc, false);
  assert.equal(diagnostic.diagnosticMatches.whitespaceNormalized, false);
  assert.equal(diagnostic.diagnosticMatches.outerQuoteStripped, false);
});

test("H. serialized diagnostic has no surfaceForm / Evidence body", () => {
  const diagnostic = diagnose("「高性能AI」");
  const text = serialized(diagnostic);
  assert.doesNotMatch(text, /"surfaceForm"/);
  assert.doesNotMatch(text, /"unitText"/);
  assert.doesNotMatch(text, /"content"/);
  assert.equal(text.includes(UNIT_TEXT), false);
  assert.equal(text.includes("「高性能AI」"), false);
  assert.equal(text.includes("高性能AI"), false);
});

test("I. hashes are deterministic SHA-256 of the original strings", () => {
  const surfaceForm = "「高性能AI」";
  const first = diagnose(surfaceForm);
  const second = diagnose(surfaceForm);
  assert.equal(first.surfaceFormHash, second.surfaceFormHash);
  assert.equal(first.evidenceUnitHash, second.evidenceUnitHash);
  assert.equal(first.surfaceFormHash, hashArtifactText(surfaceForm));
  assert.equal(first.evidenceUnitHash, hashArtifactText(UNIT_TEXT));
});
