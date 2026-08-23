import { uniqueSortedSessionIds } from "@/lib/processing-orchestrator/plan";

export function normalizeReviewSelectionSessionIds(
  sessionIds: readonly string[],
): string[] {
  return uniqueSortedSessionIds(sessionIds);
}

export function reviewSessionSetsEqual(
  left: readonly string[],
  right: readonly string[],
): boolean {
  const normalizedLeft = normalizeReviewSelectionSessionIds(left);
  const normalizedRight = normalizeReviewSelectionSessionIds(right);
  if (normalizedLeft.length !== normalizedRight.length) {
    return false;
  }
  return normalizedLeft.every((id, index) => id === normalizedRight[index]);
}

export function reviewSessionSetKey(sessionIds: readonly string[]): string {
  return normalizeReviewSelectionSessionIds(sessionIds).join("\u001f");
}
