/**
 * Review UI / Context Pack / Observation が共有する
 * 「ユーザーに表示可能な有効 Review item」判定。
 *
 * Guard 本体は Review 保存時に走り、結果は semanticValid に載る。
 * ここは semanticValid を読むだけ。判定ロジックを複製しない。
 *
 * undefined は可視（レガシー item）。false のみ除外。
 */
export function isVisibleReviewItem(item: { semanticValid?: boolean }) {
  return item.semanticValid !== false;
}

export function isHiddenReviewItem(item: { semanticValid?: boolean }) {
  return item.semanticValid === false;
}

export function visibleReviewItems<T extends { semanticValid?: boolean }>(
  items: T[],
) {
  return items.filter(isVisibleReviewItem);
}

export function hiddenReviewItems<T extends { semanticValid?: boolean }>(
  items: T[],
) {
  return items.filter(isHiddenReviewItem);
}
