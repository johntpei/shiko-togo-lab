import type { ValidatedEvidence } from "./evidence";
import {
  MAX_EVIDENCE_REFS_PER_ITEM,
  type EvidenceUnit,
} from "./evidence-units";

export function limitEvidenceRefs(refs: string[]) {
  return refs.slice(0, MAX_EVIDENCE_REFS_PER_ITEM);
}

export function resolveEvidenceRef(
  ref: string,
  unitsByRef: Map<string, EvidenceUnit>,
  contentByMessageId: Map<string, string>,
): ValidatedEvidence {
  const unit = unitsByRef.get(ref.trim());
  if (!unit) {
    return {
      messageRef: ref,
      quote: "",
      messageId: null,
      validated: false,
      reason: "invalid_evidence_ref",
    };
  }

  const content = contentByMessageId.get(unit.messageId);
  if (content == null) {
    return {
      messageRef: unit.ref,
      quote: unit.text,
      messageId: null,
      validated: false,
      reason: "invalid_message_ref",
    };
  }

  const slice = content.slice(unit.charStartInMessage, unit.charEndInMessage);
  if (slice !== unit.text) {
    return {
      messageRef: unit.ref,
      quote: unit.text,
      messageId: unit.messageId,
      validated: false,
      reason: "quote_not_found",
    };
  }

  return {
    messageRef: unit.ref,
    quote: unit.text,
    messageId: unit.messageId,
    validated: true,
    reason: null,
  };
}

export function resolveEvidenceRefs(
  refs: string[],
  unitsByRef: Map<string, EvidenceUnit>,
  contentByMessageId: Map<string, string>,
) {
  return limitEvidenceRefs(refs).map((ref) =>
    resolveEvidenceRef(ref, unitsByRef, contentByMessageId),
  );
}

export function hasValidatedUserEvidence(
  evidence: ValidatedEvidence[],
  unitsByRef: Map<string, EvidenceUnit>,
) {
  return evidence.some((item) => {
    if (!item.validated) {
      return false;
    }
    const unit = unitsByRef.get(item.messageRef);
    return unit?.role === "user";
  });
}

export function isV3UnsupportedClaim(
  kind: string,
  evidence: ValidatedEvidence[],
  unitsByRef: Map<string, EvidenceUnit>,
): boolean {
  const hasValidated = evidence.some((item) => item.validated);
  if (kind === "fact") {
    return !hasValidated;
  }
  if (kind === "decision" || kind === "action") {
    return !hasValidatedUserEvidence(evidence, unitsByRef);
  }
  return false;
}
