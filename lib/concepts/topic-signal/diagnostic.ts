import {
  addCalendarDays,
  calendarDateFromOccurredAt,
  calendarDayDistance,
  isCalendarDateInInclusiveRange,
} from "./calendar";
import type {
  TopicSignalConcept,
  TopicSignalDailyBucket,
  TopicSignalSnapshot,
  TopicSignalWindowMetrics,
} from "./snapshot";

export const TOPIC_SIGNAL_DIAGNOSTIC_VERSION = "topic-signal-diagnostic-v0";

export type TopicSignalDiagnosticVersion =
  typeof TOPIC_SIGNAL_DIAGNOSTIC_VERSION;

export type TopicSignalDiagnosticWindowMetrics = {
  occurrenceCount: number;
  distinctSessionCount: number;
  activeDayCount: number;
};

export type TopicSignalDiagnosticConcept = {
  conceptId: string;
  canonicalLabel: string;
  totalOccurrenceCount: number;
  distinctSessionCount: number;
  activeDayCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  daysSinceLastSeen: number;
  observedSpanDays: number;
  last14d: TopicSignalDiagnosticWindowMetrics;
  last30d: TopicSignalDiagnosticWindowMetrics;
  recent7dOccurrenceCount: number;
  previous7dOccurrenceCount: number;
  recent7dOccurrenceDelta: number;
  occurrenceGapDays: number[];
  minGapDays: number | null;
  maxGapDays: number | null;
};

export type TopicSignalMultipleOccurrenceRow = {
  conceptId: string;
  canonicalLabel: string;
  totalOccurrenceCount: number;
  distinctSessionCount: number;
  activeDayCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  occurrenceGapDays: number[];
  minGapDays: number | null;
  maxGapDays: number | null;
};

export type TopicSignalWindowSparsity = {
  conceptTotal: number;
  withOccurrence: number;
  withoutOccurrence: number;
};

export type TopicSignalRecentPreviousPairCounts = {
  recentPositivePreviousZero: number;
  recentZeroPreviousPositive: number;
  bothPositive: number;
  bothZero: number;
};

/**
 * Distribution buckets for reading sparsity only.
 * Not a Product threshold and not a Signal class.
 */
export type TopicSignalDaysSinceLastSeenDiagnosticBuckets = {
  from0to6: number;
  from7to13: number;
  from14to29: number;
  from30orMore: number;
};

export type TopicSignalDiagnosticSummary = {
  conceptCount: number;
  occurrenceCountDistribution: {
    one: number;
    two: number;
    threeOrMore: number;
  };
  distinctSessionDistribution: {
    oneSession: number;
    twoOrMoreSessions: number;
  };
  conceptsWithMultipleOccurrences: TopicSignalMultipleOccurrenceRow[];
  conceptsObservedInMultipleSessions: TopicSignalMultipleOccurrenceRow[];
  conceptsWithSameSessionMultipleOccurrences: TopicSignalMultipleOccurrenceRow[];
  conceptsWithOccurrence7d: number;
  conceptsWithOccurrence14d: number;
  conceptsWithOccurrence30d: number;
  windowSparsity7d: TopicSignalWindowSparsity;
  windowSparsity14d: TopicSignalWindowSparsity;
  windowSparsity30d: TopicSignalWindowSparsity;
  recentPreviousPairCounts: TopicSignalRecentPreviousPairCounts;
  daysSinceLastSeenValues: number[];
  daysSinceLastSeenDiagnosticBuckets: TopicSignalDaysSinceLastSeenDiagnosticBuckets;
};

export type TopicSignalDiagnosticReport = {
  version: TopicSignalDiagnosticVersion;
  asOf: string | null;
  summary: TopicSignalDiagnosticSummary;
  concepts: TopicSignalDiagnosticConcept[];
};

const EMPTY_WINDOW: TopicSignalDiagnosticWindowMetrics = {
  occurrenceCount: 0,
  distinctSessionCount: 0,
  activeDayCount: 0,
};

function emptyPairCounts(): TopicSignalRecentPreviousPairCounts {
  return {
    recentPositivePreviousZero: 0,
    recentZeroPreviousPositive: 0,
    bothPositive: 0,
    bothZero: 0,
  };
}

function emptyBuckets(): TopicSignalDaysSinceLastSeenDiagnosticBuckets {
  return {
    from0to6: 0,
    from7to13: 0,
    from14to29: 0,
    from30orMore: 0,
  };
}

function emptySparsity(conceptTotal: number): TopicSignalWindowSparsity {
  return {
    conceptTotal,
    withOccurrence: 0,
    withoutOccurrence: conceptTotal,
  };
}

