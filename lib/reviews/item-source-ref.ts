/**
 * Review item の canonical SourceRef。
 * 番号は payload 配列の元 index（0始まり）を 1始まり 2桁にしたもの。
 * 可視 item だけを数え直さない。
 *
 * 例: shifts[1] → R:SHIFT:02（index 0 が Guard 除外でも変わらない）
 */
export const REVIEW_ITEM_SOURCE_REF_KINDS = [
  "shift",
  "theme",
  "tension",
  "insight",
  "hypothesis",
  "open_question",
  "next_question",
] as const;

export type ReviewItemSourceRefKind =
  (typeof REVIEW_ITEM_SOURCE_REF_KINDS)[number];

const REVIEW_ITEM_SOURCE_REF_PREFIX: Record<ReviewItemSourceRefKind, string> = {
  shift: "R:SHIFT",
  theme: "R:THEME",
  tension: "R:TENSION",
  insight: "R:INSIGHT",
  hypothesis: "R:HYPOTHESIS",
  open_question: "R:OPEN",
  next_question: "R:NEXT",
};

export function formatReviewItemIndex(index: number) {
  return String(index + 1).padStart(2, "0");
}

export function reviewItemSourceRef(
  kind: ReviewItemSourceRefKind,
  index: number,
) {
  return `${REVIEW_ITEM_SOURCE_REF_PREFIX[kind]}:${formatReviewItemIndex(index)}`;
}
