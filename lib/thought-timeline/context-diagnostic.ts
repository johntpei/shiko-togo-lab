import { calendarDateFromOccurredAt } from "@/lib/concepts/topic-signal/calendar";
import type {
  TopicSignalOccurrenceInput,
  TopicSignalSnapshot,
} from "@/lib/concepts/topic-signal/snapshot";
import type { ReviewObservationKind } from "@/lib/observations/types";
import { REVIEW_OBSERVATION_KINDS } from "@/lib/observations/types";
import type { ThoughtTimeline } from "./types";

export const THOUGHT_TIMELINE_CONTEXT_DIAGNOSTIC_VERSION =
  "thought-timeline-context-diagnostic-v0";

export type ThoughtTimelineContextPresence =
  | "observation_only"
  | "concept_only"
  | "both";

export type ThoughtTimelineContextObservationTypes = Record<
  ReviewObservationKind,
  number
>;

export type ThoughtTimelineContextConceptRow = {
  conceptId: string;
  canonicalLabel: string;
  occurrenceCount: number;
};

export type ThoughtTimelineContextDateDiagnostic = {
  date: string;
  presence: ThoughtTimelineContextPresence;
  observationCount: number;
  observationTypes: ThoughtTimelineContextObservationTypes;
  conceptOccurrenceCount: number;
  distinctConceptCount: number;
  distinctSessionCount: number;
  concepts: ThoughtTimelineContextConceptRow[];
};

export type ThoughtTimelineContextCoverage = {
  observationDateCount: number;
  conceptOccurrenceDateCount: number;
  unionDateCount: number;
  datesWithObservationOnly: number;
  datesWithConceptOnly: number;
  datesWithBoth: number;
};

export type ThoughtTimelineContextDensity = {
  min: number;
  max: number;
  average: number | null;
};

export type ThoughtTimelineContextDiagnostic = {
  version: typeof THOUGHT_TIMELINE_CONTEXT_DIAGNOSTIC_VERSION;
  range: {
    firstOccurredAt: string | null;
    lastOccurredAt: string | null;
  };
  coverage: ThoughtTimelineContextCoverage;
  conceptDensityPerDate: ThoughtTimelineContextDensity;
  occurrenceDensityPerDate: ThoughtTimelineContextDensity;
  sessionDensityPerDate: ThoughtTimelineContextDensity;
  dates: ThoughtTimelineContextDateDiagnostic[];
};

function emptyTypes(): ThoughtTimelineContextObservationTypes {
  return { shift: 0, connection: 0, tension: 0 };
}

function density(values: number[]): ThoughtTimelineContextDensity {
  if (values.length === 0) {
    return { min: 0, max: 0, average: null };
  }
  const sum = values.reduce((total, value) => total + value, 0);
  return {
    min: Math.min(...values),
    max: Math.max(...values),
    average: sum / values.length,
  };
}

function compareConceptRows(
  left: ThoughtTimelineContextConceptRow,
  right: ThoughtTimelineContextConceptRow,
) {
  const byCount = right.occurrenceCount - left.occurrenceCount;
  if (byCount !== 0) {
    return byCount;
  }
  const byLabel = left.canonicalLabel.localeCompare(right.canonicalLabel);
  if (byLabel !== 0) {
    return byLabel;
  }
  return left.conceptId.localeCompare(right.conceptId);
}

function presenceOf(observationCount: number, conceptOccurrenceCount: number) {
  if (observationCount > 0 && conceptOccurrenceCount > 0) {
    return "both" as const;
  }
  if (observationCount > 0) {
    return "observation_only" as const;
  }
  return "concept_only" as const;
}

/**
 * Development-only date context overlay.
 * Does not mutate ThoughtTimeline or classify Topic Signals.
 * Date overlap is not an Observation↔Concept relation.
 */
