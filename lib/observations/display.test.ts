import assert from "node:assert/strict";
import test from "node:test";
import type { StoredReviewItem, StoredReviewShiftItem } from "@/lib/ai/review-schemas";
import { toObservationCardModel, type HomeObservation } from "./display";
import { REVIEW_OBSERVATION_VERSION } from "./types";

const shiftPayload: StoredReviewShiftItem = {
  text: "制約の捉え方が変化している。",
  before: "自由に考えたい",
  after: "締切があると動きやすい",
  interpretation: "制約の捉え方が変化している。",
  beforeEvidence: [],
  afterEvidence: [],
  evidence: [],
  semanticValid: true,
  supportType: "direct",
};

const connectionPayload: StoredReviewItem = {
  text: "ボトルネックが人間側の知見管理へ移っている。",
  evidence: [],
  semanticValid: true,
  relationType: "complement",
  supportType: "cross_session_interpretation",
};

const tensionPayload: StoredReviewItem = {
  text: "自由と締切は両立条件を考えるポイントになる。",
  evidence: [],
  semanticValid: true,
  relationType: "contrast",
  supportType: "cross_session_interpretation",
  sideA: { text: "自由に考えたい", evidence: [] },
  sideB: { text: "締切があると動きやすい", evidence: [] },
};

function base(overrides: Partial<HomeObservation> = {}): Omit<HomeObservation, "kind" | "payload"> {
  return {
    id: "obs-1",
    projectionVersion: REVIEW_OBSERVATION_VERSION,
    sourceReviewId: "review-1",
    sourceRef: "R:SHIFT:01",
    title: "制約の捉え方が変化している。",
    body: "制約の捉え方が変化している。",
    firstSeenAt: "2026-07-18",
    lastSeenAt: "2026-08-02",
    detectedAt: "2026-08-18T06:00:00.000Z",
    sessionIds: ["s1", "s2"],
    distinctSessionCount: 2,
    ...overrides,
  };
}

test("Shift card は before / after を payload から取る", () => {
  const model = toObservationCardModel({
    ...base(),
    kind: "shift",
    payload: shiftPayload,
  });
  assert.equal(model.shift?.before, "自由に考えたい");
  assert.equal(model.shift?.after, "締切があると動きやすい");
  assert.equal(model.shift?.interpretation, "制約の捉え方が変化している。");
  assert.equal(model.thoughtDate, "2026-08-02");
  assert.equal(JSON.stringify(model).includes("quote"), false);
});

test("Connection card は text と relationType を使う", () => {
  const model = toObservationCardModel({
    ...base({ sourceRef: "R:INSIGHT:01", title: connectionPayload.text, body: connectionPayload.text }),
    kind: "connection",
    payload: connectionPayload,
  });
  assert.equal(model.connection?.text, connectionPayload.text);
  assert.equal(model.connection?.relationLabel, "補完");
});

test("Tension card は sideA / sideB を優先する", () => {
  const model = toObservationCardModel({
    ...base({ sourceRef: "R:TENSION:01", title: tensionPayload.text, body: tensionPayload.text }),
    kind: "tension",
    payload: tensionPayload,
  });
  assert.equal(model.tension?.sideA, "自由に考えたい");
  assert.equal(model.tension?.sideB, "締切があると動きやすい");
  assert.equal(model.tension?.text, tensionPayload.text);
});
