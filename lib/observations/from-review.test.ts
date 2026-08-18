import assert from "node:assert/strict";
import test from "node:test";
import { INTEGRATED_REVIEW_MAX_INPUT_CHARS } from "@/lib/ai/limits";
import {
  INTEGRATED_REVIEW_PROMPT_V4,
  INTEGRATED_REVIEW_PROMPT_V5,
} from "@/lib/ai/prompts/integrated-review";
import type {
  StoredReviewEvidence,
  StoredReviewItem,
  StoredReviewPayload,
  StoredReviewShiftItem,
} from "@/lib/ai/review-schemas";
import { REVIEW_OBSERVATION_VERSION } from "./types";
import { fromReview } from "./from-review";

function evidence(input: {
  ref: string;
  quote: string;
  sessionId: string;
  occurredAt?: string | null;
}): StoredReviewEvidence {
  return {
    messageRef: input.ref,
    quote: input.quote,
    validated: true,
    messageId: input.ref,
    sessionId: input.sessionId,
    sessionTitle: input.sessionId,
    occurredAt: input.occurredAt ?? null,
    role: "user",
    reason: null,
  };
}

function shift(overrides: Partial<StoredReviewShiftItem> = {}): StoredReviewShiftItem {
  const beforeEvidence = [
    evidence({
      ref: "S01:M001:E01",
      quote: "自由に考えたいです。",
      sessionId: "s1",
      occurredAt: "2026-07-18",
    }),
  ];
  const afterEvidence = [
    evidence({
      ref: "S02:M001:E01",
      quote: "締切があると動きやすいです。",
      sessionId: "s2",
      occurredAt: "2026-08-02",
    }),
  ];
  return {
    text: "制約の捉え方が変化している。",
    before: "自由に考えたい",
    after: "締切があると動きやすい",
    interpretation: "制約の捉え方が変化している。",
    beforeEvidence,
    afterEvidence,
    evidence: [...beforeEvidence, ...afterEvidence],
    semanticValid: true,
    invalidReason: null,
    guardType: "hard",
    supportType: "direct",
    distinctSessionCount: 2,
    ...overrides,
  };
}

function tension(overrides: Partial<StoredReviewItem> = {}): StoredReviewItem {
  const sideAEvidence = [
    evidence({
      ref: "S01:M001:E01",
      quote: "自由に考えたいです。",
      sessionId: "s1",
      occurredAt: "2026-07-18",
    }),
  ];
  const sideBEvidence = [
    evidence({
      ref: "S02:M001:E01",
      quote: "締切があると動きやすいです。",
      sessionId: "s2",
      occurredAt: "2026-08-02",
    }),
  ];
  return {
    text: "自由と締切は両立条件を考えるポイントになる。",
    evidence: [...sideAEvidence, ...sideBEvidence],
    semanticValid: true,
    invalidReason: null,
    guardType: "interpretation",
    supportType: "cross_session_interpretation",
    relationType: "contrast",
    distinctSessionCount: 2,
    sideA: { text: "自由に考えたい", evidence: sideAEvidence },
    sideB: { text: "締切があると動きやすい", evidence: sideBEvidence },
    ...overrides,
  };
}

function connection(overrides: Partial<StoredReviewItem> = {}): StoredReviewItem {
  return {
    text: "ボトルネックが人間側の知見管理へ移っている。",
    evidence: [
      evidence({
        ref: "S01:M002:E01",
        quote: "整理が追いつかない。",
        sessionId: "s1",
        occurredAt: "2026-07-18",
      }),
      evidence({
        ref: "S02:M002:E01",
        quote: "再利用できる形にしたい。",
        sessionId: "s2",
        occurredAt: "2026-08-02",
      }),
    ],
    semanticValid: true,
    invalidReason: null,
    guardType: "interpretation",
    supportType: "cross_session_interpretation",
    relationType: "complement",
    distinctSessionCount: 2,
    ...overrides,
  };
}

function payload(overrides: Partial<StoredReviewPayload> = {}): StoredReviewPayload {
  return {
    summary: "運用の設計が主題になっている。",
    commonThemes: [
      {
        text: "人間側の整理が繰り返されている。",
        evidence: [],
        semanticValid: true,
        supportType: "cross_session_interpretation",
      },
    ],
    shifts: [shift()],
    tensions: [tension()],
    crossInsights: [connection()],
    hypotheses: [
      {
        text: "自分で期限を置くと進みやすい可能性がある。",
        evidence: [],
        semanticValid: true,
        supportType: "hypothesis",
      },
    ],
    openQuestions: [
      {
        text: "保存と再利用のどちらを先に減らすべきか？",
        evidence: [],
        semanticValid: true,
      },
    ],
    nextQuestions: [],
    settings: {
      provider: "openai",
      store: false,
      maxInputChars: INTEGRATED_REVIEW_MAX_INPUT_CHARS,
    },
    ...overrides,
  };
}

const detectedAt = "2026-08-18T05:00:00.000Z";

function project(overrides: Partial<StoredReviewPayload> = {}) {
  return fromReview({
    reviewId: "review-1",
    payload: payload(overrides),
    promptVersion: INTEGRATED_REVIEW_PROMPT_V5,
    detectedAt,
  });
}

