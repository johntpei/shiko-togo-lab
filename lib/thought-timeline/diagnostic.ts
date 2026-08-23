import type { ReviewObservationKind } from "@/lib/observations/types";
import { REVIEW_OBSERVATION_KINDS } from "@/lib/observations/types";
import type { ThoughtTimeline } from "./types";
import type { ThoughtTimelineSkip } from "./types";
import { THOUGHT_TIMELINE_SKIP_REASONS } from "./types";

export const THOUGHT_TIMELINE_DIAGNOSTIC_VERSION =
  "thought-timeline-diagnostic-v0";

export type ThoughtTimelineTypeDistribution = Record<
  ReviewObservationKind,
  number
>;

export type ThoughtTimelineDateCount = {
  date: string;
  count: number;
};

export type ThoughtTimelineSessionCount = {
  sessionId: string;
  observationCount: number;
};

export type ThoughtTimelineSkipReasonCounts = Record<
  (typeof THOUGHT_TIMELINE_SKIP_REASONS)[number],
  number
>;

export type ThoughtTimelineDiagnostic = {
  version: typeof THOUGHT_TIMELINE_DIAGNOSTIC_VERSION;
  sourceObservationCount: number;
  includedCount: number;
  skippedObservationCount: number;
  skipReasonCounts: ThoughtTimelineSkipReasonCounts;
  typeDistribution: ThoughtTimelineTypeDistribution;
  range: {
    firstOccurredAt: string | null;
    lastOccurredAt: string | null;
  };
  distinctDateCount: number;
  distinctSessionCount: number;
  datesWithMultipleObservations: number;
  maxObservationsOnOneDate: number;
  observationsWithMultipleSessions: number;
  datesWithMultipleSessions: number;
  relatedConceptCoverage: {
    withRelated: number;
    withoutRelated: number;
  };
  hasObservationConceptsRelation: boolean;
  conceptOccurrenceCount: number;
  timelineIncludesConceptOccurrence: false;
};

function emptySkipCounts(): ThoughtTimelineSkipReasonCounts {
  return {
    unsupported_kind: 0,
    unparseable_payload: 0,
    not_visible: 0,
    missing_thought_occurrence: 0,
    invalid_thought_occurrence: 0,
  };
}

function emptyTypes(): ThoughtTimelineTypeDistribution {
  return { shift: 0, connection: 0, tension: 0 };
}

export function buildThoughtTimelineDiagnostic(input: {
  sourceObservationCount: number;
  timeline: ThoughtTimeline;
  skipped: ThoughtTimelineSkip[];
  hasObservationConceptsRelation: boolean;
  conceptOccurrenceCount: number;
}): ThoughtTimelineDiagnostic {
  const items = input.timeline.groups.flatMap((group) => group.items);
  const typeDistribution = emptyTypes();
  for (const item of items) {
    typeDistribution[item.observationType] += 1;
  }

  const skipReasonCounts = emptySkipCounts();
  for (const skip of input.skipped) {
    skipReasonCounts[skip.skipReason] += 1;
  }

  const dateCounts = input.timeline.groups.map((group) => group.items.length);
  const sessionIds = new Set<string>();
  let observationsWithMultipleSessions = 0;
  let withRelated = 0;
  for (const item of items) {
    if (item.sessionIds.length >= 2) {
      observationsWithMultipleSessions += 1;
    }
    if (item.relatedConcepts.length >= 1) {
      withRelated += 1;
    }
    for (const sessionId of item.sessionIds) {
      sessionIds.add(sessionId);
    }
  }

  let datesWithMultipleSessions = 0;
  for (const group of input.timeline.groups) {
    const onDate = new Set(group.items.flatMap((item) => item.sessionIds));
    if (onDate.size >= 2) {
      datesWithMultipleSessions += 1;
    }
  }

  return {
    version: THOUGHT_TIMELINE_DIAGNOSTIC_VERSION,
    sourceObservationCount: input.sourceObservationCount,
    includedCount: items.length,
    skippedObservationCount: input.skipped.length,
    skipReasonCounts,
    typeDistribution,
    range: input.timeline.range,
    distinctDateCount: input.timeline.groups.length,
    distinctSessionCount: sessionIds.size,
    datesWithMultipleObservations: dateCounts.filter((count) => count >= 2)
      .length,
    maxObservationsOnOneDate: dateCounts.length === 0 ? 0 : Math.max(...dateCounts),
    observationsWithMultipleSessions,
    datesWithMultipleSessions,
    relatedConceptCoverage: {
      withRelated,
      withoutRelated: items.length - withRelated,
    },
    hasObservationConceptsRelation: input.hasObservationConceptsRelation,
    conceptOccurrenceCount: input.conceptOccurrenceCount,
    timelineIncludesConceptOccurrence: false,
  };
}

