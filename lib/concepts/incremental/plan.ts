import type { ConceptRegistrySnapshot } from "@/lib/concepts/catalog";
import {
  classifyServerIdentity,
  type ConceptMatchKind,
} from "@/lib/concepts/identity";
import { normalizeConceptKey } from "@/lib/concepts/normalize";
import {
  CONCEPT_EXTRACTION_VERSION,
  type ConceptSourceRole,
  type ConceptSourceType,
} from "@/lib/concepts/types";

export const INCREMENTAL_MATCH_REASONS = [
  "exact_canonical",
  "unique_observed_alias",
] as const;

export type IncrementalMatchReason = (typeof INCREMENTAL_MATCH_REASONS)[number];

export const INCREMENTAL_PLAN_KINDS = [
  "existing_match",
  "new",
  "provisional_new",
] as const;

export type IncrementalPlanKind = (typeof INCREMENTAL_PLAN_KINDS)[number];

export type IncrementalCandidateProvenance = {
  sessionId: string;
  messageId: string;
  evidenceRef: string;
  occurredAt: string;
  surfaceForm: string;
  sourceRole: ConceptSourceRole;
  sourceType: ConceptSourceType;
  extractionVersion: typeof CONCEPT_EXTRACTION_VERSION;
};

export type IncrementalProvisionalHint = {
  conceptId?: string;
  conceptRef?: string;
  existingCanonicalLabel?: string;
};

/**
 * Grounded Candidate after Extraction / Resolver.
 * Planner は identity を Registry snapshot に対して再判定する。
 */
export type IncrementalGroundedCandidate = IncrementalCandidateProvenance & {
  candidateRef: string;
  canonicalLabel: string;
  normalizedKey?: string;
  matchKind?: ConceptMatchKind | null;
  resolvedAs?: "match" | "new" | null;
  provisional?: IncrementalProvisionalHint | null;
};

export type ExistingMatchPlan = {
  kind: "existing_match";
  candidateRef: string;
  conceptId: string;
  matchReason: IncrementalMatchReason;
  canonicalLabel: string;
  normalizedKey: string;
  provenance: IncrementalCandidateProvenance;
};

export type NewCandidatePlan = {
  kind: "new";
  candidateRef: string;
  canonicalLabel: string;
  normalizedKey: string;
  provenance: IncrementalCandidateProvenance;
};

export type ProvisionalNewPlan = {
  kind: "provisional_new";
  candidateRef: string;
  canonicalLabel: string;
  normalizedKey: string;
  provisionalConceptId?: string;
  provisionalReason: "semantic";
  provenance: IncrementalCandidateProvenance;
};

export type IncrementalConceptPlan =
  | ExistingMatchPlan
  | NewCandidatePlan
  | ProvisionalNewPlan;

export type IncrementalPlanResult = {
  plans: IncrementalConceptPlan[];
};

function provenanceOf(
  candidate: IncrementalGroundedCandidate,
): IncrementalCandidateProvenance {
  return {
    sessionId: candidate.sessionId,
    messageId: candidate.messageId,
    evidenceRef: candidate.evidenceRef,
    occurredAt: candidate.occurredAt,
    surfaceForm: candidate.surfaceForm,
    sourceRole: candidate.sourceRole,
    sourceType: candidate.sourceType,
    extractionVersion: candidate.extractionVersion,
  };
}

function candidateNormalizedKey(candidate: IncrementalGroundedCandidate) {
  return (
    candidate.normalizedKey ??
    normalizeConceptKey(candidate.canonicalLabel || candidate.surfaceForm)
  );
}

function hasSemanticProvisional(candidate: IncrementalGroundedCandidate) {
  return candidate.matchKind === "semantic" || candidate.provisional != null;
}

function planOne(
  candidate: IncrementalGroundedCandidate,
  registry: ConceptRegistrySnapshot,
): IncrementalConceptPlan {
  const provenance = provenanceOf(candidate);
  const normalizedKey = candidateNormalizedKey(candidate);
  const identity = classifyServerIdentity(registry, candidate.surfaceForm);

  if (identity.kind === "exact") {
    return {
      kind: "existing_match",
      candidateRef: candidate.candidateRef,
      conceptId: identity.entry.conceptId,
      matchReason: "exact_canonical",
      canonicalLabel: identity.entry.canonicalLabel,
      normalizedKey: identity.entry.normalizedKey,
      provenance,
    };
  }

  if (identity.kind === "observed_alias") {
    return {
      kind: "existing_match",
      candidateRef: candidate.candidateRef,
      conceptId: identity.entry.conceptId,
      matchReason: "unique_observed_alias",
      canonicalLabel: identity.entry.canonicalLabel,
      normalizedKey: identity.entry.normalizedKey,
      provenance,
    };
  }

  if (hasSemanticProvisional(candidate)) {
    return {
      kind: "provisional_new",
      candidateRef: candidate.candidateRef,
      canonicalLabel: candidate.canonicalLabel,
      normalizedKey,
      provisionalConceptId: candidate.provisional?.conceptId,
      provisionalReason: "semantic",
      provenance,
    };
  }

  return {
    kind: "new",
    candidateRef: candidate.candidateRef,
    canonicalLabel: candidate.canonicalLabel,
    normalizedKey,
    provenance,
  };
}

/**
 * Incremental Candidate を現在の Registry snapshot へ分類する pure function。
 * DB write / LLM / Policy / Assessment には依存しない。
 * 同一 Evidence の複数 Candidate は collapse しない（入力順を維持）。
 */
export function planIncrementalConceptCandidates(
  candidates: IncrementalGroundedCandidate[],
  registry: ConceptRegistrySnapshot,
): IncrementalPlanResult {
  return {
    plans: candidates.map((candidate) => planOne(candidate, registry)),
  };
}

export function stableIncrementalPlan(result: IncrementalPlanResult) {
  return JSON.stringify(result.plans);
}