export function buildThoughtTimelineContextDiagnostic(input: {
  timeline: ThoughtTimeline;
  snapshot: TopicSignalSnapshot;
  occurrences: readonly TopicSignalOccurrenceInput[];
}): ThoughtTimelineContextDiagnostic {
  const labelByConceptId = new Map(
    input.snapshot.concepts.map((concept) => [
      concept.conceptId,
      concept.canonicalLabel,
    ]),
  );

  const observationByDate = new Map<
    string,
    { count: number; types: ThoughtTimelineContextObservationTypes }
  >();
  const occurredAts: string[] = [];

  for (const group of input.timeline.groups) {
    const types = emptyTypes();
    for (const item of group.items) {
      types[item.observationType] += 1;
      occurredAts.push(item.occurredAt);
    }
    observationByDate.set(group.date, {
      count: group.items.length,
      types,
    });
  }

  type ConceptDateBucket = {
    occurrenceCount: number;
    sessions: Set<string>;
    concepts: Map<string, ThoughtTimelineContextConceptRow>;
  };
  const conceptByDate = new Map<string, ConceptDateBucket>();

  for (const occurrence of input.occurrences) {
    const date = calendarDateFromOccurredAt(occurrence.occurredAt);
    const label = labelByConceptId.get(occurrence.conceptId);
    if (!date || !label) {
      continue;
    }
    occurredAts.push(occurrence.occurredAt);
    const bucket = conceptByDate.get(date) ?? {
      occurrenceCount: 0,
      sessions: new Set<string>(),
      concepts: new Map(),
    };
    bucket.occurrenceCount += 1;
    bucket.sessions.add(occurrence.sessionId);
    const row = bucket.concepts.get(occurrence.conceptId) ?? {
      conceptId: occurrence.conceptId,
      canonicalLabel: label,
      occurrenceCount: 0,
    };
    row.occurrenceCount += 1;
    bucket.concepts.set(occurrence.conceptId, row);
    conceptByDate.set(date, bucket);
  }

  const unionDates = [
    ...new Set([...observationByDate.keys(), ...conceptByDate.keys()]),
  ].sort((left, right) => right.localeCompare(left));

  const dates: ThoughtTimelineContextDateDiagnostic[] = unionDates.map(
    (date) => {
      const observations = observationByDate.get(date);
      const concepts = conceptByDate.get(date);
      const observationCount = observations?.count ?? 0;
      const conceptOccurrenceCount = concepts?.occurrenceCount ?? 0;
      const conceptRows = concepts
        ? [...concepts.concepts.values()].sort(compareConceptRows)
        : [];
      return {
        date,
        presence: presenceOf(observationCount, conceptOccurrenceCount),
        observationCount,
        observationTypes: observations?.types ?? emptyTypes(),
        conceptOccurrenceCount,
        distinctConceptCount: conceptRows.length,
        distinctSessionCount: concepts?.sessions.size ?? 0,
        concepts: conceptRows,
      };
    },
  );

  const conceptActive = dates.filter((row) => row.conceptOccurrenceCount > 0);
  const sortedOccurred = [...occurredAts].sort((left, right) =>
    left.localeCompare(right),
  );

  return {
    version: THOUGHT_TIMELINE_CONTEXT_DIAGNOSTIC_VERSION,
    range: {
      firstOccurredAt: sortedOccurred[0] ?? null,
      lastOccurredAt: sortedOccurred[sortedOccurred.length - 1] ?? null,
    },
    coverage: {
      observationDateCount: observationByDate.size,
      conceptOccurrenceDateCount: conceptByDate.size,
      unionDateCount: dates.length,
      datesWithObservationOnly: dates.filter(
        (row) => row.presence === "observation_only",
      ).length,
      datesWithConceptOnly: dates.filter(
        (row) => row.presence === "concept_only",
      ).length,
      datesWithBoth: dates.filter((row) => row.presence === "both").length,
    },
    conceptDensityPerDate: density(
      conceptActive.map((row) => row.distinctConceptCount),
    ),
    occurrenceDensityPerDate: density(
      conceptActive.map((row) => row.conceptOccurrenceCount),
    ),
    sessionDensityPerDate: density(
      conceptActive.map((row) => row.distinctSessionCount),
    ),
    dates,
  };
}

function formatAverage(value: number | null) {
  if (value === null) {
    return "n/a";
  }
  return (Math.round(value * 100) / 100).toFixed(2);
}

function formatDensity(label: string, value: ThoughtTimelineContextDensity) {
  return `${label}: min=${value.min} max=${value.max} avg=${formatAverage(value.average)}`;
}

export function formatThoughtTimelineContextDiagnostic(
  diagnostic: ThoughtTimelineContextDiagnostic,
) {
  const range =
    diagnostic.range.firstOccurredAt && diagnostic.range.lastOccurredAt
      ? `${diagnostic.range.firstOccurredAt} .. ${diagnostic.range.lastOccurredAt}`
      : "(none)";
  const lines = [
    "THOUGHT_TIMELINE_CONTEXT_DIAGNOSTIC_V0",
    `range: ${range}`,
    `observationDates: ${diagnostic.coverage.observationDateCount}`,
    `conceptOccurrenceDates: ${diagnostic.coverage.conceptOccurrenceDateCount}`,
    `unionDates: ${diagnostic.coverage.unionDateCount}`,
    `observationOnly: ${diagnostic.coverage.datesWithObservationOnly}`,
    `conceptOnly: ${diagnostic.coverage.datesWithConceptOnly}`,
    `both: ${diagnostic.coverage.datesWithBoth}`,
    formatDensity("conceptsPerConceptDate", diagnostic.conceptDensityPerDate),
    formatDensity(
      "occurrencesPerConceptDate",
      diagnostic.occurrenceDensityPerDate,
    ),
    formatDensity("sessionsPerConceptDate", diagnostic.sessionDensityPerDate),
    "",
    "dates:",
  ];

  if (diagnostic.dates.length === 0) {
    lines.push("  (none)");
  }

  for (const row of diagnostic.dates) {
    const types = REVIEW_OBSERVATION_KINDS.map(
      (kind) => `${kind}=${row.observationTypes[kind]}`,
    ).join(" ");
    lines.push(
      `  ${row.date}  ${row.presence}  observations=${row.observationCount} (${types})  conceptOccurrences=${row.conceptOccurrenceCount}  concepts=${row.distinctConceptCount}  sessions=${row.distinctSessionCount}`,
    );
    if (row.concepts.length === 0) {
      lines.push("    concepts: (none)");
      continue;
    }
    for (const concept of row.concepts) {
      lines.push(
        `    ${concept.canonicalLabel}  occurrences=${concept.occurrenceCount}`,
      );
    }
  }

  return lines.join("\n");
}
