import {
  calendarDateFromOccurredAt,
  isCalendarDateInInclusiveRange,
  topicSignalWindowDates,
  type TopicSignalWindowDates,
} from "./calendar";

export const TOPIC_SIGNAL_SNAPSHOT_VERSION = "topic-signal-snapshot-v0";

export type TopicSignalSnapshotVersion = typeof TOPIC_SIGNAL_SNAPSHOT_VERSION;

export type TopicSignalWindowMetrics = {
  occurrenceCount: number;
  distinctSessionCount: number;
  activeDayCount: number;
};

export type TopicSignalDailyBucket = {
  date: string;
  occurrenceCount: number;
  distinctSessionCount: number;
};

export type TopicSignalConcept = {
  conceptId: string;
  canonicalLabel: string;
  totalOccurrenceCount: number;
  distinctSessionCount: number;
  activeDayCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  daily: TopicSignalDailyBucket[];
  recent7d: TopicSignalWindowMetrics;
  previous7d: TopicSignalWindowMetrics;
};

export type TopicSignalSnapshotDiagnostics = {
  conceptsWithoutOccurrences: number;
  totalOccurrenceCount: number;
  totalDistinctSessionCount: number;
  activeDateRange: {
    start: string | null;
    end: string | null;
  };
};

export type TopicSignalSnapshot = {
  version: TopicSignalSnapshotVersion;
  asOf: string | null;
  concepts: TopicSignalConcept[];
  diagnostics: TopicSignalSnapshotDiagnostics;
};

export type TopicSignalConceptInput = {
  conceptId: string;
  canonicalLabel: string;
};

export type TopicSignalOccurrenceInput = {
  conceptId: string;
  sessionId: string;
  occurredAt: string;
};

function emptyDiagnostics(
  conceptsWithoutOccurrences: number,
): TopicSignalSnapshotDiagnostics {
  return {
    conceptsWithoutOccurrences,
    totalOccurrenceCount: 0,
    totalDistinctSessionCount: 0,
    activeDateRange: { start: null, end: null },
  };
}

function maxOccurredAt(values: string[]) {
  let max = values[0]!;
  for (const value of values) {
    if (value.localeCompare(max) > 0) {
      max = value;
    }
  }
  return max;
}

function minOccurredAt(values: string[]) {
  let min = values[0]!;
  for (const value of values) {
    if (value.localeCompare(min) < 0) {
      min = value;
    }
  }
  return min;
}

function windowMetrics(
  occurrences: TopicSignalOccurrenceInput[],
  start: string,
  end: string,
): TopicSignalWindowMetrics {
  const sessionIds = new Set<string>();
  const dates = new Set<string>();
  let occurrenceCount = 0;
  for (const occurrence of occurrences) {
    const date = calendarDateFromOccurredAt(occurrence.occurredAt);
    if (!date || !isCalendarDateInInclusiveRange(date, start, end)) {
      continue;
    }
    occurrenceCount += 1;
    sessionIds.add(occurrence.sessionId);
    dates.add(date);
  }
  return {
    occurrenceCount,
    distinctSessionCount: sessionIds.size,
    activeDayCount: dates.size,
  };
}

function dailyBuckets(
  occurrences: TopicSignalOccurrenceInput[],
): TopicSignalDailyBucket[] {
  const byDate = new Map<
    string,
    { occurrenceCount: number; sessionIds: Set<string> }
  >();
  for (const occurrence of occurrences) {
    const date = calendarDateFromOccurredAt(occurrence.occurredAt);
    if (!date) {
      continue;
    }
    const bucket = byDate.get(date) ?? {
      occurrenceCount: 0,
      sessionIds: new Set<string>(),
    };
    bucket.occurrenceCount += 1;
    bucket.sessionIds.add(occurrence.sessionId);
    byDate.set(date, bucket);
  }
  return [...byDate.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, bucket]) => ({
      date,
      occurrenceCount: bucket.occurrenceCount,
      distinctSessionCount: bucket.sessionIds.size,
    }));
}

