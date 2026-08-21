import { MAX_CONCEPTS_PER_UNIT } from "./actions";

export const CONCEPT_EXTRACT_DISPOSITIONS = [
  "extracted",
  "skip",
  "uncertain",
] as const;

export type ConceptExtractDisposition =
  (typeof CONCEPT_EXTRACT_DISPOSITIONS)[number];

export const CONCEPT_EXTRACT_COVERAGE_REASONS = [
  "missing_unit",
  "unknown_evidence_ref",
  "duplicate_evidence_ref",
  "extracted_concept_count",
  "skip_with_concepts",
  "uncertain_with_concepts",
] as const;

export type ConceptExtractCoverageReason =
  (typeof CONCEPT_EXTRACT_COVERAGE_REASONS)[number];

export type ConceptExtractUnitResultInput = {
  evidenceRef: string;
  disposition: string;
  concepts: unknown[];
};

export type ConceptExtractCoverage =
  | { ok: true }
  | { ok: false; reason: ConceptExtractCoverageReason; detail: string };

export function validateConceptExtractCoverage(input: {
  evidenceRefs: string[];
  units: ConceptExtractUnitResultInput[];
}): ConceptExtractCoverage {
  const expected = [...input.evidenceRefs];
  const seen = new Set<string>();

  for (const unit of input.units) {
    if (!expected.includes(unit.evidenceRef)) {
      return {
        ok: false,
        reason: "unknown_evidence_ref",
        detail: unit.evidenceRef,
      };
    }
    if (seen.has(unit.evidenceRef)) {
      return {
        ok: false,
        reason: "duplicate_evidence_ref",
        detail: unit.evidenceRef,
      };
    }
    seen.add(unit.evidenceRef);

    if (unit.disposition === "extracted") {
      if (
        unit.concepts.length < 1 ||
        unit.concepts.length > MAX_CONCEPTS_PER_UNIT
      ) {
        return {
          ok: false,
          reason: "extracted_concept_count",
          detail: unit.evidenceRef,
        };
      }
    } else if (unit.disposition === "skip") {
      if (unit.concepts.length > 0) {
        return {
          ok: false,
          reason: "skip_with_concepts",
          detail: unit.evidenceRef,
        };
      }
    } else if (unit.disposition === "uncertain") {
      if (unit.concepts.length > 0) {
        return {
          ok: false,
          reason: "uncertain_with_concepts",
          detail: unit.evidenceRef,
        };
      }
    }
  }

  const missing = expected.filter((ref) => !seen.has(ref));
  if (missing.length > 0) {
    return {
      ok: false,
      reason: "missing_unit",
      detail: missing.join(","),
    };
  }
  return { ok: true };
}
