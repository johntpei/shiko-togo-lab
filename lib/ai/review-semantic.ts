import type { ValidatedEvidence } from "./evidence";
import type { EvidenceUnit } from "./evidence-units";
import type { ReviewSessionMeta } from "./review-input";
import {
  claimLeapsToUnmentionedDomain,
  hasUnsupportedExaggeration,
  isGenericCommonTheme,
  isPsychologicalOverclaim,
  isUnverifiableHypothesis,
  isWeakNextQuestion,
} from "./review-quality";
import type {
  ReviewGuardType,
  ReviewSemanticFailureReason,
} from "./review-schemas";

export type ReviewSemanticResult = {
  valid: boolean;
  reason: ReviewSemanticFailureReason | null;
  guardType: ReviewGuardType;
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

function evidenceCorpus(evidence: ValidatedEvidence[]) {
  return evidence
    .filter((item) => item.validated)
    .map((item) => item.quote)
    .join("\n");
}

function hardInvalidRef(): ReviewSemanticResult {
  return {
    valid: false,
    reason: "invalid_evidence_ref",
    guardType: "hard",
  };
}

function interpretationQuality(
  claim: string | undefined,
  evidence: ValidatedEvidence[],
  options?: { hypothesis?: boolean },
): ReviewSemanticResult | null {
  if (!claim) {
    return null;
  }
  if (claimLeapsToUnmentionedDomain(claim, evidenceCorpus(evidence))) {
    return { valid: false, reason: "domain_leap", guardType: "hard" };
  }
  if (isPsychologicalOverclaim(claim)) {
    return {
      valid: false,
      reason: "unrelated_interpretation",
      guardType: "interpretation",
    };
  }
  if (isGenericCommonTheme(claim)) {
    return {
      valid: false,
      reason: "generic_interpretation",
      guardType: "interpretation",
    };
  }
  if (
    options?.hypothesis &&
    (hasUnsupportedExaggeration(claim) || isUnverifiableHypothesis(claim))
  ) {
    return {
      valid: false,
      reason: "unsupported_exaggeration",
      guardType: "interpretation",
    };
  }
  return null;
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

export function validateCommonThemeSupport(
  evidence: ValidatedEvidence[],
  unitsByRef: Map<string, EvidenceUnit>,
  claim?: string,
): ReviewSemanticResult {
  if (hasInvalidRef(evidence)) {
    return hardInvalidRef();
  }
  if (distinctSessionIds(evidence, unitsByRef).size < 2) {
    return {
      valid: false,
      reason: "insufficient_distinct_sessions",
      guardType: "hard",
    };
  }
  return (
    interpretationQuality(claim, evidence) ?? {
      valid: true,
      reason: null,
      guardType: "interpretation",
    }
  );
}

export function validateTensionSupport(
  evidence: ValidatedEvidence[],
  unitsByRef: Map<string, EvidenceUnit>,
  claim?: string,
): ReviewSemanticResult {
  if (hasInvalidRef(evidence)) {
    return hardInvalidRef();
  }
  const quality = interpretationQuality(claim, evidence);
  if (quality?.guardType === "hard") {
    return quality;
  }
  if (distinctSessionIds(evidence, unitsByRef).size < 2) {
    return {
      valid: false,
      reason: "insufficient_distinct_sessions",
      guardType: "interpretation",
    };
  }
  return (
    quality ?? {
      valid: true,
      reason: null,
      guardType: "interpretation",
    }
  );
}

export function validateCrossInsightSupport(
  evidence: ValidatedEvidence[],
  unitsByRef: Map<string, EvidenceUnit>,
  claim?: string,
): ReviewSemanticResult {
  return validateTensionSupport(evidence, unitsByRef, claim);
}

export function validateHypothesisSupport(
  evidence: ValidatedEvidence[],
  unitsByRef: Map<string, EvidenceUnit>,
  claim?: string,
): ReviewSemanticResult {
  if (hasInvalidRef(evidence)) {
    return hardInvalidRef();
  }
  const quality = interpretationQuality(claim, evidence, { hypothesis: true });
  if (quality?.guardType === "hard") {
    return quality;
  }
  if (distinctSessionIds(evidence, unitsByRef).size < 2) {
    return {
      valid: false,
      reason: "insufficient_distinct_sessions",
      guardType: "interpretation",
    };
  }
  return (
    quality ?? {
      valid: true,
      reason: null,
      guardType: "interpretation",
    }
  );
}

export function validateShiftSupport(
  beforeEvidence: ValidatedEvidence[],
  afterEvidence: ValidatedEvidence[],
  unitsByRef: Map<string, EvidenceUnit>,
  sessions: ReviewSessionMeta[],
): ReviewSemanticResult {
  if (hasInvalidRef(beforeEvidence) || hasInvalidRef(afterEvidence)) {
    return hardInvalidRef();
  }

  const beforeSessions = distinctSessionIds(beforeEvidence, unitsByRef);
  const afterSessions = distinctSessionIds(afterEvidence, unitsByRef);
  if (beforeSessions.size === 0 || afterSessions.size === 0) {
    return {
      valid: false,
      reason: "insufficient_distinct_sessions",
      guardType: "hard",
    };
  }

  const overlap = [...beforeSessions].some((id) => afterSessions.has(id));
  if (
    overlap &&
    beforeSessions.size === 1 &&
    afterSessions.size === 1 &&
    [...beforeSessions][0] === [...afterSessions][0]
  ) {
    return {
      valid: false,
      reason: "unsupported_cross_session_claim",
      guardType: "hard",
    };
  }
  if (beforeSessions.size === 1 && afterSessions.size === 1 && overlap) {
    return {
      valid: false,
      reason: "unsupported_cross_session_claim",
      guardType: "hard",
    };
  }

  const beforeAt = earliestOccurredAt(beforeEvidence, unitsByRef, sessions);
  const afterAt = earliestOccurredAt(afterEvidence, unitsByRef, sessions);
  if (beforeAt && afterAt) {
    if (beforeAt > afterAt) {
      return {
        valid: false,
        reason: "invalid_chronology",
        guardType: "hard",
      };
    }
    if (beforeAt === afterAt) {
      const beforeIndex = sessionIndex(beforeEvidence, unitsByRef, sessions);
      const afterIndex = sessionIndex(afterEvidence, unitsByRef, sessions);
      if (
        beforeIndex != null &&
        afterIndex != null &&
        beforeIndex >= afterIndex
      ) {
        return {
          valid: false,
          reason: "invalid_chronology",
          guardType: "hard",
        };
      }
    }
  }

  if (!hasUserEvidence(beforeEvidence) || !hasUserEvidence(afterEvidence)) {
    if (
      hasValidatedEvidence(beforeEvidence) &&
      hasValidatedEvidence(afterEvidence)
    ) {
      return {
        valid: false,
        reason: "evidence_role_mismatch",
        guardType: "hard",
      };
    }
    return {
      valid: false,
      reason: "missing_user_evidence",
      guardType: "hard",
    };
  }

  return { valid: true, reason: null, guardType: "hard" };
}

export function validateOptionalEvidence(
  evidence: ValidatedEvidence[],
): ReviewSemanticResult {
  if (hasInvalidRef(evidence)) {
    return hardInvalidRef();
  }
  return { valid: true, reason: null, guardType: "interpretation" };
}

export function validateNextQuestionSupport(
  text: string,
  evidence: ValidatedEvidence[],
): ReviewSemanticResult {
  if (hasInvalidRef(evidence)) {
    return hardInvalidRef();
  }
  if (isWeakNextQuestion(text)) {
    return {
      valid: false,
      reason: "weak_next_question",
      guardType: "interpretation",
    };
  }
  return { valid: true, reason: null, guardType: "interpretation" };
}

export function computeReviewGuardStats(
  items: Array<{
    semanticValid?: boolean;
    guardType?: ReviewGuardType;
  }>,
) {
  const hardItems = items.filter((item) => item.guardType === "hard");
  const interpretationItems = items.filter(
    (item) => item.guardType === "interpretation",
  );
  const hardValidCount = hardItems.filter((item) => item.semanticValid).length;
  const interpretationValidCount = interpretationItems.filter(
    (item) => item.semanticValid,
  ).length;
  return {
    hardItemCount: hardItems.length,
    hardValidCount,
    hardValidationRate:
      hardItems.length === 0 ? 0 : hardValidCount / hardItems.length,
    hardExcludedCount: hardItems.length - hardValidCount,
    interpretationItemCount: interpretationItems.length,
    interpretationValidCount,
    interpretationValidationRate:
      interpretationItems.length === 0
        ? 0
        : interpretationValidCount / interpretationItems.length,
    interpretationExcludedCount:
      interpretationItems.length - interpretationValidCount,
  };
}
