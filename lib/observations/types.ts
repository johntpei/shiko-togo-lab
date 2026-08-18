import type {
  ReviewSupportType,
  StoredReviewItem,
  StoredReviewPayload,
  StoredReviewShiftItem,
} from "@/lib/ai/review-schemas";

export const REVIEW_OBSERVATION_VERSION = "review-observation-v1";

export type ReviewObservationVersion = typeof REVIEW_OBSERVATION_VERSION;

export const REVIEW_OBSERVATION_KINDS = [
  "shift",
  "connection",
  "tension",
] as const;

export type ReviewObservationKind = (typeof REVIEW_OBSERVATION_KINDS)[number];

export type ObservationSessionInput = {
  id: string;
  occurredAt: string;
};

type ObservationBase = {
  projectionVersion: ReviewObservationVersion;
  sourceReviewId: string;
  sourceRef: string;
  title: string;
  body: string;
  supportType?: ReviewSupportType;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  detectedAt: string;
  sessionIds: string[];
  distinctSessionCount: number;
};

export type ShiftObservation = ObservationBase & {
  kind: "shift";
  payload: StoredReviewShiftItem;
};

export type ConnectionObservation = ObservationBase & {
  kind: "connection";
  payload: StoredReviewItem;
};

export type TensionObservation = ObservationBase & {
  kind: "tension";
  payload: StoredReviewItem;
};

export type Observation =
  | ShiftObservation
  | ConnectionObservation
  | TensionObservation;

export type FromReviewInput = {
  reviewId: string;
  payload: StoredReviewPayload;
  promptVersion: string;
  sessions?: readonly ObservationSessionInput[];
  detectedAt: string;
};
