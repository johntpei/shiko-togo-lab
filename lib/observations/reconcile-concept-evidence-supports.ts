import {
  buildObservationConceptEvidenceSupports,
  buildObservationConceptEvidenceSupportsV2,
  OBSERVATION_CONCEPT_EVIDENCE_RELATION_VERSION,
  OBSERVATION_CONCEPT_EVIDENCE_RELATION_VERSION_V1,
  toObservationConceptRelationPairs,
  type BuildObservationConceptEvidenceSupportsV2Result,
  type ObservationConceptEvidenceSupport,
} from "./concept-evidence-supports";
import {
  insertObservationConceptEvidenceSupports,
  loadCanonicalEvidenceResolutionContext,
  listConceptOccurrencesForSessions,
  listObservationConceptEvidenceSupportsForSessions,
  listObservationsForSessions,
  observationConceptSupportIdentitySet,
  type ObservationConceptSupportDb,
  type ObservationConceptSupportExecutor,
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

export type ObservationConceptEvidenceSupportPlan = {
  sessionsChecked: string[];
  desired: ObservationConceptEvidenceSupport[];
  existingCount: number;
  missing: ObservationConceptEvidenceSupport[];
  uniqueObservationConceptPairs: number;
  canonicalPreview: BuildObservationConceptEvidenceSupportsV2Result | null;
};

function normalizeSessionIds(sessionIds: string[]) {
  return [...new Set(sessionIds.filter(Boolean))].sort((left, right) =>
    left.localeCompare(right),
  );
}

/**
 * Read-only desired/current support plan. Does not write.
 * Used by post-commit reconciliation and CLI preview.
 */
export function planObservationConceptEvidenceSupports(
  sessionIds: string[],
  db: ObservationConceptSupportExecutor,
): ObservationConceptEvidenceSupportPlan {
  const sessionsChecked = normalizeSessionIds(sessionIds);
  if (sessionsChecked.length === 0) {
    return {
      sessionsChecked,
      desired: [],
      existingCount: 0,
      missing: [],
      uniqueObservationConceptPairs: 0,
      canonicalPreview: null,
    };
  }
  const observations = listObservationsForSessions(sessionsChecked, db);
  const conceptOccurrences = listConceptOccurrencesForSessions(
    sessionsChecked,
    db,
  );
  const context = loadCanonicalEvidenceResolutionContext(
    {
      reviewIds: observations.map((row) => row.sourceReviewId),
      sessionIds: conceptOccurrences.map((row) => row.sessionId),
    },
    db,
  );
  const canonicalPreview = buildObservationConceptEvidenceSupportsV2({
    observations,
    conceptOccurrences,
    context,
  });
  const desired = canonicalPreview.supports.filter((row) =>
    sessionsChecked.includes(row.sessionId),
  );
  const existing = listObservationConceptEvidenceSupportsForSessions(
    sessionsChecked,
    db,
  );
  const existingKeys = observationConceptSupportIdentitySet(existing);
  const missing = desired.filter(
    (row) => !existingKeys.has(supportIdentity(row)),
  );
  return {
    sessionsChecked,
    desired,
    existingCount: existing.length,
    missing,
    uniqueObservationConceptPairs:
      toObservationConceptRelationPairs(desired).length,
    canonicalPreview,
  };
}

/** Legacy immutable v1 preview. Never used as the current write target. */
export function planObservationConceptEvidenceSupportsV1(
  sessionIds: string[],
  db: ObservationConceptSupportExecutor,
): ObservationConceptEvidenceSupportPlan {
  const sessionsChecked = normalizeSessionIds(sessionIds);
  if (sessionsChecked.length === 0) {
    return {
      sessionsChecked,
      desired: [],
      existingCount: 0,
      missing: [],
      uniqueObservationConceptPairs: 0,
      canonicalPreview: null,
    };
  }
  const observations = listObservationsForSessions(sessionsChecked, db);
  const conceptOccurrences = listConceptOccurrencesForSessions(
    sessionsChecked,
    db,
  );
  const desired = buildObservationConceptEvidenceSupports({
    observations,
    conceptOccurrences,
  }).filter((row) => sessionsChecked.includes(row.sessionId));
  const existing = listObservationConceptEvidenceSupportsForSessions(
    sessionsChecked,
    db,
    OBSERVATION_CONCEPT_EVIDENCE_RELATION_VERSION_V1,
  );
  const existingKeys = observationConceptSupportIdentitySet(existing);
  const missing = desired.filter(
    (row) => !existingKeys.has(supportIdentity(row)),
  );
  return {
    sessionsChecked,
    desired,
    existingCount: existing.length,
    missing,
    uniqueObservationConceptPairs:
      toObservationConceptRelationPairs(desired).length,
    canonicalPreview: null,
  };
}

/**
 * Session-scoped additive reconciliation.
 * Inserts missing exact-evidence supports. Does not delete.
 * Observation payload and ConceptOccurrence rows are insert-only in current MVP,
 * so desired-only inserts are the safe durable semantics.
 *
 * This table is a derived materialization of Observation payload anchors and
 * ConceptOccurrence rows. It is not source of truth.
 */
export function reconcileObservationConceptEvidenceSupports(
  input: ReconcileObservationConceptEvidenceSupportsInput,
  deps: {
    db: ObservationConceptSupportDb;
    now?: () => string;
  },
): ReconcileObservationConceptEvidenceSupportsResult {
  const sessionsChecked = normalizeSessionIds(input.sessionIds);
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
    const plan = planObservationConceptEvidenceSupports(sessionsChecked, tx);
    const createdAt = deps.now?.() ?? new Date().toISOString();
    const created = insertObservationConceptEvidenceSupports(
      plan.missing,
      createdAt,
      tx,
    );
    return {
      status: "reconciled",
      relationVersion: OBSERVATION_CONCEPT_EVIDENCE_RELATION_VERSION,
      sessionsChecked: plan.sessionsChecked,
      desiredSupportCount: plan.desired.length,
      existingSupportCount: plan.existingCount,
      created,
      alreadyPresent: plan.desired.length - plan.missing.length,
      removed: 0,
      uniqueObservationConceptPairs: plan.uniqueObservationConceptPairs,
    };
  });
}
