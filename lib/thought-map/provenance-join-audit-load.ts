import type { ConceptQueryDb } from "@/lib/db/concept-queries";
import {
  conceptOccurrences,
  concepts,
  observations,
} from "@/lib/db/schema";
import {
  buildThoughtMapProvenanceJoinAudit,
  type ThoughtMapProvenanceJoinAudit,
} from "./provenance-join-audit";

/**
 * SELECT identity / payload rows only. Caller injects db. No writes.
 * Payload is parsed for locator fields; quote / text is not copied
 * into the diagnostic. Message / transcript text is not loaded.
 */
export function loadThoughtMapProvenanceJoinAudit(input: {
  db: ConceptQueryDb;
}): ThoughtMapProvenanceJoinAudit {
  const conceptRows = input.db
    .select({ conceptId: concepts.id })
    .from(concepts)
    .all();
  const observationRows = input.db
    .select({
      observationId: observations.id,
      kind: observations.kind,
      payload: observations.payload,
    })
    .from(observations)
    .all();
  const occurrenceRows = input.db
    .select({
      conceptId: conceptOccurrences.conceptId,
      sessionId: conceptOccurrences.sessionId,
      messageId: conceptOccurrences.messageId,
      evidenceRef: conceptOccurrences.evidenceRef,
    })
    .from(conceptOccurrences)
    .all();

  return buildThoughtMapProvenanceJoinAudit({
    concepts: conceptRows,
    observations: observationRows,
    conceptOccurrences: occurrenceRows,
  });
}
