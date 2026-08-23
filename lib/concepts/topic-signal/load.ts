import type { ConceptQueryDb } from "@/lib/db/concept-queries";
import { conceptOccurrences, concepts } from "@/lib/db/schema";
import { buildTopicSignals, type TopicSignalSet } from "./signals";
import {
  buildTopicSignalSnapshot,
  type TopicSignalSnapshot,
} from "./snapshot";

/**
 * SELECT Concepts + Occurrences, then pure aggregation.
 * Caller injects db. Core does not open a default connection.
 */
export function loadTopicSignalSnapshot(input: {
  db: ConceptQueryDb;
}): TopicSignalSnapshot {
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

  return buildTopicSignalSnapshot({
    concepts: conceptRows,
    occurrences: occurrenceRows,
  });
}

export function loadTopicSignals(input: { db: ConceptQueryDb }): TopicSignalSet {
  return buildTopicSignals(loadTopicSignalSnapshot(input));
}
