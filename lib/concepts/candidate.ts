import { isGenericDeniedConcept } from "./deny-list";
import { normalizeConceptKey, normalizeConceptLabel } from "./normalize";

export const CONCEPT_CANDIDATE_REJECTION_REASONS = [
  "empty",
  "generic_term",
  "compound_relation",
] as const;

export type ConceptCandidateRejectionReason =
  (typeof CONCEPT_CANDIDATE_REJECTION_REASONS)[number];

export type ConceptCandidateValidation =
  | {
      ok: true;
      canonicalLabel: string;
      normalizedKey: string;
    }
  | {
      ok: false;
      reason: ConceptCandidateRejectionReason;
    };

const RELATION_MARKERS = /[×↔⇔]/u;
const VS_SEPARATOR = /(?:^|\s)vs(?:\s|$)/iu;
const COMPOUND_TO =
  /[\p{Script=Han}\p{Script=Katakana}A-Za-z0-9]{2,}と[\p{Script=Han}\p{Script=Katakana}A-Za-z0-9]{2,}/u;

export function isCompoundRelationLabel(label: string) {
  const trimmed = normalizeConceptLabel(label);
  if (!trimmed) {
    return false;
  }
  if (RELATION_MARKERS.test(trimmed) || VS_SEPARATOR.test(trimmed)) {
    return true;
  }
  return COMPOUND_TO.test(trimmed);
}

export function validateConceptCandidate(label: string): ConceptCandidateValidation {
  const canonicalLabel = normalizeConceptLabel(label);
  const normalizedKey = normalizeConceptKey(label);
  if (!canonicalLabel || !normalizedKey) {
    return { ok: false, reason: "empty" };
  }
  if (isGenericDeniedConcept(label)) {
    return { ok: false, reason: "generic_term" };
  }
  if (isCompoundRelationLabel(canonicalLabel)) {
    return { ok: false, reason: "compound_relation" };
  }
  return { ok: true, canonicalLabel, normalizedKey };
}
