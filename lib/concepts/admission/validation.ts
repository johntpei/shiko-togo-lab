import {
  ADMISSION_DECISIONS,
  ADMISSION_REASON_CODES,
  ADMIT_REASON_CODES,
  DEFER_REASON_CODES,
  REJECT_REASON_CODES,
  type AdmissionCoverageReason,
  type AdmissionDecision,
  type AdmissionDecisionKind,
  type AdmissionReasonCode,
} from "./types";
import type { AdmissionCandidate } from "./types";

export type AdmissionCoverage =
  | { ok: true }
  | { ok: false; reason: AdmissionCoverageReason; detail: string };

const ADMIT_REASONS = new Set<string>(ADMIT_REASON_CODES);
const DEFER_REASONS = new Set<string>(DEFER_REASON_CODES);
const REJECT_REASONS = new Set<string>(REJECT_REASON_CODES);
const DECISIONS = new Set<string>(ADMISSION_DECISIONS);
const REASONS = new Set<string>(ADMISSION_REASON_CODES);

export function isAdmissionDecisionKind(
  value: string,
): value is AdmissionDecisionKind {
  return DECISIONS.has(value);
}

export function isAdmissionReasonCode(
  value: string,
): value is AdmissionReasonCode {
  return REASONS.has(value);
}

export function isAllowedAdmissionReason(
  decision: string,
  reasonCode: string,
) {
  if (decision === "admit") {
    return ADMIT_REASONS.has(reasonCode);
  }
  if (decision === "defer") {
    return DEFER_REASONS.has(reasonCode);
  }
  if (decision === "reject") {
    return REJECT_REASONS.has(reasonCode);
  }
  return false;
}

export function validateAdmissionCoverage(input: {
  candidates: Array<Pick<AdmissionCandidate, "candidateRef">>;
  decisions: AdmissionDecision[];
}): AdmissionCoverage {
  const expected = input.candidates.map((item) => item.candidateRef);
  const seen = new Set<string>();

  for (const decision of input.decisions) {
    if (!expected.includes(decision.candidateRef)) {
      return {
        ok: false,
        reason: "unknown_candidate_ref",
        detail: decision.candidateRef,
      };
    }
    if (seen.has(decision.candidateRef)) {
      return {
        ok: false,
        reason: "duplicate_candidate_ref",
        detail: decision.candidateRef,
      };
    }
    seen.add(decision.candidateRef);

    if (!isAdmissionDecisionKind(decision.decision)) {
      return {
        ok: false,
        reason: "invalid_decision",
        detail: decision.candidateRef,
      };
    }
    if (!isAdmissionReasonCode(decision.reasonCode)) {
      return {
        ok: false,
        reason: "invalid_reason_code",
        detail: decision.candidateRef,
      };
    }
    if (
      !isAllowedAdmissionReason(decision.decision, decision.reasonCode)
    ) {
      return {
        ok: false,
        reason: "invalid_decision_reason",
        detail: decision.candidateRef,
      };
    }
  }

  const missing = expected.find((ref) => !seen.has(ref));
  if (missing) {
    return {
      ok: false,
      reason: "missing_candidate_ref",
      detail: missing,
    };
  }

  return { ok: true };
}
