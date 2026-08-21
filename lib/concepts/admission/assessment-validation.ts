import {
  CONCEPT_FORMS,
  EVIDENCE_ROLES,
  LONGITUDINAL_POTENTIALS,
  type AssessmentCoverageReason,
  type ConceptAssessment,
  type ConceptAssessmentInput,
  type ConceptForm,
  type EvidenceRole,
  type LongitudinalPotential,
} from "./assessment-types";
import type { AdmissionCandidate } from "./types";

export type AssessmentCoverage =
  | { ok: true; assessments: ConceptAssessment[] }
  | { ok: false; reason: AssessmentCoverageReason; detail: string };

const FORMS = new Set<string>(CONCEPT_FORMS);
const ROLES = new Set<string>(EVIDENCE_ROLES);
const POTENTIALS = new Set<string>(LONGITUDINAL_POTENTIALS);

export function isConceptForm(value: string): value is ConceptForm {
  return FORMS.has(value);
}

export function isEvidenceRole(value: string): value is EvidenceRole {
  return ROLES.has(value);
}

export function isLongitudinalPotential(
  value: string,
): value is LongitudinalPotential {
  return POTENTIALS.has(value);
}

export function validateAssessmentCoverage(input: {
  candidates: Array<Pick<AdmissionCandidate, "candidateRef">>;
  assessments: ConceptAssessmentInput[];
}): AssessmentCoverage {
  const expected = input.candidates.map((item) => item.candidateRef);
  const seen = new Set<string>();
  const normalized: ConceptAssessment[] = [];

  for (const assessment of input.assessments) {
    if (!expected.includes(assessment.candidateRef)) {
      return {
        ok: false,
        reason: "unknown_candidate_ref",
        detail: assessment.candidateRef,
      };
    }
    if (seen.has(assessment.candidateRef)) {
      return {
        ok: false,
        reason: "duplicate_candidate_ref",
        detail: assessment.candidateRef,
      };
    }
    seen.add(assessment.candidateRef);

    if (!isConceptForm(assessment.conceptForm)) {
      return {
        ok: false,
        reason: "invalid_concept_form",
        detail: assessment.candidateRef,
      };
    }
    if (!isEvidenceRole(assessment.evidenceRole)) {
      return {
        ok: false,
        reason: "invalid_evidence_role",
        detail: assessment.candidateRef,
      };
    }
    if (!isLongitudinalPotential(assessment.longitudinalPotential)) {
      return {
        ok: false,
        reason: "invalid_longitudinal_potential",
        detail: assessment.candidateRef,
      };
    }

    normalized.push({
      candidateRef: assessment.candidateRef,
      conceptForm: assessment.conceptForm,
      evidenceRole: assessment.evidenceRole,
      longitudinalPotential: assessment.longitudinalPotential,
    });
  }

  const missing = expected.find((ref) => !seen.has(ref));
  if (missing) {
    return {
      ok: false,
      reason: "missing_candidate_ref",
      detail: missing,
    };
  }

  return { ok: true, assessments: normalized };
}