function aggregateConcept(
  concept: TopicSignalConceptInput,
  occurrences: TopicSignalOccurrenceInput[],
  windows: TopicSignalWindowDates,
): TopicSignalConcept {
  const occurredAts = occurrences.map((item) => item.occurredAt);
  const sessionIds = new Set(occurrences.map((item) => item.sessionId));
  const daily = dailyBuckets(occurrences);
  return {
    conceptId: concept.conceptId,
    canonicalLabel: concept.canonicalLabel,
    totalOccurrenceCount: occurrences.length,
    distinctSessionCount: sessionIds.size,
    activeDayCount: daily.length,
    firstSeenAt: minOccurredAt(occurredAts),
    lastSeenAt: maxOccurredAt(occurredAts),
    daily,
    recent7d: windowMetrics(
      occurrences,
      windows.recentStart,
      windows.recentEnd,
    ),
    previous7d: windowMetrics(
      occurrences,
      windows.previousStart,
      windows.previousEnd,
    ),
  };
}

function compareConcepts(left: TopicSignalConcept, right: TopicSignalConcept) {
  const lastSeen = right.lastSeenAt.localeCompare(left.lastSeenAt);
  if (lastSeen !== 0) {
    return lastSeen;
  }
  return left.conceptId.localeCompare(right.conceptId);
}

/**
 * Deterministic Topic Signal read model from Registry Concepts + Occurrences.
 * Raw window counts only. No classification and no score.
 */
export function buildTopicSignalSnapshot(input: {
  concepts: readonly TopicSignalConceptInput[];
  occurrences: readonly TopicSignalOccurrenceInput[];
}): TopicSignalSnapshot {
  const conceptById = new Map<string, TopicSignalConceptInput>();
  for (const concept of input.concepts) {
    conceptById.set(concept.conceptId, concept);
  }

  const occurrencesByConcept = new Map<string, TopicSignalOccurrenceInput[]>();
  for (const occurrence of input.occurrences) {
    if (!conceptById.has(occurrence.conceptId)) {
      continue;
    }
    if (!calendarDateFromOccurredAt(occurrence.occurredAt)) {
      continue;
    }
    const list = occurrencesByConcept.get(occurrence.conceptId) ?? [];
    list.push(occurrence);
    occurrencesByConcept.set(occurrence.conceptId, list);
  }

  let conceptsWithoutOccurrences = 0;
  for (const concept of conceptById.values()) {
    if (!occurrencesByConcept.has(concept.conceptId)) {
      conceptsWithoutOccurrences += 1;
    }
  }

  const included = [...occurrencesByConcept.values()].flat();
  if (included.length === 0) {
    return {
      version: TOPIC_SIGNAL_SNAPSHOT_VERSION,
      asOf: null,
      concepts: [],
      diagnostics: emptyDiagnostics(conceptsWithoutOccurrences),
    };
  }

  const asOf = maxOccurredAt(included.map((item) => item.occurredAt));
  const asOfDate = calendarDateFromOccurredAt(asOf);
  if (!asOfDate) {
    return {
      version: TOPIC_SIGNAL_SNAPSHOT_VERSION,
      asOf: null,
      concepts: [],
      diagnostics: emptyDiagnostics(conceptsWithoutOccurrences),
    };
  }

  const windows = topicSignalWindowDates(asOfDate);
  const concepts: TopicSignalConcept[] = [];
  for (const [conceptId, occurrences] of occurrencesByConcept) {
    const concept = conceptById.get(conceptId);
    if (!concept) {
      continue;
    }
    concepts.push(aggregateConcept(concept, occurrences, windows));
  }
  concepts.sort(compareConcepts);

  const sessionIds = new Set(included.map((item) => item.sessionId));
  const dates = included
    .map((item) => calendarDateFromOccurredAt(item.occurredAt))
    .filter((date): date is string => date !== null)
    .sort((left, right) => left.localeCompare(right));

  return {
    version: TOPIC_SIGNAL_SNAPSHOT_VERSION,
    asOf,
    concepts,
    diagnostics: {
      conceptsWithoutOccurrences,
      totalOccurrenceCount: included.length,
      totalDistinctSessionCount: sessionIds.size,
      activeDateRange: {
        start: dates[0] ?? null,
        end: dates[dates.length - 1] ?? null,
      },
    },
  };
}
