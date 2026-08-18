import type { ReviewObservationKind } from "./types";
import { thoughtDate, thoughtDateSortKey } from "./thought-date";

export type SpotlightCandidate = {
  id: string;
  kind: ReviewObservationKind;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  detectedAt: string;
  distinctSessionCount: number;
  supportType?: string | null;
};

const KIND_WEIGHT: Record<ReviewObservationKind, number> = {
  shift: 2,
  connection: 1,
  tension: 0,
};

const KIND_TIE: Record<ReviewObservationKind, number> = {
  shift: 0,
  connection: 1,
  tension: 2,
};

function daysBetween(fromIso: string, now: Date) {
  const parsed = Date.parse(fromIso.length === 10 ? `${fromIso}T00:00:00` : fromIso);
  if (Number.isNaN(parsed)) {
    return null;
  }
  return Math.max(0, (now.getTime() - parsed) / 86_400_000);
}

function recencyScore(candidate: SpotlightCandidate, now: Date) {
  const date = thoughtDate(candidate);
  if (!date) {
    return 0;
  }
  const days = daysBetween(date, now);
  if (days === null) {
    return 0;
  }
  return Math.max(0, 6 - days / 14);
}

function noveltyScore(candidate: SpotlightCandidate, now: Date) {
  if (!candidate.firstSeenAt) {
    return 0;
  }
  const days = daysBetween(candidate.firstSeenAt, now);
  if (days === null || days > 30) {
    return 0;
  }
  return 1.5;
}

export function spotlightScore(candidate: SpotlightCandidate, now: Date) {
  const thought = thoughtDate(candidate);
  return (
    recencyScore(candidate, now) +
    KIND_WEIGHT[candidate.kind] +
    Math.min(candidate.distinctSessionCount, 3) +
    noveltyScore(candidate, now) +
    (thought ? 1.5 : 0) +
    (candidate.supportType === "direct" || candidate.kind === "shift" ? 0.5 : 0)
  );
}

export function isSpotlightEligible(candidate: SpotlightCandidate) {
  if (candidate.kind === "connection" || candidate.kind === "tension") {
    return candidate.distinctSessionCount >= 2;
  }
  return true;
}

export function compareSpotlight(
  left: SpotlightCandidate,
  right: SpotlightCandidate,
  now: Date,
) {
  const byScore = spotlightScore(right, now) - spotlightScore(left, now);
  if (byScore !== 0) {
    return byScore;
  }
  const byThought = thoughtDateSortKey(right).localeCompare(
    thoughtDateSortKey(left),
  );
  if (byThought !== 0) {
    return byThought;
  }
  const byKind = KIND_TIE[left.kind] - KIND_TIE[right.kind];
  if (byKind !== 0) {
    return byKind;
  }
  return left.id.localeCompare(right.id);
}

export function pickSpotlight<T extends SpotlightCandidate>(
  candidates: T[],
  now: Date,
): T | null {
  const eligible = candidates.filter(isSpotlightEligible);
  if (eligible.length === 0) {
    return null;
  }
  return [...eligible].sort((left, right) => compareSpotlight(left, right, now))[0] ?? null;
}