function emptySummary(): TopicSignalDiagnosticSummary {
  return {
    conceptCount: 0,
    occurrenceCountDistribution: { one: 0, two: 0, threeOrMore: 0 },
    distinctSessionDistribution: { oneSession: 0, twoOrMoreSessions: 0 },
    conceptsWithMultipleOccurrences: [],
    conceptsObservedInMultipleSessions: [],
    conceptsWithSameSessionMultipleOccurrences: [],
    conceptsWithOccurrence7d: 0,
    conceptsWithOccurrence14d: 0,
    conceptsWithOccurrence30d: 0,
    windowSparsity7d: emptySparsity(0),
    windowSparsity14d: emptySparsity(0),
    windowSparsity30d: emptySparsity(0),
    recentPreviousPairCounts: emptyPairCounts(),
    daysSinceLastSeenValues: [],
    daysSinceLastSeenDiagnosticBuckets: emptyBuckets(),
  };
}

function windowFromDaily(
  daily: TopicSignalDailyBucket[],
  start: string,
  end: string,
): TopicSignalDiagnosticWindowMetrics {
  let occurrenceCount = 0;
  let distinctSessionCount = 0;
  let activeDayCount = 0;
  for (const bucket of daily) {
    if (!isCalendarDateInInclusiveRange(bucket.date, start, end)) {
      continue;
    }
    occurrenceCount += bucket.occurrenceCount;
    distinctSessionCount += bucket.distinctSessionCount;
    activeDayCount += 1;
  }
  return { occurrenceCount, distinctSessionCount, activeDayCount };
}

function occurrenceCalendarDates(daily: TopicSignalDailyBucket[]) {
  const dates: string[] = [];
  for (const bucket of daily) {
    for (let i = 0; i < bucket.occurrenceCount; i += 1) {
      dates.push(bucket.date);
    }
  }
  return dates;
}

function occurrenceGaps(daily: TopicSignalDailyBucket[]) {
  const dates = occurrenceCalendarDates(daily);
  if (dates.length < 2) {
    return { occurrenceGapDays: [] as number[], minGapDays: null, maxGapDays: null };
  }
  const occurrenceGapDays: number[] = [];
  for (let i = 1; i < dates.length; i += 1) {
    occurrenceGapDays.push(calendarDayDistance(dates[i - 1]!, dates[i]!));
  }
  return {
    occurrenceGapDays,
    minGapDays: Math.min(...occurrenceGapDays),
    maxGapDays: Math.max(...occurrenceGapDays),
  };
}

function multipleOccurrenceRow(
  concept: TopicSignalDiagnosticConcept,
): TopicSignalMultipleOccurrenceRow {
  return {
    conceptId: concept.conceptId,
    canonicalLabel: concept.canonicalLabel,
    totalOccurrenceCount: concept.totalOccurrenceCount,
    distinctSessionCount: concept.distinctSessionCount,
    activeDayCount: concept.activeDayCount,
    firstSeenAt: concept.firstSeenAt,
    lastSeenAt: concept.lastSeenAt,
    occurrenceGapDays: concept.occurrenceGapDays,
    minGapDays: concept.minGapDays,
    maxGapDays: concept.maxGapDays,
  };
}

function diagnosticBucket(daysSinceLastSeen: number) {
  if (daysSinceLastSeen <= 6) {
    return "from0to6" as const;
  }
  if (daysSinceLastSeen <= 13) {
    return "from7to13" as const;
  }
  if (daysSinceLastSeen <= 29) {
    return "from14to29" as const;
  }
  return "from30orMore" as const;
}

function sparsity(
  conceptTotal: number,
  withOccurrence: number,
): TopicSignalWindowSparsity {
  return {
    conceptTotal,
    withOccurrence,
    withoutOccurrence: conceptTotal - withOccurrence,
  };
}

function windowMetricsOrEmpty(
  metrics: TopicSignalWindowMetrics | undefined,
): TopicSignalWindowMetrics {
  return metrics ?? EMPTY_WINDOW;
}

/**
 * Development diagnostic over TopicSignalSnapshot.
 * Not a UI contract. Does not classify or score.
 */
