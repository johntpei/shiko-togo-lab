import type { ConceptQueryDb } from "@/lib/db/concept-queries";
import { conceptOccurrences, concepts } from "@/lib/db/schema";
import { buildTopicSignals, type TopicSignalSet } from "./signals";
import {
  buildTopicSignalSnapshot,
  type TopicSignalConceptInput,
  type TopicSignalOccurrenceInput,
  type TopicSignalSnapshot,
} from "./snapshot";

export type TopicSignalSource = {
  concepts: TopicSignalConceptInput[];
  occurrences: TopicSignalOccurrenceInput[];
};

/**
 * SELECT Concepts + Occurrences. Caller injects db.
 * Core does not open a default connection.
 */
export function loadTopicSignalSource(input: {
  db: ConceptQueryDb;
}): TopicSignalSource {
  const conceptRows = input.db
    .select({
      conceptId: concepts.id,
      canonicalLabel: concepts.canonicalLabel,
    })
    .from(concepts)
    .all();
  const occurrenceRows = input.db
    .select({
      conceptId: conceptOccurrences.conceptId,
      sessionId: conceptOccurrences.sessionId,
      occurredAt: conceptOccurrences.occurredAt,
    })
    .from(conceptOccurrences)
    .all();
  return {
    concepts: conceptRows,
    occurrences: occurrenceRows,
  };
}

export function loadTopicSignalSnapshot(input: {
  db: ConceptQueryDb;
}): TopicSignalSnapshot {
  return buildTopicSignalSnapshot(loadTopicSignalSource(input));
}

export function loadTopicSignals(input: { db: ConceptQueryDb }): TopicSignalSet {
  return buildTopicSignals(loadTopicSignalSnapshot(input));
}
