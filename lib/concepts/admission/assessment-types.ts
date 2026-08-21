export const CONCEPT_ADMISSION_ASSESSMENT_VERSION =
  "concept-admission-assessment-v2";

export type ConceptAdmissionAssessmentVersion =
  typeof CONCEPT_ADMISSION_ASSESSMENT_VERSION;

export const CONCEPT_ADMISSION_POLICY_VERSION = "concept-admission-policy-v1";

export type ConceptAdmissionPolicyVersion =
  typeof CONCEPT_ADMISSION_POLICY_VERSION;

export const CONCEPT_FORMS = [
  "specific_named_concept",
  "stable_topic",
  "generic_head",
  "clause_or_statement",
  "episodic_object",
  "temporary_state",
  "task_or_action",
  "relation_or_claim",
  "pii",
  "unclear",
] as const;

export type ConceptForm = (typeof CONCEPT_FORMS)[number];

export const EVIDENCE_ROLES = [
  "central",
  "supporting",
  "incidental",
  "unclear",
] as const;

export type EvidenceRole = (typeof EVIDENCE_ROLES)[number];

export const LONGITUDINAL_POTENTIALS = ["high", "medium", "low"] as const;

export type LongitudinalPotential = (typeof LONGITUDINAL_POTENTIALS)[number];

export type ConceptAssessment = {
  candidateRef: string;
  conceptForm: ConceptForm;
  evidenceRole: EvidenceRole;
  longitudinalPotential: LongitudinalPotential;
};

export type ConceptAssessmentInput = {
  candidateRef: string;
  conceptForm: string;
  evidenceRole: string;
  longitudinalPotential: string;
};

export const ASSESSMENT_COVERAGE_REASONS = [
  "missing_candidate_ref",
  "duplicate_candidate_ref",
  "unknown_candidate_ref",
  "invalid_concept_form",
  "invalid_evidence_role",
  "invalid_longitudinal_potential",
] as const;

export type AssessmentCoverageReason =
  (typeof ASSESSMENT_COVERAGE_REASONS)[number];

export type AdmissionServerSignals = {
  occurrenceCount: number;
  distinctSessionCount: number;
  hasExactRecurrence: boolean;
  hasObservedAliasRecurrence: boolean;
  suspiciousFlags: string[];
};

export const POLICY_REASON_CODES = [
  "form_specific",
  "form_stable_high",
  "form_eligible_with_signal",
  "form_eligible_high",
  "hard_pii",
  "hard_clause",
  "hard_episodic",
  "hard_temporary_state",
  "hard_task_or_action",
  "hard_relation_or_claim",
  "hard_generic",
  "form_unclear",
  "insufficient_positive_signal",
] as const;

export type PolicyReasonCode = (typeof POLICY_REASON_CODES)[number];

export const POLICY_POSITIVE_SIGNALS = [
  "specific_named_concept",
  "stable_topic",
  "longitudinal_high",
  "evidence_central",
  "multi_session",
  "exact_recurrence",
  "observed_alias_recurrence",
] as const;

export type PolicyPositiveSignal = (typeof POLICY_POSITIVE_SIGNALS)[number];

export const POLICY_ELIGIBLE_FORMS = [
  "specific_named_concept",
  "stable_topic",
] as const;

export type PolicyEligibleForm = (typeof POLICY_ELIGIBLE_FORMS)[number];

export const POLICY_HARD_NEGATIVE_FORMS = [
  "pii",
  "clause_or_statement",
  "episodic_object",
  "temporary_state",
  "task_or_action",
  "relation_or_claim",
] as const;

export type PolicyHardNegativeForm =
  (typeof POLICY_HARD_NEGATIVE_FORMS)[number];
