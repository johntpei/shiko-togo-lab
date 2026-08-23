import type { ConceptQueryDb } from "@/lib/db/concept-queries";
import {
  conceptOccurrences,
  concepts,
  observationSessions,
  observations,
  sessions,
} from "@/lib/db/schema";
import {
  buildThoughtMapSourceAudit,
  type ThoughtMapSourceAudit,
} from "./source-audit";

/**
 * SELECT identity/join rows only. Caller injects db. No writes.
 * Payload is loaded only to inspect field names; values are not copied
 * into the diagnostic. Message / Evidence / transcript text is not loaded.
 */
export function loadThoughtMapSourceAudit(input: {
  db: ConceptQueryDb;
}): ThoughtMapSourceAudit {
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
  const sessionRows = input.db
    .select({ sessionId: sessions.id })
    .from(sessions)
    .all();
  const conceptSessionLinks = input.db
    .select({
      conceptId: conceptOccurrences.conceptId,
      sessionId: conceptOccurrences.sessionId,
    })
    .from(conceptOccurrences)
    .all();
  const observationSessionLinks = input.db
    .select({
      observationId: observationSessions.observationId,
      sessionId: observationSessions.sessionId,
    })
    .from(observationSessions)
    .all();

  return buildThoughtMapSourceAudit({
    concepts: conceptRows,
    observations: observationRows,
    sessions: sessionRows,
    conceptSessionLinks,
    observationSessionLinks,
  });
}