test("有効な Shift / Connection / Tension だけを投影する", () => {
  const observations = project();
  assert.deepEqual(
    observations.map((item) => item.kind),
    ["shift", "connection", "tension"],
  );
  assert.equal(observations.every((item) => item.sourceReviewId === "review-1"), true);
});

test("commonThemes / hypotheses / openQuestions は Observation にしない", () => {
  const observations = project();
  assert.equal(
    observations.some((item) => item.title.includes("整理が繰り返されている")),
    false,
  );
  assert.equal(
    observations.some((item) => item.title.includes("期限を置く")),
    false,
  );
  assert.equal(
    observations.some((item) => item.title.includes("保存と再利用")),
    false,
  );
});

test("semanticValid が false の item は写像しない", () => {
  const observations = project({
    shifts: [
      shift({
        interpretation: "除外された変化",
        text: "除外された変化",
        semanticValid: false,
        invalidReason: "insufficient_distinct_sessions",
      }),
      shift(),
    ],
    crossInsights: [
      connection({
        text: "除外された接続",
        semanticValid: false,
        invalidReason: "generic_interpretation",
      }),
    ],
    tensions: [
      tension({
        text: "除外された緊張",
        semanticValid: false,
        invalidReason: "insufficient_distinct_sessions",
      }),
    ],
  });
  assert.equal(observations.length, 1);
  assert.equal(observations[0]?.kind, "shift");
  assert.equal(observations[0]?.payload.interpretation, "制約の捉え方が変化している。");
});

test("sourceRef は payload 配列上の元 index を使う", () => {
  const observations = project({
    shifts: [
      shift({
        interpretation: "除外",
        text: "除外",
        semanticValid: false,
        invalidReason: "insufficient_distinct_sessions",
      }),
      shift(),
    ],
  });
  const shiftObservation = observations.find((item) => item.kind === "shift");
  assert.equal(shiftObservation?.sourceRef, "R:SHIFT:02");
});

test("Shift payload は before / after / evidence を保持する", () => {
  const observation = project().find((item) => item.kind === "shift");
  assert.ok(observation);
  assert.equal(observation.kind, "shift");
  assert.equal(observation.payload.before, "自由に考えたい");
  assert.equal(observation.payload.after, "締切があると動きやすい");
  assert.equal(observation.payload.interpretation, "制約の捉え方が変化している。");
  assert.equal(observation.payload.beforeEvidence[0]?.messageRef, "S01:M001:E01");
  assert.equal(observation.payload.afterEvidence[0]?.messageRef, "S02:M001:E01");
  assert.equal(observation.payload.evidence.length, 2);
  assert.equal(observation.title, "制約の捉え方が変化している。");
  assert.notEqual(observation.title, observation.payload.before);
});

test("Tension payload は sideA / sideB を保持する", () => {
  const observation = project().find((item) => item.kind === "tension");
  assert.ok(observation);
  assert.equal(observation.kind, "tension");
  assert.equal(observation.payload.sideA?.text, "自由に考えたい");
  assert.equal(observation.payload.sideB?.text, "締切があると動きやすい");
  assert.equal(observation.payload.relationType, "contrast");
  assert.equal(observation.payload.sideA?.evidence[0]?.quote, "自由に考えたいです。");
  assert.equal(observation.sourceRef, "R:TENSION:01");
});

test("Connection payload は relationType と evidence を保持する", () => {
  const observation = project().find((item) => item.kind === "connection");
  assert.ok(observation);
  assert.equal(observation.kind, "connection");
  assert.equal(observation.payload.relationType, "complement");
  assert.equal(observation.payload.evidence.length, 2);
  assert.equal(observation.payload.text, "ボトルネックが人間側の知見管理へ移っている。");
  assert.equal(observation.sourceRef, "R:INSIGHT:01");
});

test("title / body は派生値であり payload を潰さない", () => {
  const shiftObservation = project().find((item) => item.kind === "shift");
  assert.ok(shiftObservation);
  assert.equal(shiftObservation.title, shiftObservation.payload.interpretation);
  assert.equal(shiftObservation.body, shiftObservation.payload.interpretation);
  assert.equal(typeof shiftObservation.payload.before, "string");
  assert.equal(typeof shiftObservation.payload.after, "string");
});

test("title に EvidenceRef を使わない", () => {
  for (const observation of project()) {
    assert.equal(/S\d+:M\d+:E\d+/.test(observation.title), false);
    assert.equal(/S\d+:M\d+:E\d+/.test(observation.body), false);
  }
});

test("firstSeenAt / lastSeenAt は根拠 Session の occurredAt から取る", () => {
  const observation = project().find((item) => item.kind === "shift");
  assert.equal(observation?.firstSeenAt, "2026-07-18");
  assert.equal(observation?.lastSeenAt, "2026-08-02");
  assert.deepEqual(observation?.sessionIds, ["s1", "s2"]);
});

