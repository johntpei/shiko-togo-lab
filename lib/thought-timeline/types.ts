import type { ReviewObservationKind } from "@/lib/observations/types";

export const THOUGHT_TIMELINE_VERSION = "thought-timeline-v0";

export type ThoughtTimelineVersion = typeof THOUGHT_TIMELINE_VERSION;

export const THOUGHT_TIMELINE_SKIP_REASONS = [
  "unsupported_kind",
  "unparseable_payload",
  "not_visible",
  "missing_thought_occurrence",
  "invalid_thought_occurrence",
] as const;

export type ThoughtTimelineSkipReason =
  (typeof THOUGHT_TIMELINE_SKIP_REASONS)[number];

export type ThoughtTimelineRelatedConcept = {
  conceptId: string;
  canonicalLabel: string;
};

export type ThoughtTimelineObservationItem = {
  kind: "observation";
  observationId: string;
  observationType: ReviewObservationKind;
  occurredAt: string;
  title: string;
  summary: string;
  sessionIds: string[];
  relatedConcepts: ThoughtTimelineRelatedConcept[];
};

export type ThoughtTimelineGroup = {
  date: string;
  items: ThoughtTimelineObservationItem[];
};

export type ThoughtTimeline = {
  version: ThoughtTimelineVersion;
  range: {
    firstOccurredAt: string | null;
    lastOccurredAt: string | null;
  };
  groups: ThoughtTimelineGroup[];
};

export type ThoughtTimelineSkip = {
  observationId: string;
  skipReason: ThoughtTimelineSkipReason;
};

export type ThoughtTimelineSourceObservation = {
  id: string;
  kind: string;
  title: string;
  body: string;
  payload: string;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  detectedAt: string;
  createdAt: string;
  sessionIds: string[];
  relatedConcepts: ThoughtTimelineRelatedConcept[];
};

export type ThoughtTimelineBuildInput = {
  observations: ThoughtTimelineSourceObservation[];
};
