import { calendarDateFromOccurredAt } from "@/lib/concepts/topic-signal/calendar";
import {
  isReviewObservationKind,
  observationFromRecord,
} from "@/lib/observations/from-record";
import { thoughtDate } from "@/lib/observations/thought-date";
import type { ObservationRecord } from "@/lib/db/schema";
import type { ReviewObservationKind } from "@/lib/observations/types";
import type {
  ThoughtTimeline,
  ThoughtTimelineBuildInput,
  ThoughtTimelineGroup,
  ThoughtTimelineObservationItem,
  ThoughtTimelineRelatedConcept,
  ThoughtTimelineSkip,
  ThoughtTimelineSkipReason,
  ThoughtTimelineSourceObservation,
} from "./types";
import { THOUGHT_TIMELINE_VERSION } from "./types";

export type ThoughtTimelineBuildResult = {
  timeline: ThoughtTimeline;
  skipped: ThoughtTimelineSkip[];
};

function emptyTimeline(): ThoughtTimeline {
  return {
    version: THOUGHT_TIMELINE_VERSION,
    range: { firstOccurredAt: null, lastOccurredAt: null },
    groups: [],
  };
}

function compareRelatedConcept(
  left: ThoughtTimelineRelatedConcept,
  right: ThoughtTimelineRelatedConcept,
) {
  return left.conceptId.localeCompare(right.conceptId);
}

function skipReasonForRecord(
  source: ThoughtTimelineSourceObservation,
): ThoughtTimelineSkipReason | null {
  if (!isReviewObservationKind(source.kind)) {
    return "unsupported_kind";
  }
  try {
    JSON.parse(source.payload);
  } catch {
    return "unparseable_payload";
  }
  const parsed = observationFromRecord(
    sourceToRecord(source),
    source.sessionIds,
  );
  if (!parsed) {
    return "not_visible";
  }
  const occurredAt = thoughtDate(parsed);
  if (!occurredAt) {
    return "missing_thought_occurrence";
  }
  if (!calendarDateFromOccurredAt(occurredAt)) {
    return "invalid_thought_occurrence";
  }
  return null;
}

function sourceToRecord(
  source: ThoughtTimelineSourceObservation,
): ObservationRecord {
  return {
    id: source.id,
    kind: source.kind,
    projectionVersion: "review-observation-v1",
    sourceReviewId: "timeline-source",
    sourceRef: source.id,
    title: source.title,
    body: source.body,
    supportType: null,
    payload: source.payload,
    firstSeenAt: source.firstSeenAt,
    lastSeenAt: source.lastSeenAt,
    detectedAt: source.detectedAt,
    distinctSessionCount: new Set(source.sessionIds).size,
    createdAt: source.createdAt,
  };
}

function toItem(
  source: ThoughtTimelineSourceObservation,
  observationType: ReviewObservationKind,
  occurredAt: string,
): ThoughtTimelineObservationItem {
  return {
    kind: "observation",
    observationId: source.id,
    observationType,
    occurredAt,
    title: source.title,
    summary: source.body,
    sessionIds: [...new Set(source.sessionIds)].sort((left, right) =>
      left.localeCompare(right),
    ),
    relatedConcepts: [...source.relatedConcepts].sort(compareRelatedConcept),
  };
}

function compareItems(
  left: ThoughtTimelineObservationItem,
  right: ThoughtTimelineObservationItem,
) {
  const byOccurred = right.occurredAt.localeCompare(left.occurredAt);
  if (byOccurred !== 0) {
    return byOccurred;
  }
  return left.observationId.localeCompare(right.observationId);
}

/**
 * Observation Timeline v0.
 * occurredAt = existing thoughtDate (lastSeenAt ?? firstSeenAt).
 * Does not use createdAt / detectedAt as the timeline position.
 * Does not infer Concept relations from Observation text.
 */
export function assembleThoughtTimeline(
  input: ThoughtTimelineBuildInput,
): ThoughtTimelineBuildResult {
  const skipped: ThoughtTimelineSkip[] = [];
  const included: ThoughtTimelineObservationItem[] = [];

  for (const source of input.observations) {
    const skipReason = skipReasonForRecord(source);
    if (skipReason) {
      skipped.push({ observationId: source.id, skipReason });
      continue;
    }
    const parsed = observationFromRecord(
      sourceToRecord(source),
      source.sessionIds,
    );
    if (!parsed) {
      skipped.push({ observationId: source.id, skipReason: "not_visible" });
      continue;
    }
    const occurredAt = thoughtDate(parsed);
    if (!occurredAt || !calendarDateFromOccurredAt(occurredAt)) {
      skipped.push({
        observationId: source.id,
        skipReason: occurredAt
          ? "invalid_thought_occurrence"
          : "missing_thought_occurrence",
      });
      continue;
    }
    included.push(toItem(source, parsed.kind, occurredAt));
  }

  included.sort(compareItems);

  const groupsByDate = new Map<string, ThoughtTimelineObservationItem[]>();
  for (const item of included) {
    const date = calendarDateFromOccurredAt(item.occurredAt);
    if (!date) {
      continue;
    }
    const current = groupsByDate.get(date) ?? [];
    current.push(item);
    groupsByDate.set(date, current);
  }

  const groups: ThoughtTimelineGroup[] = [...groupsByDate.entries()]
    .sort((left, right) => right[0].localeCompare(left[0]))
    .map(([date, items]) => ({
      date,
      items: [...items].sort(compareItems),
    }));

  const occurredAts = included.map((item) => item.occurredAt).sort();
  const timeline: ThoughtTimeline =
    included.length === 0
      ? emptyTimeline()
      : {
          version: THOUGHT_TIMELINE_VERSION,
          range: {
            firstOccurredAt: occurredAts[0] ?? null,
            lastOccurredAt: occurredAts[occurredAts.length - 1] ?? null,
          },
          groups,
        };

  skipped.sort((left, right) =>
    left.observationId.localeCompare(right.observationId),
  );

  return { timeline, skipped };
}

export function buildThoughtTimeline(
  input: ThoughtTimelineBuildInput,
): ThoughtTimeline {
  return assembleThoughtTimeline(input).timeline;
}
