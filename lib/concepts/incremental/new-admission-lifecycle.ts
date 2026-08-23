import {
  afterConceptOccurrenceSessionsCommitted,
  type ObservationConceptRelationLifecycleDeps,
  type ObservationConceptRelationLifecycleResult,
} from "@/lib/observations/observation-concept-relation-lifecycle";
import {
  applyIncrementalNewAdmissionManifest,
  type IncrementalNewAdmissionApplyDeps,
  type IncrementalNewAdmissionApplyResult,
} from "./new-admission-apply";
import type { IncrementalNewAdmissionManifest } from "./new-admission-manifest";

export type IncrementalNewAdmissionLifecycleResult = {
  primary: IncrementalNewAdmissionApplyResult;
  relationReconciliation: ObservationConceptRelationLifecycleResult;
};

/**
 * Production Incremental NEW entry: primary apply commits first, then
 * derived Observation↔Concept exact-evidence supports are materialized.
 * Relation failure does not change the primary result.
 */
export function applyIncrementalNewAdmissionManifestThenReconcile(
  manifest: IncrementalNewAdmissionManifest,
  deps: IncrementalNewAdmissionApplyDeps &
    Partial<Pick<ObservationConceptRelationLifecycleDeps, "reconcile" | "now">>,
): IncrementalNewAdmissionLifecycleResult {
  const primary = applyIncrementalNewAdmissionManifest(manifest, deps);
  if (!primary.ok || primary.status !== "applied") {
    return { primary, relationReconciliation: { status: "not_needed" } };
  }
  const sessionIds = manifest.admittedCandidates.map(
    (candidate) => candidate.provenance.sessionId,
  );
  return {
    primary,
    relationReconciliation: afterConceptOccurrenceSessionsCommitted(
      { sessionIds },
      { db: deps.db, reconcile: deps.reconcile, now: deps.now },
    ),
  };
}
