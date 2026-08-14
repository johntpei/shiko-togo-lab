import assert from "node:assert/strict";
import test from "node:test";
import {
  currentWeekRange,
  lastDaysRange,
  lastWeekRange,
  rangeForReviewPreset,
  sessionInDateRange,
  buildIntegratedReviewTitle,
} from "./labels";

test("週の定義はローカルタイムの月曜〜日曜", () => {
  const friday = new Date(2026, 7, 14);
  assert.deepEqual(currentWeekRange(friday), {
    start: "2026-08-10",
    end: "2026-08-16",
  });
});

test("先週は直前の月曜〜日曜", () => {
  const friday = new Date(2026, 7, 14);
  assert.deepEqual(lastWeekRange(friday), {
    start: "2026-08-03",
    end: "2026-08-09",
  });
});

test("過去7日 / 過去30日は inclusive", () => {
  const friday = new Date(2026, 7, 14);
  assert.deepEqual(lastDaysRange(7, friday), {
    start: "2026-08-08",
    end: "2026-08-14",
  });
  assert.deepEqual(lastDaysRange(30, friday), {
    start: "2026-07-16",
    end: "2026-08-14",
  });
});

test("preset の週計算は currentWeekRange と一致する", () => {
  const now = new Date(2026, 7, 14);
  assert.deepEqual(rangeForReviewPreset("this-week", now), currentWeekRange(now));
  assert.equal(sessionInDateRange("2026-08-10", currentWeekRange(now)), true);
  assert.equal(sessionInDateRange("2026-08-09", currentWeekRange(now)), false);
});

test("今週レビューのタイトルは週範囲を使う", () => {
  const title = buildIntegratedReviewTitle({
    preset: "this-week",
    sessionOccurredAts: ["2026-08-12"],
    now: new Date(2026, 7, 14),
  });
  assert.equal(title, "今週の統合レビュー 2026/08/10〜2026/08/16");
});
