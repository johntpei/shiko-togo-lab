import {
  INTEGRATED_REVIEW_MAX_INPUT_CHARS,
  MIN_INTEGRATED_REVIEW_SESSIONS,
} from "@/lib/ai/limits";
import {
  sessionInDateRange,
  type ReviewDatePreset,
} from "@/lib/sessions/labels";

export type SessionPickerCandidate = {
  id: string;
  title: string;
  occurredAt: string;
  source: string;
  category: string;
  messageCount: number;
  charCount: number;
  analyzable: boolean;
};

export type SessionPickerRanges = Record<
  Exclude<ReviewDatePreset, "all">,
  { start: string; end: string }
>;

export type SessionPickerFilter = {
  preset: ReviewDatePreset;
  ranges: SessionPickerRanges;
  titleQuery: string;
  category: string;
};

export function emptyPickerSelection() {
  return new Set<string>();
}

export function filterPickerCandidates(
  candidates: SessionPickerCandidate[],
  filter: SessionPickerFilter,
) {
  const range =
    filter.preset === "all" ? { start: "", end: "" } : filter.ranges[filter.preset];
  const query = filter.titleQuery.trim().toLowerCase();
  return candidates.filter((candidate) => {
    if (!sessionInDateRange(candidate.occurredAt, range)) {
      return false;
    }
    if (filter.category && candidate.category !== filter.category) {
      return false;
    }
    if (query && !candidate.title.toLowerCase().includes(query)) {
      return false;
    }
    return true;
  });
}

export function selectVisibleAnalyzable(visible: SessionPickerCandidate[]) {
  return new Set(
    visible.filter((candidate) => candidate.analyzable).map((candidate) => candidate.id),
  );
}

export function togglePickerSelection(
  current: Set<string>,
  id: string,
  analyzable: boolean,
) {
  if (!analyzable) {
    return current;
  }
  const next = new Set(current);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  return next;
}

export function selectedCandidatesOf(
  candidates: SessionPickerCandidate[],
  selected: Set<string>,
) {
  return candidates.filter((candidate) => selected.has(candidate.id));
}

export function estimatedReviewChars(selected: SessionPickerCandidate[]) {
  return selected.reduce((sum, candidate) => sum + candidate.charCount, 0);
}

export function isReviewInputOverLimit(
  chars: number,
  max = INTEGRATED_REVIEW_MAX_INPUT_CHARS,
) {
  return chars > max;
}

export function canRunIntegratedReviewSelection(
  selectedCount: number,
  overLimit: boolean,
) {
  return selectedCount >= MIN_INTEGRATED_REVIEW_SESSIONS && !overLimit;
}

export function reviewSelectionHint(selectedCount: number) {
  if (selectedCount === 0) {
    return "レビューするSessionを選んでください";
  }
  if (selectedCount === 1) {
    return "統合レビューには2件以上のSessionが必要です";
  }
  return null;
}

export function formatReviewInputEstimate(
  chars: number,
  max = INTEGRATED_REVIEW_MAX_INPUT_CHARS,
) {
  const approx = `約 ${chars.toLocaleString()} 文字`;
  if (chars > max) {
    return `${approx} / 上限 ${max.toLocaleString()} 文字`;
  }
  return approx;
}
