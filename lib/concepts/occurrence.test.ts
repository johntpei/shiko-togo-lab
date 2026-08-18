import assert from "node:assert/strict";
import test from "node:test";
import { conceptThoughtOccurredAt } from "./occurred-at";
import {
  conceptOccurrenceIdentity,
  validateConceptOccurrence,
} from "./occurrence";
import { CONCEPT_EXTRACTION_VERSION } from "./types";

function occurrence(
  overrides: Partial<Parameters<typeof validateConceptOccurrence>[0]> = {},
) {
  return {
    conceptId: "concept-1",
    sessionId: "session-1",
    messageId: "message-1",
    evidenceRef: "M001:E01",
    occurredAt: "2026-08-02T12:00:00.000Z",
    sourceRole: "user",
    sourceType: "evidence_unit",
    extractionVersion: CONCEPT_EXTRACTION_VERSION,
    ...overrides,
  };
}

test("USER Evidence Unit なら Occurrence として妥当", () => {
  const result = validateConceptOccurrence(occurrence());
  assert.equal(result.ok, true);
});

test("assistant / unknown は USER provenance を満たさない", () => {
  assert.equal(
    validateConceptOccurrence(occurrence({ sourceRole: "assistant" })).ok,
    false,
  );
  assert.equal(
    validateConceptOccurrence(occurrence({ sourceRole: "unknown" })).ok,
    false,
  );
});

test("evidence_unit 以外の sourceType は拒否する", () => {
  const result = validateConceptOccurrence(
    occurrence({ sourceType: "observation_endpoint" }),
  );
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "unsupported_source_type");
  }
});

test("messageId と正しい evidenceRef が必須", () => {
  assert.equal(
    validateConceptOccurrence(occurrence({ messageId: "" })).ok,
    false,
  );
  assert.equal(
    validateConceptOccurrence(occurrence({ evidenceRef: "not-a-ref" })).ok,
    false,
  );
  assert.equal(
    validateConceptOccurrence(occurrence({ evidenceRef: "S01:M003:E02" })).ok,
    true,
  );
});

test("Occurrence identity は version / type / message / ref / concept で決まる", () => {
  const identity = conceptOccurrenceIdentity(occurrence());
  assert.deepEqual(identity, {
    extractionVersion: CONCEPT_EXTRACTION_VERSION,
    sourceType: "evidence_unit",
    messageId: "message-1",
    evidenceRef: "M001:E01",
    conceptId: "concept-1",
  });
});

test("occurredAt は sourceCreatedAt を優先し、無ければ Session.occurredAt", () => {
  assert.equal(
    conceptThoughtOccurredAt({
      sourceCreatedAt: "2026-08-02T03:04:05.000Z",
      sessionOccurredAt: "2026-08-02",
    }),
    "2026-08-02T03:04:05.000Z",
  );
  assert.equal(
    conceptThoughtOccurredAt({
      sourceCreatedAt: null,
      sessionOccurredAt: "2026-08-02",
    }),
    "2026-08-02",
  );
  assert.equal(
    conceptThoughtOccurredAt({
      sourceCreatedAt: "  ",
      sessionOccurredAt: "2026-08-02",
    }),
    "2026-08-02",
  );
});