export function buildTopicSignalDiagnostic(
  snapshot: TopicSignalSnapshot,
): TopicSignalDiagnosticReport {
  const asOfDate = snapshot.asOf
    ? calendarDateFromOccurredAt(snapshot.asOf)
    : null;
  if (!asOfDate || snapshot.concepts.length === 0) {
    return {
      version: TOPIC_SIGNAL_DIAGNOSTIC_VERSION,
      asOf: snapshot.asOf,
      summary: emptySummary(),
      concepts: [],
    };
  }

  const last14dStart = addCalendarDays(asOfDate, -13);
  const last30dStart = addCalendarDays(asOfDate, -29);
  const pairCounts = emptyPairCounts();
  const buckets = emptyBuckets();
  const occurrenceCountDistribution = { one: 0, two: 0, threeOrMore: 0 };
  const distinctSessionDistribution = { oneSession: 0, twoOrMoreSessions: 0 };
  const daysSinceLastSeenValues: number[] = [];
  const concepts: TopicSignalDiagnosticConcept[] = [];

  for (const concept of snapshot.concepts) {
    const lastSeenDate = calendarDateFromOccurredAt(concept.lastSeenAt);
    const firstSeenDate = calendarDateFromOccurredAt(concept.firstSeenAt);
    if (!lastSeenDate || !firstSeenDate) {
      continue;
    }
    const gaps = occurrenceGaps(concept.daily);
    const last14d = windowFromDaily(concept.daily, last14dStart, asOfDate);
    const last30d = windowFromDaily(concept.daily, last30dStart, asOfDate);
    const recent7d = windowMetricsOrEmpty(concept.recent7d);
    const previous7d = windowMetricsOrEmpty(concept.previous7d);
    const row: TopicSignalDiagnosticConcept = {
      conceptId: concept.conceptId,
      canonicalLabel: concept.canonicalLabel,
      totalOccurrenceCount: concept.totalOccurrenceCount,
      distinctSessionCount: concept.distinctSessionCount,
      activeDayCount: concept.activeDayCount,
      firstSeenAt: concept.firstSeenAt,
      lastSeenAt: concept.lastSeenAt,
      daysSinceLastSeen: calendarDayDistance(lastSeenDate, asOfDate),
      observedSpanDays: calendarDayDistance(firstSeenDate, lastSeenDate),
      last14d,
      last30d,
      recent7dOccurrenceCount: recent7d.occurrenceCount,
      previous7dOccurrenceCount: previous7d.occurrenceCount,
      recent7dOccurrenceDelta:
        recent7d.occurrenceCount - previous7d.occurrenceCount,
      occurrenceGapDays: gaps.occurrenceGapDays,
      minGapDays: gaps.minGapDays,
      maxGapDays: gaps.maxGapDays,
    };
    concepts.push(row);
    daysSinceLastSeenValues.push(row.daysSinceLastSeen);
    buckets[diagnosticBucket(row.daysSinceLastSeen)] += 1;

    if (row.totalOccurrenceCount === 1) {
      occurrenceCountDistribution.one += 1;
    } else if (row.totalOccurrenceCount === 2) {
      occurrenceCountDistribution.two += 1;
    } else if (row.totalOccurrenceCount >= 3) {
      occurrenceCountDistribution.threeOrMore += 1;
    }

    if (row.distinctSessionCount <= 1) {
      distinctSessionDistribution.oneSession += 1;
    } else {
      distinctSessionDistribution.twoOrMoreSessions += 1;
    }

    if (row.recent7dOccurrenceCount > 0 && row.previous7dOccurrenceCount === 0) {
      pairCounts.recentPositivePreviousZero += 1;
    } else if (
      row.recent7dOccurrenceCount === 0 &&
      row.previous7dOccurrenceCount > 0
    ) {
      pairCounts.recentZeroPreviousPositive += 1;
    } else if (
      row.recent7dOccurrenceCount > 0 &&
      row.previous7dOccurrenceCount > 0
    ) {
      pairCounts.bothPositive += 1;
    } else {
      pairCounts.bothZero += 1;
    }
  }

  const conceptsWithOccurrence7d = concepts.filter(
    (row) => row.recent7dOccurrenceCount > 0,
  ).length;
  const conceptsWithOccurrence14d = concepts.filter(
    (row) => row.last14d.occurrenceCount > 0,
  ).length;
  const conceptsWithOccurrence30d = concepts.filter(
    (row) => row.last30d.occurrenceCount > 0,
  ).length;
  const conceptTotal = concepts.length;

  return {
    version: TOPIC_SIGNAL_DIAGNOSTIC_VERSION,
    asOf: snapshot.asOf,
    summary: {
      conceptCount: conceptTotal,
      occurrenceCountDistribution,
      distinctSessionDistribution,
      conceptsWithMultipleOccurrences: concepts
        .filter((row) => row.totalOccurrenceCount >= 2)
        .map(multipleOccurrenceRow),
      conceptsObservedInMultipleSessions: concepts
        .filter(
          (row) =>
            row.totalOccurrenceCount >= 2 && row.distinctSessionCount >= 2,
        )
        .map(multipleOccurrenceRow),
      conceptsWithSameSessionMultipleOccurrences: concepts
        .filter(
          (row) =>
            row.totalOccurrenceCount >= 2 && row.distinctSessionCount === 1,
        )
        .map(multipleOccurrenceRow),
      conceptsWithOccurrence7d,
      conceptsWithOccurrence14d,
      conceptsWithOccurrence30d,
      windowSparsity7d: sparsity(conceptTotal, conceptsWithOccurrence7d),
      windowSparsity14d: sparsity(conceptTotal, conceptsWithOccurrence14d),
      windowSparsity30d: sparsity(conceptTotal, conceptsWithOccurrence30d),
      recentPreviousPairCounts: pairCounts,
      daysSinceLastSeenValues: [...daysSinceLastSeenValues].sort(
        (left, right) => left - right,
      ),
      daysSinceLastSeenDiagnosticBuckets: buckets,
    },
    concepts,
  };
}