test("evidence.occurredAt が無いときは sessions を使う", () => {
  const beforeEvidence = [
    evidence({
      ref: "S01:M001:E01",
      quote: "自由に考えたいです。",
      sessionId: "s1",
      occurredAt: null,
    }),
  ];
  const afterEvidence = [
    evidence({
      ref: "S02:M001:E01",
      quote: "締切があると動きやすいです。",
      sessionId: "s2",
      occurredAt: null,
    }),
  ];
  const observations = fromReview({
    reviewId: "review-1",
    detectedAt,
    promptVersion: INTEGRATED_REVIEW_PROMPT_V5,
    sessions: [
      { id: "s1", occurredAt: "2026-06-01" },
      { id: "s2", occurredAt: "2026-06-20" },
    ],
    payload: payload({
      shifts: [
        shift({
          beforeEvidence,
          afterEvidence,
          evidence: [...beforeEvidence, ...afterEvidence],
        }),
      ],
      crossInsights: [],
      tensions: [],
    }),
  });
  assert.equal(observations[0]?.firstSeenAt, "2026-06-01");
  assert.equal(observations[0]?.lastSeenAt, "2026-06-20");
});

test("detectedAt は投影時刻であり思考時刻にしない", () => {
  const observation = project()[0];
  assert.equal(observation?.detectedAt, detectedAt);
  assert.notEqual(observation?.detectedAt, observation?.firstSeenAt);
  assert.notEqual(observation?.detectedAt, observation?.lastSeenAt);
});

test("projectionVersion は review-observation-v1", () => {
  const observations = project();
  assert.equal(REVIEW_OBSERVATION_VERSION, "review-observation-v1");
  assert.equal(
    observations.every((item) => item.projectionVersion === "review-observation-v1"),
    true,
  );
});

test("入力 Review item は変更しない", () => {
  const source = payload();
  const originalBefore = source.shifts[0]?.before;
  const observations = fromReview({
    reviewId: "review-1",
    payload: source,
    promptVersion: INTEGRATED_REVIEW_PROMPT_V5,
    detectedAt,
  });
  const shiftObservation = observations.find((item) => item.kind === "shift");
  assert.ok(shiftObservation && shiftObservation.kind === "shift");
  shiftObservation.payload.before = "変更してはいけない";
  assert.equal(source.shifts[0]?.before, originalBefore);
});

test("同じ入力なら同じ Observation 配列になる", () => {
  const source = payload();
  const first = fromReview({
    reviewId: "review-1",
    payload: source,
    promptVersion: INTEGRATED_REVIEW_PROMPT_V5,
    detectedAt,
  });
  const second = fromReview({
    reviewId: "review-1",
    payload: source,
    promptVersion: INTEGRATED_REVIEW_PROMPT_V5,
    detectedAt,
  });
  assert.deepEqual(first, second);
});

test("v5 以外の Review は例外にせず投影しない", () => {
  assert.doesNotThrow(() => {
    fromReview({
      reviewId: "review-old",
      payload: payload(),
      promptVersion: INTEGRATED_REVIEW_PROMPT_V4,
      detectedAt,
    });
  });
  const observations = fromReview({
    reviewId: "review-old",
    payload: payload(),
    promptVersion: INTEGRATED_REVIEW_PROMPT_V4,
    detectedAt,
  });
  assert.deepEqual(observations, []);
});

test("firstSeenAt / lastSeenAt は item の Evidence Session だけを使う", () => {
  const observations = fromReview({
    reviewId: "review-1",
    payload: payload({
      crossInsights: [],
      tensions: [],
    }),
    promptVersion: INTEGRATED_REVIEW_PROMPT_V5,
    detectedAt,
    sessions: [
      { id: "s1", occurredAt: "2026-07-18" },
      { id: "s2", occurredAt: "2026-08-02" },
      { id: "s3", occurredAt: "2020-01-01" },
    ],
  });
  assert.equal(observations[0]?.firstSeenAt, "2026-07-18");
  assert.equal(observations[0]?.lastSeenAt, "2026-08-02");
  assert.equal(observations[0]?.sessionIds.includes("s3"), false);
});

test("Evidence.occurredAt があれば Session 日付より優先する", () => {
  const beforeEvidence = [
    evidence({
      ref: "S01:M001:E01",
      quote: "自由に考えたいです。",
      sessionId: "s1",
      occurredAt: "2026-07-18",
    }),
  ];
  const afterEvidence = [
    evidence({
      ref: "S02:M001:E01",
      quote: "締切があると動きやすいです。",
      sessionId: "s2",
      occurredAt: "2026-08-02",
    }),
  ];
  const observations = fromReview({
    reviewId: "review-1",
    promptVersion: INTEGRATED_REVIEW_PROMPT_V5,
    detectedAt,
    sessions: [
      { id: "s1", occurredAt: "2020-01-01" },
      { id: "s2", occurredAt: "2020-02-01" },
    ],
    payload: payload({
      shifts: [
        shift({
          beforeEvidence,
          afterEvidence,
          evidence: [...beforeEvidence, ...afterEvidence],
        }),
      ],
      crossInsights: [],
      tensions: [],
    }),
  });
  assert.equal(observations[0]?.firstSeenAt, "2026-07-18");
  assert.equal(observations[0]?.lastSeenAt, "2026-08-02");
});
