import type { ValidatedEvidence } from "./evidence";
import type { EvidenceUnit } from "./evidence-units";
import type { ReviewSessionMeta } from "./review-input";
import type { ReviewSemanticFailureReason } from "./review-schemas";

export type ReviewSemanticResult = {
  valid: boolean;
  reason: ReviewSemanticFailureReason | null;
};

function hasInvalidRef(evidence: ValidatedEvidence[]) {
  return evidence.some(
    (item) =>
      !item.validated &&
      (item.reason === "invalid_evidence_ref" ||
        item.reason === "invalid_message_ref" ||
        item.reason === "quote_not_found"),
  );
}

export function distinctSessionIds(
  evidence: ValidatedEvidence[],
  unitsByRef: Map<string, EvidenceUnit>,
) {
  const ids = new Set<string>();
  for (const item of evidence) {
    if (!item.validated) {
      continue;
    }
    const unit = unitsByRef.get(item.messageRef);
    const sessionId = unit?.sessionId ?? item.sessionId;
    if (sessionId) {
      ids.add(sessionId);
    }
  }
  return ids;
}

function hasUserEvidence(evidence: ValidatedEvidence[]) {
  return evidence.some((item) => item.validated && item.role === "user");
}

function hasValidatedEvidence(evidence: ValidatedEvidence[]) {
  return evidence.some((item) => item.validated);
}

function earliestOccurredAt(
  evidence: ValidatedEvidence[],
  unitsByRef: Map<string, EvidenceUnit>,
  sessions: ReviewSessionMeta[],
) {
  const values: string[] = [];
  for (const item of evidence) {
    if (!item.validated) {
      continue;
    }
    const unit = unitsByRef.get(item.messageRef);
    const occurredAt = unit?.sessionOccurredAt ?? item.occurredAt;
    if (occurredAt) {
      values.push(occurredAt);
      continue;
    }
    const sessionId = unit?.sessionId ?? item.sessionId;
    const session = sessions.find((entry) => entry.sessionId === sessionId);
    if (session) {
      values.push(session.occurredAt);
    }
  }
  if (values.length === 0) {
    return null;
  }
  return [...values].sort()[0] ?? null;
}

function sessionIndex(
  evidence: ValidatedEvidence[],
  unitsByRef: Map<string, EvidenceUnit>,
  sessions: ReviewSessionMeta[],
) {
  const ids = distinctSessionIds(evidence, unitsByRef);
  const indexes = [...ids]
    .map((id) => sessions.findIndex((session) => session.sessionId === id))
    .filter((index) => index >= 0);
  if (indexes.length === 0) {
    return null;
  }
  return Math.min(...indexes);
}

function requireDistinctSessions(
  evidence: ValidatedEvidence[],
  unitsByRef: Map<string, EvidenceUnit>,
  minimum = 2,
): ReviewSemanticResult | null {
  if (hasInvalidRef(evidence)) {
    return { valid: false, reason: "invalid_evidence_ref" };
  }
  if (distinctSessionIds(evidence, unitsByRef).size < minimum) {
    return { valid: false, reason: "insufficient_distinct_sessions" };
  }
  return null;
}

export function validateCommonThemeSupport(
  evidence: ValidatedEvidence[],
  unitsByRef: Map<string, EvidenceUnit>,
): ReviewSemanticResult {
  return (
    requireDistinctSessions(evidence, unitsByRef, 2) ?? {
      valid: true,
      reason: null,
    }
  );
}

export function validateTensionSupport(
  evidence: ValidatedEvidence[],
  unitsByRef: Map<string, EvidenceUnit>,
): ReviewSemanticResult {
  return validateCommonThemeSupport(evidence, unitsByRef);
}

export function validateCrossInsightSupport(
  evidence: ValidatedEvidence[],
  unitsByRef: Map<string, EvidenceUnit>,
): ReviewSemanticResult {
  return validateCommonThemeSupport(evidence, unitsByRef);
}

export function validateHypothesisSupport(
  evidence: ValidatedEvidence[],
  unitsByRef: Map<string, EvidenceUnit>,
): ReviewSemanticResult {
  return validateCommonThemeSupport(evidence, unitsByRef);
}

export function validateShiftSupport(
  beforeEvidence: ValidatedEvidence[],
  afterEvidence: ValidatedEvidence[],
  unitsByRef: Map<string, EvidenceUnit>,
  sessions: ReviewSessionMeta[],
): ReviewSemanticResult {
  if (hasInvalidRef(beforeEvidence) || hasInvalidRef(afterEvidence)) {
    return { valid: false, reason: "invalid_evidence_ref" };
  }

  const beforeSessions = distinctSessionIds(beforeEvidence, unitsByRef);
  const afterSessions = distinctSessionIds(afterEvidence, unitsByRef);
  if (beforeSessions.size === 0 || afterSessions.size === 0) {
    return { valid: false, reason: "insufficient_distinct_sessions" };
  }

  const overlap = [...beforeSessions].some((id) => afterSessions.has(id));
  if (
    overlap &&
    beforeSessions.size === 1 &&
    afterSessions.size === 1 &&
    [...beforeSessions][0] === [...afterSessions][0]
  ) {
    return { valid: false, reason: "unsupported_cross_session_claim" };
  }
  if (beforeSessions.size === 1 && afterSessions.size === 1 && overlap) {
    return { valid: false, reason: "unsupported_cross_session_claim" };
  }

  const beforeAt = earliestOccurredAt(beforeEvidence, unitsByRef, sessions);
  const afterAt = earliestOccurredAt(afterEvidence, unitsByRef, sessions);
  if (beforeAt && afterAt) {
    if (beforeAt > afterAt) {
      return { valid: false, reason: "invalid_chronology" };
    }
    if (beforeAt === afterAt) {
      const beforeIndex = sessionIndex(beforeEvidence, unitsByRef, sessions);
      const afterIndex = sessionIndex(afterEvidence, unitsByRef, sessions);
      if (
        beforeIndex != null &&
        afterIndex != null &&
        beforeIndex >= afterIndex
      ) {
        return { valid: false, reason: "invalid_chronology" };
      }
    }
  }

  if (!hasUserEvidence(beforeEvidence) || !hasUserEvidence(afterEvidence)) {
    if (hasValidatedEvidence(beforeEvidence) && hasValidatedEvidence(afterEvidence)) {
      return { valid: false, reason: "evidence_role_mismatch" };
    }
    return { valid: false, reason: "missing_user_evidence" };
  }

  return { valid: true, reason: null };
}

export function validateOptionalEvidence(
  evidence: ValidatedEvidence[],
): ReviewSemanticResult {
  if (hasInvalidRef(evidence)) {
    return { valid: false, reason: "invalid_evidence_ref" };
  }
  return { valid: true, reason: null };
}
