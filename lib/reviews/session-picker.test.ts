import assert from "node:assert/strict";
import test from "node:test";
import { INTEGRATED_REVIEW_MAX_INPUT_CHARS } from "@/lib/ai/limits";
import {
  lastDaysRange,
  rangeForReviewPreset,
  type ReviewDatePreset,
} from "@/lib/sessions/labels";
import {
  canRunIntegratedReviewSelection,
  emptyPickerSelection,
  estimatedReviewChars,
  filterPickerCandidates,
  formatReviewInputEstimate,
  reviewSelectionHint,
  selectVisibleAnalyzable,
  selectedCandidatesOf,
  togglePickerSelection,
  type SessionPickerCandidate,
  type SessionPickerRanges,
} from "./session-picker";

const now = new Date(2026, 7, 14);
const ranges: SessionPickerRanges = {
  "this-week": rangeForReviewPreset("this-week", now) as SessionPickerRanges["this-week"],
  "last-week": rangeForReviewPreset("last-week", now) as SessionPickerRanges["last-week"],
  "last-7-days": rangeForReviewPreset("last-7-days", now) as SessionPickerRanges["last-7-days"],
  "last-30-days": lastDaysRange(30, now),
};

function candidate(
  id: string,
  title: string,
  occurredAt: string,
  category = "制作",
  analyzable = true,
): SessionPickerCandidate {
  return {
    id,
    title,
    occurredAt,
    source: "chatgpt",
    category,
    messageCount: analyzable ? 4 : 0,
    charCount: analyzable ? 1000 : 0,
    analyzable,
  };
}

const allCandidates = [
  candidate("week", "今週の対話", "2026-08-12"),
  candidate("month", "思考統合研究所 A", "2026-07-20"),
  candidate("month-2", "思考統合研究所 B", "2026-07-25"),
  candidate("old", "古い対話", "2026-01-01"),
  candidate("empty", "空", "2026-08-12", "制作", false),
];

function visibleFor(
  preset: ReviewDatePreset,
  titleQuery = "",
  category = "",
) {
  return filterPickerCandidates(allCandidates, {
    preset,
    ranges,
    titleQuery,
    category,
  });
}

test("Case A: 初期状態は 0 件選択", () => {
  assert.equal(emptyPickerSelection().size, 0);
  assert.equal(reviewSelectionHint(0), "レビューするSessionを選んでください");
  assert.equal(formatReviewInputEstimate(0), "約 0 文字");
});

test("Case B: 過去30日は絞り込みだけで選択は 0 のまま", () => {
  const visible = visibleFor("last-30-days");
  const selected = emptyPickerSelection();
  assert.ok(visible.some((item) => item.id === "week"));
  assert.ok(visible.some((item) => item.id === "month"));
  assert.equal(visible.some((item) => item.id === "old"), false);
  assert.equal(selected.size, 0);
});

test("Case C: 表示中を全選択は現在表示中の analyzable だけ", () => {
  const visible = visibleFor("last-30-days");
  const selected = selectVisibleAnalyzable(visible);
  assert.equal(selected.has("empty"), false);
  assert.equal(selected.has("old"), false);
  assert.equal(selected.has("week"), true);
  assert.equal(selected.has("month"), true);
  assert.equal(selected.has("month-2"), true);
  assert.equal(selected.size, 3);
});

test("Case D: 検索後の表示中を全選択は絞り込み結果だけ", () => {
  const visible = visibleFor("last-30-days", "思考統合研究所");
  assert.equal(visible.length, 2);
  const selected = selectVisibleAnalyzable(visible);
  assert.deepEqual([...selected].sort(), ["month", "month-2"]);
});

test("Case E: 手動選択はフィルター変更後も保持する", () => {
  let selected = emptyPickerSelection();
  selected = togglePickerSelection(selected, "month", true);
  selected = togglePickerSelection(selected, "month-2", true);
  selected = togglePickerSelection(selected, "week", true);
  assert.equal(selected.size, 3);

  const hidden = visibleFor("this-week");
  assert.equal(hidden.some((item) => item.id === "month"), false);
  const stillSelected = selectedCandidatesOf(allCandidates, selected);
  assert.equal(stillSelected.length, 3);
  assert.equal(stillSelected.some((item) => item.id === "month"), true);
});

test("Case F: 選択をすべて解除すると 0 件", () => {
  const selected = selectVisibleAnalyzable(visibleFor("all"));
  assert.ok(selected.size > 0);
  assert.equal(emptyPickerSelection().size, 0);
});

test("Case G: 1 Session では実行不可", () => {
  assert.equal(reviewSelectionHint(1), "統合レビューには2件以上のSessionが必要です");
  assert.equal(canRunIntegratedReviewSelection(1, false), false);
});

test("Case H: 2 Session では実行可能", () => {
  assert.equal(reviewSelectionHint(2), null);
  assert.equal(canRunIntegratedReviewSelection(2, false), true);
  assert.equal(canRunIntegratedReviewSelection(2, true), false);
});

test("Case I: this-week プリセットは今週だけ表示し自動選択しない", () => {
  const visible = visibleFor("this-week");
  assert.deepEqual(
    visible.map((item) => item.id),
    ["week", "empty"],
  );
  assert.equal(emptyPickerSelection().size, 0);
});

test("入力上限超過時は文字数に上限を併記する", () => {
  const over = INTEGRATED_REVIEW_MAX_INPUT_CHARS + 12000;
  assert.match(formatReviewInputEstimate(over), /上限/);
  assert.equal(
    formatReviewInputEstimate(18420),
    "約 18,420 文字",
  );
  assert.equal(estimatedReviewChars([allCandidates[0]!, allCandidates[1]!]), 2000);
});
