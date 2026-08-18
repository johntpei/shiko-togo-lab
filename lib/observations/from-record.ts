import {
  REVIEW_SUPPORT_TYPES,
  storedReviewItemSchema,
  storedReviewShiftItemSchema,
  type ReviewSupportType,
} from "@/lib/ai/review-schemas";
import type { ObservationRecord } from "@/lib/db/schema";
import { isVisibleReviewItem } from "@/lib/reviews/visible-items";
import type {
  ConnectionObservation,
  Observation,
  ReviewObservationKind,
  ReviewObservationVersion,
  ShiftObservation,
  TensionObservation,
} from "./types";
import { REVIEW_OBSERVATION_KINDS, REVIEW_OBSERVATION_VERSION } from "./types";

export function isReviewObservationKind(
  value: string,
): value is ReviewObservationKind {
  return (REVIEW_OBSERVATION_KINDS as readonly string[]).includes(value);
}

function asSupportType(value: string | null | undefined): ReviewSupportType | undefined {
  if (!value) {
    return undefined;
  }
  return (REVIEW_SUPPORT_TYPES as readonly string[]).includes(value)
    ? (value as ReviewSupportType)
    : undefined;
}

export function observationFromRecord(
  record: ObservationRecord,
  sessionIds: string[],
): Observation | null {
  if (!isReviewObservationKind(record.kind)) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(record.payload);
  } catch {
    return null;
  }
  const base = {
    projectionVersion: REVIEW_OBSERVATION_VERSION as ReviewObservationVersion,
    sourceReviewId: record.sourceReviewId,
    sourceRef: record.sourceRef,
    title: record.title,
    body: record.body,
    firstSeenAt: record.firstSeenAt,
    lastSeenAt: record.lastSeenAt,
    detectedAt: record.detectedAt,
    sessionIds,
    distinctSessionCount: record.distinctSessionCount,
  };
  if (record.kind === "shift") {
    const payload = storedReviewShiftItemSchema.safeParse(parsed);
    if (!payload.success || !isVisibleReviewItem(payload.data)) {
      return null;
    }
    return {
      ...base,
      kind: "shift",
      supportType: payload.data.supportType ?? asSupportType(record.supportType),
      payload: payload.data,
    } satisfies ShiftObservation;
  }
  const payload = storedReviewItemSchema.safeParse(parsed);
  if (!payload.success || !isVisibleReviewItem(payload.data)) {
    return null;
  }
  if (record.kind === "connection") {
    return {
      ...base,
      kind: "connection",
      supportType: payload.data.supportType ?? asSupportType(record.supportType),
      payload: payload.data,
    } satisfies ConnectionObservation;
  }
  return {
    ...base,
    kind: "tension",
    supportType: payload.data.supportType ?? asSupportType(record.supportType),
    payload: payload.data,
  } satisfies TensionObservation;
}
