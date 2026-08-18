import assert from "node:assert/strict";
import test from "node:test";
import type { StoredReviewItem, StoredReviewShiftItem } from "@/lib/ai/review-schemas";
import type { HomeObservation } from "./display";
import {
  HOME_DATA_ACTIONS,
  HOME_OBSERVATION_LIMIT,
  buildObservatoryHomeModel,
} from "./home";
import { REVIEW_OBSERVATION_VERSION } from "./types";

const now = new Date("2026-08-18T00:00:00.000Z");
const emptyExtras = {
  sessionsById: new Map<string, { id: string; title: string; occurredAt: string }>(),
  reviewTitleById: new Map<string, string>(),
  now,
};

const shiftPayload: StoredReviewShiftItem = {
  text: "変化",
  before: "以前",
  after: "現在",
  interpretation: "変化",
  beforeEvidence: [],
  afterEvidence: [],
  evidence: [],
  semanticValid: true,
  supportType: "direct",
};

const connectionPayload: StoredReviewItem = {
  text: "接続",
  evidence: [],
  semanticValid: true,
  relationType: "complement",
};

const tensionPayload: StoredReviewItem = {
  text: "緊張",
  evidence: [],
  semanticValid: true,
  relationType: "contrast",
  sideA: { text: "A", evidence: [] },
  sideB: { text: "B", evidence: [] },
};

function obs(
  kind: HomeObservation["kind"],
  id: string,
  overrides: Partial<HomeObservation> = {},
): HomeObservation {
  const payload =
    kind === "shift"
      ? shiftPayload
      : kind === "connection"
        ? connectionPayload
        : tensionPayload;
  return {
    id,
    kind,
    payload,
    projectionVersion: REVIEW_OBSERVATION_VERSION,
    sourceReviewId: "review-1",
    sourceRef: `R:${kind.toUpperCase()}:01`,
    title: kind,
    body: kind,
    firstSeenAt: "2026-08-01",
    lastSeenAt: "2026-08-10",
    detectedAt: "2026-08-18T06:00:00.000Z",
    sessionIds: ["s1", "s2"],
    distinctSessionCount: 2,
    ...overrides,
  } as HomeObservation;
}

test("Observation 0件なら Spotlight も各リストも空", () => {
  const model = buildObservatoryHomeModel([], emptyExtras);
  assert.equal(model.totalCount, 0);
  assert.equal(model.spotlight, null);
  assert.deepEqual(model.shifts, []);
  assert.deepEqual(model.connections, []);
  assert.deepEqual(model.tensions, []);
});

test("Shift 0件でも connection / tension は表示できる", () => {
  const model = buildObservatoryHomeModel(
    [
      obs("connection", "c1"),
      obs("tension", "t1", { lastSeenAt: "2026-08-09" }),
    ],
    emptyExtras,
  );
  assert.equal(model.shifts.length, 0);
  assert.equal(model.connections.length, 1);
  assert.equal(model.tensions.length, 1);
  assert.ok(model.spotlight);
});

test("connection のみ", () => {
  const model = buildObservatoryHomeModel([obs("connection", "c1")], emptyExtras);
  assert.equal(model.spotlight?.kind, "connection");
  assert.equal(model.connections.length, 1);
  assert.equal(model.shifts.length, 0);
  assert.equal(model.tensions.length, 0);
});

test("tension のみ", () => {
  const model = buildObservatoryHomeModel([obs("tension", "t1")], emptyExtras);
  assert.equal(model.spotlight?.kind, "tension");
  assert.equal(model.tensions[0]?.tension?.sideA, "A");
  assert.equal(model.tensions[0]?.tension?.sideB, "B");
});

test("lastSeenAt が null なら firstSeenAt が thoughtDate", () => {
  const model = buildObservatoryHomeModel(
    [obs("connection", "c1", { lastSeenAt: null, firstSeenAt: "2026-07-18" })],
    emptyExtras,
  );
  assert.equal(model.connections[0]?.thoughtDate, "2026-07-18");
  assert.equal(model.spotlight?.thoughtDate, "2026-07-18");
});

test("thoughtDate が無くても Home は壊れない", () => {
  const model = buildObservatoryHomeModel(
    [
      obs("connection", "c1", {
        lastSeenAt: null,
        firstSeenAt: null,
        detectedAt: "2026-08-18T06:00:00.000Z",
      }),
    ],
    emptyExtras,
  );
  assert.equal(model.connections[0]?.thoughtDate, null);
  assert.equal(model.spotlight?.kind, "connection");
});

test("既存の取り込み・レビュー導線は残る", () => {
  assert.deepEqual(
    HOME_DATA_ACTIONS.map((item) => item.href),
    ["/sessions/new", "/imports/chatgpt", "/reviews/new?preset=this-week"],
  );
  assert.equal(
    HOME_DATA_ACTIONS.some((item) => item.title === "手動で貼り付ける"),
    true,
  );
});

test("リストは最大 HOME_OBSERVATION_LIMIT 件", () => {
  const many = Array.from({ length: 7 }, (_, index) =>
    obs("connection", `c${index}`, {
      lastSeenAt: `2026-08-${String(10 + index).padStart(2, "0")}`,
    }),
  );
  const model = buildObservatoryHomeModel(many, emptyExtras);
  assert.equal(model.connections.length, HOME_OBSERVATION_LIMIT);
});