export function thoughtTimelineDateCounts(
  timeline: ThoughtTimeline,
): ThoughtTimelineDateCount[] {
  return timeline.groups.map((group) => ({
    date: group.date,
    count: group.items.length,
  }));
}

export function thoughtTimelineSessionCounts(
  timeline: ThoughtTimeline,
): ThoughtTimelineSessionCount[] {
  const counts = new Map<string, number>();
  for (const group of timeline.groups) {
    for (const item of group.items) {
      for (const sessionId of item.sessionIds) {
        counts.set(sessionId, (counts.get(sessionId) ?? 0) + 1);
      }
    }
  }
  return [...counts.entries()]
    .map(([sessionId, observationCount]) => ({ sessionId, observationCount }))
    .sort((left, right) => {
      const byCount = right.observationCount - left.observationCount;
      if (byCount !== 0) {
        return byCount;
      }
      return left.sessionId.localeCompare(right.sessionId);
    });
}

export function formatThoughtTimelineDiagnostic(
  diagnostic: ThoughtTimelineDiagnostic,
  extras?: {
    dateCounts?: ThoughtTimelineDateCount[];
    sessionCounts?: ThoughtTimelineSessionCount[];
  },
) {
  const range =
    diagnostic.range.firstOccurredAt && diagnostic.range.lastOccurredAt
      ? `${diagnostic.range.firstOccurredAt} .. ${diagnostic.range.lastOccurredAt}`
      : "(none)";
  const lines = [
    "THOUGHT_TIMELINE_V0",
    `sourceObservations: ${diagnostic.sourceObservationCount}`,
    `included: ${diagnostic.includedCount}`,
    `skipped: ${diagnostic.skippedObservationCount}`,
    `conceptOccurrences (not timeline items): ${diagnostic.conceptOccurrenceCount}`,
    `observation_concepts: ${diagnostic.hasObservationConceptsRelation ? "present" : "absent"}`,
    "",
    "types:",
    ...REVIEW_OBSERVATION_KINDS.map(
      (kind) => `  ${kind}: ${diagnostic.typeDistribution[kind]}`,
    ),
    "",
    `range: ${range}`,
    `distinctDates: ${diagnostic.distinctDateCount}`,
    `distinctSessions: ${diagnostic.distinctSessionCount}`,
    `datesWithMultipleObservations: ${diagnostic.datesWithMultipleObservations}`,
    `maxObservationsOnOneDate: ${diagnostic.maxObservationsOnOneDate}`,
    `observationsWithMultipleSessions: ${diagnostic.observationsWithMultipleSessions}`,
    `datesWithMultipleSessions: ${diagnostic.datesWithMultipleSessions}`,
    `relatedConcepts>=1: ${diagnostic.relatedConceptCoverage.withRelated} / ${diagnostic.includedCount}`,
    `timelineIncludesConceptOccurrence: ${diagnostic.timelineIncludesConceptOccurrence}`,
    "",
    "skipReasons:",
    ...THOUGHT_TIMELINE_SKIP_REASONS.map(
      (reason) => `  ${reason}: ${diagnostic.skipReasonCounts[reason]}`,
    ),
  ];

  if (extras?.dateCounts) {
    lines.push("", "observations by date:");
    if (extras.dateCounts.length === 0) {
      lines.push("  (none)");
    }
    for (const row of extras.dateCounts) {
      lines.push(`  ${row.date}  ${row.count}`);
    }
  }

  if (extras?.sessionCounts) {
    lines.push("", "observations by session:");
    if (extras.sessionCounts.length === 0) {
      lines.push("  (none)");
    }
    for (const row of extras.sessionCounts) {
      lines.push(`  ${row.sessionId}  ${row.observationCount}`);
    }
  }

  return lines.join("\n");
}
