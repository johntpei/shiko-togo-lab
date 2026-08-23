import { extractObservationEvidenceAnchors } from "@/lib/thought-map/provenance-join-audit";
import { getDb } from "@/lib/db/client";
import { listObservations } from "@/lib/db/observation-queries";
import type { ObservationConceptSupportDb } from "@/lib/db/observation-concept-support-queries";
import {
  reconcileObservationConceptEvidenceSupports,
  type ReconcileObservationConceptEvidenceSupportsResult,
} from "./reconcile-concept-evidence-supports";

export const RELATION_RECONCILIATION_FAILED_CODE =
  "relation_reconciliation_failed";

export type ObservationConceptRelationReconcileFn = (
  input: { sessionIds: string[] },
  deps: { db: ObservationConceptSupportDb; now?: () => string },
) => ReconcileObservationConceptEvidenceSupportsResult;

export type ObservationConceptRelationLifecycleResult =
  | {
      status: "ready";
      sessionsChecked: string[];
      desiredSupportCount: number;
      created: number;
      alreadyPresent: number;
      removed: 0;
      uniqueObservationConceptPairs: number;
    }
  | { status: "not_needed" }
  | {
      status: "failed";
      code: typeof RELATION_RECONCILIATION_FAILED_CODE;
      sessionsChecked: string[];
    };

export type ObservationConceptRelationLifecycleDeps = {
  db: ObservationConceptSupportDb;
  reconcile?: ObservationConceptRelationReconcileFn;
  now?: () => string;
};

/**
 * Unique, non-empty, deterministic session scope.
 * Empty input must not scan the DB.
 */
export function normalizeAffectedSessionIds(
  sessionIds: readonly string[],
): string[] {
  return [...new Set(sessionIds.filter((id) => id.trim() !== ""))].sort(
    (left, right) => left.localeCompare(right),
  );
}

/**
 * Production relation scope uses complete Evidence Unit anchors only:
 * sessionId + messageId + evidenceRef. Incomplete locators are ignored.
 */
export function collectCompleteEvidenceAnchorSessionIds(
  observations: Array<{
    observationId: string;
    kind: string;
    payload: string;
  }>,
): string[] {
  const sessionIds: string[] = [];
  for (const observation of observations) {
    for (const anchor of extractObservationEvidenceAnchors({
      observationId: observation.observationId,
      kind: observation.kind,
      payload: observation.payload,
    })) {
      if (anchor.sessionId && anchor.messageId && anchor.evidenceRef) {
        sessionIds.push(anchor.sessionId);
      }
    }
  }
  return normalizeAffectedSessionIds(sessionIds);
}

/**
 * Post-commit derived materialization of Observation↔Concept exact-evidence
 * supports. Never rolls back the primary write. Call once; do not retry here.
 */
export function runObservationConceptRelationReconciliationAfterCommit(
  input: { sessionIds: readonly string[] },
  deps: ObservationConceptRelationLifecycleDeps,
): ObservationConceptRelationLifecycleResult {
  const sessionIds = normalizeAffectedSessionIds(input.sessionIds);
  if (sessionIds.length === 0) {
    return { status: "not_needed" };
  }
  const reconcile =
    deps.reconcile ?? reconcileObservationConceptEvidenceSupports;
  try {
    const result = reconcile(
      { sessionIds },
      { db: deps.db, now: deps.now },
    );
    return {
      status: "ready",
      sessionsChecked: result.sessionsChecked,
      desiredSupportCount: result.desiredSupportCount,
      created: result.created,
      alreadyPresent: result.alreadyPresent,
      removed: 0,
      uniqueObservationConceptPairs: result.uniqueObservationConceptPairs,
    };
  } catch {
    console.error("observation_concept_relation_reconciliation_failed", {
      code: RELATION_RECONCILIATION_FAILED_CODE,
      sessionIds,
    });
    return {
      status: "failed",
      code: RELATION_RECONCILIATION_FAILED_CODE,
      sessionsChecked: sessionIds,
    };
  }
}

export function afterReviewObservationsCommitted(
  input: { reviewId: string },
  deps: ObservationConceptRelationLifecycleDeps,
): ObservationConceptRelationLifecycleResult {
  const observations = listObservations(
    { sourceReviewId: input.reviewId },
    deps.db,
  );
  const sessionIds = collectCompleteEvidenceAnchorSessionIds(
    observations.map((row) => ({
      observationId: row.id,
      kind: row.kind,
      payload: row.payload,
    })),
  );
  return runObservationConceptRelationReconciliationAfterCommit(
    { sessionIds },
    deps,
  );
}

export function afterConceptOccurrenceSessionsCommitted(
  input: { sessionIds: readonly string[] },
  deps: ObservationConceptRelationLifecycleDeps,
): ObservationConceptRelationLifecycleResult {
  return runObservationConceptRelationReconciliationAfterCommit(input, deps);
}

export function defaultObservationConceptRelationDb(): ObservationConceptSupportDb {
  return getDb();
}
