import assert from "node:assert/strict";
import test from "node:test";
import {
  hiddenReviewItems,
  isHiddenReviewItem,
  isVisibleReviewItem,
  visibleReviewItems,
} from "./visible-items";

test("semanticValid が true なら表示可能", () => {
  assert.equal(isVisibleReviewItem({ semanticValid: true }), true);
  assert.equal(isHiddenReviewItem({ semanticValid: true }), false);
});

test("semanticValid が未設定なら表示可能（レガシー item）", () => {
  assert.equal(isVisibleReviewItem({}), true);
  assert.equal(isHiddenReviewItem({}), false);
});

test("semanticValid が false だけ除外する", () => {
  assert.equal(isVisibleReviewItem({ semanticValid: false }), false);
  assert.equal(isHiddenReviewItem({ semanticValid: false }), true);
});

test("visibleReviewItems / hiddenReviewItems は同じ判定を使う", () => {
  const items = [
    { text: "visible-true", semanticValid: true },
    { text: "visible-legacy" },
    { text: "hidden", semanticValid: false },
  ];
  assert.deepEqual(
    visibleReviewItems(items).map((item) => item.text),
    ["visible-true", "visible-legacy"],
  );
  assert.deepEqual(
    hiddenReviewItems(items).map((item) => item.text),
    ["hidden"],
  );
});
