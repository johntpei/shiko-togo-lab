import assert from "node:assert/strict";
import test from "node:test";
import {
  formatThoughtDate,
  thoughtDate,
  thoughtDateSortKey,
} from "./thought-date";

test("thoughtDate は lastSeenAt を優先する", () => {
  assert.equal(
    thoughtDate({ lastSeenAt: "2026-08-02", firstSeenAt: "2026-07-18" }),
    "2026-08-02",
  );
});

test("lastSeenAt が null なら firstSeenAt を使う", () => {
  assert.equal(
    thoughtDate({ lastSeenAt: null, firstSeenAt: "2026-07-18" }),
    "2026-07-18",
  );
});

test("thoughtDate が無い場合は null で、sort だけ detectedAt に倒す", () => {
  assert.equal(thoughtDate({ lastSeenAt: null, firstSeenAt: null }), null);
  assert.equal(
    thoughtDateSortKey({
      lastSeenAt: null,
      firstSeenAt: null,
      detectedAt: "2026-08-18T06:00:00.000Z",
    }),
    "2026-08-18T06:00:00.000Z",
  );
  assert.equal(formatThoughtDate(null), null);
});

test("表示用日付は thoughtDate を YYYY/MM/DD にする", () => {
  assert.equal(formatThoughtDate("2026-07-18"), "2026/07/18");
  assert.equal(formatThoughtDate("2026-07-18T12:00:00.000Z"), "2026/07/18");
});
