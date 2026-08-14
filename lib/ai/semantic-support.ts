import type { ValidatedEvidence } from "./evidence";
import type { EvidenceUnit } from "./evidence-units";
import type {
  AnalysisKind,
  AnalysisSubject,
  SemanticFailureReason,
} from "./schemas";

export type SemanticSupportItem = {
  kind: AnalysisKind;
  subject: AnalysisSubject;
  evidenceRefs: string[];
};

export type SemanticSupportResult = {
  valid: boolean;
  reason: SemanticFailureReason | null;
};

const SUBJECTS_BY_KIND: Record<AnalysisKind, readonly AnalysisSubject[]> = {
  fact: ["user", "conversation", "external"],
  insight: ["user", "interpretation"],
  hypothesis: ["interpretation"],
  decision: ["user"],
  action: ["user"],
  open_question: ["user", "conversation", "external", "interpretation"],
};

function requiresUserEvidence(kind: AnalysisKind, subject: AnalysisSubject) {
  if (kind === "decision" || kind === "action") {
    return true;
  }
  if (kind === "fact" && subject === "user") {
    return true;
  }
  if (kind === "insight" && subject === "user") {
    return true;
  }
  return false;
}

function unitRole(
  ref: string,
  unitsByRef: Map<string, EvidenceUnit>,
  evidence: ValidatedEvidence[] | undefined,
) {
  const fromUnit = unitsByRef.get(ref.trim())?.role;
  if (fromUnit) {
    return fromUnit;
  }
  const stored = evidence?.find((item) => item.messageRef === ref.trim());
  return stored?.role ?? null;
}

/**
 * kind + Evidence Unit role が、その分析項目を支えるのに適切かを検証する。
 * kind の書き換えはしない。
 */
export function validateSemanticSupport(
  item: SemanticSupportItem,
  unitsByRef: Map<string, EvidenceUnit>,
  evidence?: ValidatedEvidence[],
): SemanticSupportResult {
  const allowedSubjects = SUBJECTS_BY_KIND[item.kind];
  if (!allowedSubjects.includes(item.subject)) {
    return { valid: false, reason: "unsupported_subject_kind" };
  }

  const refs = item.evidenceRefs.map((ref) => ref.trim()).filter(Boolean);
  const hasInvalidRef = evidence
    ? evidence.some(
        (itemEvidence) =>
          !itemEvidence.validated &&
          (itemEvidence.reason === "invalid_evidence_ref" ||
            itemEvidence.reason === "invalid_message_ref" ||
            itemEvidence.reason === "quote_not_found"),
      )
    : refs.some((ref) => !unitsByRef.has(ref));

  if (hasInvalidRef) {
    return { valid: false, reason: "invalid_evidence_ref" };
  }

  const validatedRefs = evidence
    ? evidence
        .filter((itemEvidence) => itemEvidence.validated)
        .map((itemEvidence) => itemEvidence.messageRef)
    : refs.filter((ref) => unitsByRef.has(ref));

  const roles = validatedRefs.map((ref) =>
    unitRole(ref, unitsByRef, evidence),
  );
  const hasUserEvidence = roles.some((role) => role === "user");
  const hasValidatedEvidence = roles.length > 0;

  if (requiresUserEvidence(item.kind, item.subject) && !hasUserEvidence) {
    if (hasValidatedEvidence) {
      return { valid: false, reason: "evidence_role_mismatch" };
    }
    return { valid: false, reason: "missing_user_evidence" };
  }

  return { valid: true, reason: null };
}

export function computeSemanticStats(
  items: Array<{ semanticValid?: boolean }>,
) {
  const checked = items.filter(
    (item) => typeof item.semanticValid === "boolean",
  );
  const semanticValidCount = checked.filter(
    (item) => item.semanticValid,
  ).length;
  const semanticItemCount = checked.length;
  const semanticValidationRate =
    semanticItemCount === 0 ? 0 : semanticValidCount / semanticItemCount;
  return {
    semanticItemCount,
    semanticValidCount,
    semanticValidationRate,
  };
}
