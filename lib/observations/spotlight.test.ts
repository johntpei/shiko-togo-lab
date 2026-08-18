import assert from "node:assert/strict";
import test from "node:test";
import {
  compareSpotlight,
  isSpotlightEligible,
  pickSpotlight,
  spotlightScore,
  type SpotlightCandidate,
} from "./spotlight";

const now = new Date("2026-08-18T00:00:00.000Z");

function candidate(
  overrides: Partial<SpotlightCandidate> & Pick<SpotlightCandidate, "id" | "kind">,
): SpotlightCandidate {
  return {
    firstSeenAt: "2026-08-01",
    lastSeenAt: "2026-08-10",
    detectedAt: "2026-08-18T06:00:00.000Z",
    distinctSessionCount: 2,
    supportType: "cross_session_interpretation",
    ...overrides,
  };
}

test("1 Session の connection / tension は Spotlight 対象外", () => {
  assert.equal(
    isSpotlightEligible(candidate({ id: "c1", kind: "connection", distinctSessionCount: 1 })),
    false,
  );
  assert.equal(
    isSpotlightEligible(candidate({ id: "t1", kind: "tension", distinctSessionCount: 1 })),
    false,
  );
  assert.equal(
    isSpotlightEligible(candidate({ id: "s1", kind: "shift", distinctSessionCount: 1 })),
    true,
  );
});

test("新しい Connection は古い Shift より高得点になり得る", () => {
  const oldShift = candidate({
    id: "shift-old",
    kind: "shift",
    firstSeenAt: "2026-01-01",
    lastSeenAt: "2026-01-02",
    supportType: "direct",
  });
  const recentConnection = candidate({
    id: "conn-new",
    kind: "connection",
    firstSeenAt: "2026-08-10",
    lastSeenAt: "2026-08-17",
  });
  assert.ok(spotlightScore(recentConnection, now) > spotlightScore(oldShift, now));
  assert.equal(pickSpotlight([oldShift, recentConnection], now)?.id, "conn-new");
});

test("同点なら thoughtDate、kind、id で決定論的に並べる", () => {
  const left = candidate({
    id: "a",
    kind: "connection",
    lastSeenAt: "2026-08-10",
    firstSeenAt: "2026-08-10",
  });
  const right = candidate({
    id: "b",
    kind: "connection",
    lastSeenAt: "2026-08-10",
    firstSeenAt: "2026-08-10",
  });
  assert.equal(spotlightScore(left, now), spotlightScore(right, now));
  assert.ok(compareSpotlight(left, right, now) < 0);
  assert.equal(pickSpotlight([right, left], now)?.id, "a");
});

test("thoughtDate が無い候補は recency 0 で、eligible な他があれば負けやすい", () => {
  const undated = candidate({
    id: "undated",
    kind: "shift",
    firstSeenAt: null,
    lastSeenAt: null,
    supportType: "direct",
  });
  const dated = candidate({
    id: "dated",
    kind: "tension",
    firstSeenAt: "2026-08-01",
    lastSeenAt: "2026-08-16",
    distinctSessionCount: 3,
  });
  assert.equal(pickSpotlight([undated, dated], now)?.id, "dated");
});

test("候補が空、または全部対象外なら null", () => {
  assert.equal(pickSpotlight([], now), null);
  assert.equal(
    pickSpotlight(
      [
        candidate({
          id: "c1",
          kind: "connection",
          distinctSessionCount: 1,
        }),
      ],
      now,
    ),
    null,
  );
});
