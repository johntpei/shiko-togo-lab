import type {
  StoredReviewEvidence,
  StoredReviewItem,
  StoredReviewPayload,
  StoredReviewShiftItem,
} from "@/lib/ai/review-schemas";
import { reviewItemSourceRef } from "@/lib/reviews/item-source-ref";
import { reviewProjectionEligibility } from "@/lib/reviews/projection-eligibility";
import { isVisibleReviewItem } from "@/lib/reviews/visible-items";
import {
  REVIEW_OBSERVATION_VERSION,
  type ConnectionObservation,
  type FromReviewInput,
  type Observation,
  type ObservationSessionInput,
  type ShiftObservation,
  type TensionObservation,
} from "./types";

function copyItem<T>(item: T): T {
  return structuredClone(item);
}

function evidenceOfShift(item: StoredReviewShiftItem): StoredReviewEvidence[] {
  return [
    ...(item.beforeEvidence ?? []),
    ...(item.afterEvidence ?? []),
    ...(item.evidence ?? []),
  ];
}

function evidenceOfItem(item: StoredReviewItem): StoredReviewEvidence[] {
  return [
    ...(item.evidence ?? []),
    ...(item.sideA?.evidence ?? []),
    ...(item.sideB?.evidence ?? []),
  ];
}

function sessionIdsFromEvidence(evidence: StoredReviewEvidence[]) {
  return [
    ...new Set(
      evidence
        .map((item) => item.sessionId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
}

/** この item の Evidence だけから日時を取る。Review 全体の Session 期間は使わない。 */
function timestampsFromEvidence(
  evidence: StoredReviewEvidence[],
  sessionById: Map<string, string>,
) {
  const times: string[] = [];
  for (const item of evidence) {
    if (item.occurredAt) {
      times.push(item.occurredAt);
      continue;
    }
    if (!item.sessionId) {
      continue;
    }
    const occurredAt = sessionById.get(item.sessionId);
    if (occurredAt) {
      times.push(occurredAt);
    }
  }
  return times;
}

function seenRange(times: string[]) {
  if (times.length === 0) {
    return { firstSeenAt: null, lastSeenAt: null };
  }
  const sorted = [...times].sort((left, right) => left.localeCompare(right));
  return {
    firstSeenAt: sorted[0] ?? null,
    lastSeenAt: sorted[sorted.length - 1] ?? null,
  };
}

function sessionMap(sessions: readonly ObservationSessionInput[] | undefined) {
  return new Map((sessions ?? []).map((session) => [session.id, session.occurredAt]));
}

function displayText(value: string | undefined) {
  return (value ?? "").trim();
}

function fromShift(
  item: StoredReviewShiftItem,
  index: number,
  input: FromReviewInput,
  sessionById: Map<string, string>,
): ShiftObservation {
  const payload = copyItem(item);
  const evidence = evidenceOfShift(payload);
  const sessionIds = sessionIdsFromEvidence(evidence);
  const claim = displayText(payload.interpretation) || displayText(payload.text);
  return {
    kind: "shift",
    projectionVersion: REVIEW_OBSERVATION_VERSION,
    sourceReviewId: input.reviewId,
    sourceRef: reviewItemSourceRef("shift", index),
    title: claim,
    body: claim,
    supportType: payload.supportType,
    ...seenRange(timestampsFromEvidence(evidence, sessionById)),
    detectedAt: input.detectedAt,
    sessionIds,
    distinctSessionCount: payload.distinctSessionCount ?? sessionIds.length,
    payload,
  };
}

function fromConnection(
  item: StoredReviewItem,
  index: number,
  input: FromReviewInput,
  sessionById: Map<string, string>,
): ConnectionObservation {
  const payload = copyItem(item);
  const evidence = evidenceOfItem(payload);
  const sessionIds = sessionIdsFromEvidence(evidence);
  const claim = displayText(payload.text);
  return {
    kind: "connection",
    projectionVersion: REVIEW_OBSERVATION_VERSION,
    sourceReviewId: input.reviewId,
    sourceRef: reviewItemSourceRef("insight", index),
    title: claim,
    body: claim,
    supportType: payload.supportType,
    ...seenRange(timestampsFromEvidence(evidence, sessionById)),
    detectedAt: input.detectedAt,
    sessionIds,
    distinctSessionCount: payload.distinctSessionCount ?? sessionIds.length,
    payload,
  };
}

function fromTension(
  item: StoredReviewItem,
  index: number,
  input: FromReviewInput,
  sessionById: Map<string, string>,
): TensionObservation {
  const payload = copyItem(item);
  const evidence = evidenceOfItem(payload);
  const sessionIds = sessionIdsFromEvidence(evidence);
  const claim = displayText(payload.text);
  return {
    kind: "tension",
    projectionVersion: REVIEW_OBSERVATION_VERSION,
    sourceReviewId: input.reviewId,
    sourceRef: reviewItemSourceRef("tension", index),
    title: claim,
    body: claim,
    supportType: payload.supportType,
    ...seenRange(timestampsFromEvidence(evidence, sessionById)),
    detectedAt: input.detectedAt,
    sessionIds,
    distinctSessionCount: payload.distinctSessionCount ?? sessionIds.length,
    payload,
  };
}

export function fromReview(input: FromReviewInput): Observation[] {
  const eligibility = reviewProjectionEligibility(input.promptVersion);
  if (!eligibility.eligible) {
    return [];
  }

  const payload: StoredReviewPayload = input.payload;
  const sessionById = sessionMap(input.sessions);
  const observations: Observation[] = [];

  payload.shifts.forEach((item, index) => {
    if (!isVisibleReviewItem(item)) {
      return;
    }
    observations.push(fromShift(item, index, input, sessionById));
  });

  payload.crossInsights.forEach((item, index) => {
    if (!isVisibleReviewItem(item)) {
      return;
    }
    observations.push(fromConnection(item, index, input, sessionById));
  });

  payload.tensions.forEach((item, index) => {
    if (!isVisibleReviewItem(item)) {
      return;
    }
    observations.push(fromTension(item, index, input, sessionById));
  });

  return observations;
}
