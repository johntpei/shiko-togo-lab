export const CONCEPT_ADMISSION_VERSION = "concept-admission-v1";

export type ConceptAdmissionVersion = typeof CONCEPT_ADMISSION_VERSION;

export const ADMISSION_DECISIONS = ["admit", "defer", "reject"] as const;

export type AdmissionDecisionKind = (typeof ADMISSION_DECISIONS)[number];

export const ADMISSION_REASON_CODES = [
  "stable_topic",
  "specific_named_concept",
  "longitudinal_value",
  "generic",
  "clause",
  "episodic",
  "temporary_state",
  "task_or_action",
  "relation_or_claim",
  "pii",
  "insufficient_context",
] as const;

export type AdmissionReasonCode = (typeof ADMISSION_REASON_CODES)[number];

export const ADMIT_REASON_CODES = [
  "stable_topic",
  "specific_named_concept",
  "longitudinal_value",
] as const;

export const DEFER_REASON_CODES = ["insufficient_context"] as const;

export const REJECT_REASON_CODES = [
  "generic",
  "clause",
  "episodic",
  "temporary_state",
  "task_or_action",
  "relation_or_claim",
  "pii",
] as const;

export const ADMISSION_COVERAGE_REASONS = [
  "missing_candidate_ref",
  "duplicate_candidate_ref",
  "unknown_candidate_ref",
  "invalid_decision",
  "invalid_reason_code",
  "invalid_decision_reason",
] as const;

export type AdmissionCoverageReason =
  (typeof ADMISSION_COVERAGE_REASONS)[number];

export const ADMISSION_CALIBRATION_CLASSES = ["A", "B", "C", "D"] as const;

export type AdmissionCalibrationClass =
  (typeof ADMISSION_CALIBRATION_CLASSES)[number];

export const MAX_REPRESENTATIVE_EVIDENCE = 2;
export const ADMISSION_SHORT_TEXT_MAX_CHARS = 80;

export type AdmissionRepresentativeEvidence = {
  sessionId: string;
  evidenceRef: string;
  occurredAt: string;
  shortText: string;
};

export type AdmissionProvisionalHint = {
  otherCandidateRef: string;
  otherCanonicalLabel: string;
  surfaceForm: string;
  evidenceRef: string;
};

export type AdmissionCandidate = {
  candidateRef: string;
  canonicalLabel: string;
  normalizedKey: string;
  occurrenceCount: number;
  distinctSessionCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  sessionIds: string[];
  evidenceRefs: string[];
  suspiciousFlags: string[];
  matchKindsSeen: string[];
  representativeEvidence: AdmissionRepresentativeEvidence[];
  provisionalHints: AdmissionProvisionalHint[];
};

export type AdmissionDecision = {
  candidateRef: string;
  decision: string;
  reasonCode: string;
};

export type AdmissionJudgedCandidate = AdmissionCandidate & {
  decision: AdmissionDecisionKind;
  reasonCode: AdmissionReasonCode;
};

export type AdmissionCalibrationLabel = {
  candidateRef: string;
  class: AdmissionCalibrationClass;
};

export type AdmissionReportRow = {
  candidateRef: string;
  canonicalLabel: string;
  occurrenceCount: number;
  distinctSessionCount: number;
  reasonCode: AdmissionReasonCode;
};

export type AdmissionPerSessionRow = {
  sessionId: string;
  candidateCount: number;
  admittedCount: number;
  deferredCount: number;
  rejectedCount: number;
};

export type AdmissionReport = {
  totals: {
    totalCandidates: number;
    admitted: number;
    deferred: number;
    rejected: number;
    reasonCodeCounts: Record<AdmissionReasonCode, number>;
  };
  admitted: AdmissionReportRow[];
  deferred: AdmissionReportRow[];
  rejected: AdmissionReportRow[];
  perSession: AdmissionPerSessionRow[];
};
