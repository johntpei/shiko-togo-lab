import type {
  TopicSignalSnapshot,
  TopicSignalWindowMetrics,
} from "./snapshot";

export const TOPIC_SIGNAL_VERSION = "topic-signal-v0";

export type TopicSignalVersion = typeof TOPIC_SIGNAL_VERSION;

export const TOPIC_SIGNAL_REASON_RECENT_OCCURRENCE_PRESENT =
  "recent_occurrence_present";

export const TOPIC_SIGNAL_REASON_OBSERVED_IN_MULTIPLE_SESSIONS =
  "observed_in_multiple_sessions";

export type RecentlyObservedSignal = {
  type: "recently_observed";
  conceptId: string;
  canonicalLabel: string;
  lastSeenAt: string;
  recent7d: TopicSignalWindowMetrics;
  reasonCode: typeof TOPIC_SIGNAL_REASON_RECENT_OCCURRENCE_PRESENT;
  reason: {
    recent7dOccurrenceCount: number;
  };
};

export type CrossSessionRecurrenceSignal = {
  type: "cross_session_recurrence";
  conceptId: string;
  canonicalLabel: string;
  totalOccurrenceCount: number;
  distinctSessionCount: number;
  activeDayCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  reasonCode: typeof TOPIC_SIGNAL_REASON_OBSERVED_IN_MULTIPLE_SESSIONS;
  reason: {
    totalOccurrenceCount: number;
    distinctSessionCount: number;
  };
};

export type TopicSignalSet = {
  version: TopicSignalVersion;
  asOf: string | null;
  recentlyObserved: RecentlyObservedSignal[];
  crossSessionRecurrence: CrossSessionRecurrenceSignal[];
};

function compareLastSeenThenId(
  left: { lastSeenAt: string; conceptId: string },
  right: { lastSeenAt: string; conceptId: string },
) {
  const lastSeen = right.lastSeenAt.localeCompare(left.lastSeenAt);
  if (lastSeen !== 0) {
    return lastSeen;
  }
  return left.conceptId.localeCompare(right.conceptId);
}

/**
 * Minimal observational Signals from TopicSignalSnapshot.
 * recently_observed: recent7d.occurrenceCount >= 1
 * cross_session_recurrence: total >= 2 and distinctSessionCount >= 2
 */
export function buildTopicSignals(snapshot: TopicSignalSnapshot): TopicSignalSet {
  const recentlyObserved: RecentlyObservedSignal[] = [];
  const crossSessionRecurrence: CrossSessionRecurrenceSignal[] = [];

  for (const concept of snapshot.concepts) {
    if (concept.recent7d.occurrenceCount >= 1) {
      recentlyObserved.push({
        type: "recently_observed",
        conceptId: concept.conceptId,
        canonicalLabel: concept.canonicalLabel,
        lastSeenAt: concept.lastSeenAt,
        recent7d: {
          occurrenceCount: concept.recent7d.occurrenceCount,
          distinctSessionCount: concept.recent7d.distinctSessionCount,
          activeDayCount: concept.recent7d.activeDayCount,
        },
        reasonCode: TOPIC_SIGNAL_REASON_RECENT_OCCURRENCE_PRESENT,
        reason: {
          recent7dOccurrenceCount: concept.recent7d.occurrenceCount,
        },
      });
    }
    if (
      concept.totalOccurrenceCount >= 2 &&
      concept.distinctSessionCount >= 2
    ) {
      crossSessionRecurrence.push({
        type: "cross_session_recurrence",
        conceptId: concept.conceptId,
        canonicalLabel: concept.canonicalLabel,
        totalOccurrenceCount: concept.totalOccurrenceCount,
        distinctSessionCount: concept.distinctSessionCount,
        activeDayCount: concept.activeDayCount,
        firstSeenAt: concept.firstSeenAt,
        lastSeenAt: concept.lastSeenAt,
        reasonCode: TOPIC_SIGNAL_REASON_OBSERVED_IN_MULTIPLE_SESSIONS,
        reason: {
          totalOccurrenceCount: concept.totalOccurrenceCount,
          distinctSessionCount: concept.distinctSessionCount,
        },
      });
    }
  }

  recentlyObserved.sort(compareLastSeenThenId);
  crossSessionRecurrence.sort(compareLastSeenThenId);

  return {
    version: TOPIC_SIGNAL_VERSION,
    asOf: snapshot.asOf,
    recentlyObserved,
    crossSessionRecurrence,
  };
}
