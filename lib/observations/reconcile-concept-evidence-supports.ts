import {
  buildObservationConceptEvidenceSupports,
  OBSERVATION_CONCEPT_EVIDENCE_RELATION_VERSION,
  toObservationConceptRelationPairs,
  type ObservationConceptEvidenceSupport,
} from "./concept-evidence-supports";
import {
  insertObservationConceptEvidenceSupports,
  listConceptOccurrencesForSessions,
  listObservationConceptEvidenceSupportsForSessions,
  listObservationsForSessions,
  observationConceptSupportIdentitySet,
  type ObservationConceptSupportDb,
} from "@/lib/db/observation-concept-support-queries";

export type ReconcileObservationConceptEvidenceSupportsInput = {
  sessionIds: string[];
};

export type ReconcileObservationConceptEvidenceSupportsResult = {
  status: "reconciled";
  relationVersion: typeof OBSERVATION_CONCEPT_EVIDENCE_RELATION_VERSION;
  sessionsChecked: string[];
  desiredSupportCount: number;
  existingSupportCount: number;
  created: number;
  alreadyPresent: number;
  removed: 0;
  uniqueObservationConceptPairs: number;
};

function supportIdentity(row: ObservationConceptEvidenceSupport) {
  return [
    row.relationVersion,
    row.observationId,
    row.conceptId,
    row.sessionId,
    row.messageId,
    row.evidenceRef,
  ].join("\0");
}

/**
 * Session-scoped additive reconciliation.
 * Inserts missing exact-evidence supports. Does not delete.
 * Observation payload and ConceptOccurrence rows are insert-only in current MVP,
 * so desired-only inserts are the safe durable semantics.
 */
export function reconcileObservationConceptEvidenceSupports(
  input: ReconcileObservationConceptEvidenceSupportsInput,
  deps: {
    db: ObservationConceptSupportDb;
    now?: () => string;
  },
): ReconcileObservationConceptEvidenceSupportsResult {
  const sessionsChecked = [...new Set(input.sessionIds.filter(Boolean))].sort(
    (left, right) => left.localeCompare(right),
  );
  const empty: ReconcileObservationConceptEvidenceSupportsResult = {
    status: "reconciled",
    relationVersion: OBSERVATION_CONCEPT_EVIDENCE_RELATION_VERSION,
    sessionsChecked,
    desiredSupportCount: 0,
    existingSupportCount: 0,
    created: 0,
    alreadyPresent: 0,
    removed: 0,
    uniqueObservationConceptPairs: 0,
  };
  if (sessionsChecked.length === 0) {
    return empty;
  }

  return deps.db.transaction((tx) => {
    const observations = listObservationsForSessions(sessionsChecked, tx);
    const conceptOccurrences = listConceptOccurrencesForSessions(
      sessionsChecked,
      tx,
    );
    const desired = buildObservationConceptEvidenceSupports({
      observations,
      conceptOccurrences,
    }).filter((row) => sessionsChecked.includes(row.sessionId));
    const existing = listObservationConceptEvidenceSupportsForSessions(
      sessionsChecked,
      tx,
    );
    const existingKeys = observationConceptSupportIdentitySet(existing);
    const missing = desired.filter(
      (row) => !existingKeys.has(supportIdentity(row)),
    );
    const createdAt = deps.now?.() ?? new Date().toISOString();
    const created = insertObservationConceptEvidenceSupports(
      missing,
      createdAt,
      tx,
    );
    return {
      status: "reconciled",
      relationVersion: OBSERVATION_CONCEPT_EVIDENCE_RELATION_VERSION,
      sessionsChecked,
      desiredSupportCount: desired.length,
      existingSupportCount: existing.length,
      created,
      alreadyPresent: desired.length - missing.length,
      removed: 0,
      uniqueObservationConceptPairs:
        toObservationConceptRelationPairs(desired).length,
    };
  });
}
