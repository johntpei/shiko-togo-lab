import {
  afterConceptOccurrenceSessionsCommitted,
  type ObservationConceptRelationLifecycleDeps,
  type ObservationConceptRelationLifecycleResult,
} from "@/lib/observations/observation-concept-relation-lifecycle";
import {
  applyExistingMatchOccurrences,
  type ApplyExistingMatchOccurrencesDeps,
  type ExistingMatchOccurrenceApplyResult,
} from "./append";
import type { ExistingMatchPlan } from "./plan";

export type ExistingMatchOccurrenceLifecycleResult = {
  primary: ExistingMatchOccurrenceApplyResult;
  relationReconciliation: ObservationConceptRelationLifecycleResult;
};

/**
 * Production Existing-Match entry: primary apply commits first, then
 * derived Observation↔Concept exact-evidence supports are materialized.
 * Relation failure does not change the primary result.
 */
export function applyExistingMatchOccurrencesThenReconcile(
  plans: ExistingMatchPlan[],
  deps: ApplyExistingMatchOccurrencesDeps &
    Partial<Pick<ObservationConceptRelationLifecycleDeps, "reconcile" | "now">>,
): ExistingMatchOccurrenceLifecycleResult {
  const primary = applyExistingMatchOccurrences(plans, deps);
  if (!primary.ok) {
    return { primary, relationReconciliation: { status: "not_needed" } };
  }
  const sessionIds = plans.map((plan) => plan.provenance.sessionId);
  return {
    primary,
    relationReconciliation: afterConceptOccurrenceSessionsCommitted(
      { sessionIds },
      { db: deps.db, reconcile: deps.reconcile, now: deps.now },
    ),
  };
}
