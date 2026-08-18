import assert from "node:assert/strict";
import test from "node:test";
import type { ObservationRecord } from "@/lib/db/schema";
import { observationFromRecord } from "./from-record";
import { REVIEW_OBSERVATION_VERSION } from "./types";

function record(
  overrides: Partial<ObservationRecord> & Pick<ObservationRecord, "kind" | "payload">,
): ObservationRecord {
  return {
    id: "obs-1",
    projectionVersion: REVIEW_OBSERVATION_VERSION,
    sourceReviewId: "review-1",
    sourceRef: "R:INSIGHT:01",
    title: "title",
    body: "body",
    supportType: "cross_session_interpretation",
    firstSeenAt: "2026-07-18",
    lastSeenAt: "2026-08-02",
    detectedAt: "2026-08-18T06:00:00.000Z",
    distinctSessionCount: 2,
    createdAt: "2026-08-18T06:00:00.000Z",
    ...overrides,
  };
}

test("Guard 除外 item は Home に載せない", () => {
  const parsed = observationFromRecord(
    record({
      kind: "connection",
      payload: JSON.stringify({
        text: "除外",
        evidence: [],
        semanticValid: false,
      }),
    }),
    ["s1", "s2"],
  );
  assert.equal(parsed, null);
});

test("未知の kind は Home に載せない", () => {
  const parsed = observationFromRecord(
    record({
      kind: "hypothesis",
      payload: JSON.stringify({ text: "x", evidence: [], semanticValid: true }),
    }),
    ["s1"],
  );
  assert.equal(parsed, null);
});

test("壊れた payload は落とす", () => {
  assert.equal(
    observationFromRecord(record({ kind: "connection", payload: "{not-json" }), []),
    null,
  );
});

test("connection payload をそのまま読む", () => {
  const parsed = observationFromRecord(
    record({
      kind: "connection",
      lastSeenAt: null,
      payload: JSON.stringify({
        text: "つながっている",
        evidence: [],
        semanticValid: true,
        relationType: "complement",
        supportType: "direct",
      }),
    }),
    ["s1", "s2"],
  );
  assert.equal(parsed?.kind, "connection");
  assert.equal(parsed?.supportType, "direct");
  assert.equal(parsed?.lastSeenAt, null);
  if (parsed?.kind === "connection") {
    assert.equal(parsed.payload.text, "つながっている");
    assert.equal(parsed.payload.relationType, "complement");
  }
});

test("tension の sideA / sideB を payload から復元する", () => {
  const parsed = observationFromRecord(
    record({
      kind: "tension",
      sourceRef: "R:TENSION:01",
      payload: JSON.stringify({
        text: "揺れている",
        evidence: [],
        semanticValid: true,
        sideA: { text: "A", evidence: [] },
        sideB: { text: "B", evidence: [] },
      }),
    }),
    ["s1", "s2"],
  );
  assert.equal(parsed?.kind, "tension");
  if (parsed?.kind === "tension") {
    assert.equal(parsed.payload.sideA?.text, "A");
    assert.equal(parsed.payload.sideB?.text, "B");
  }
});
