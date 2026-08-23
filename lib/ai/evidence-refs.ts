import type { ValidatedEvidence } from "./evidence";
import {
  MAX_EVIDENCE_REFS_PER_ITEM,
  type EvidenceUnit,
} from "./evidence-units";

export function limitEvidenceRefs(
  refs: string[],
  max = MAX_EVIDENCE_REFS_PER_ITEM,
) {
  return refs.slice(0, max);
}

function withSessionMeta(
  evidence: ValidatedEvidence,
  unit?: EvidenceUnit,
): ValidatedEvidence {
  return {
    ...evidence,
    sessionId: unit?.sessionId ?? evidence.sessionId ?? null,
    sessionTitle: unit?.sessionTitle ?? evidence.sessionTitle ?? null,
    occurredAt: unit?.sessionOccurredAt ?? evidence.occurredAt ?? null,
  };
}

export function resolveEvidenceRef(
  ref: string,
  unitsByRef: Map<string, EvidenceUnit>,
  contentByMessageId: Map<string, string>,
): ValidatedEvidence {
  const unit = unitsByRef.get(ref.trim());
  if (!unit) {
    return withSessionMeta({
      messageRef: ref,
      quote: "",
      messageId: null,
      validated: false,
      reason: "invalid_evidence_ref",
      role: null,
      evidenceRef: null,
    });
  }

  const content = contentByMessageId.get(unit.messageId);
  if (content == null) {
    return withSessionMeta(
      {
        messageRef: unit.ref,
        quote: unit.text,
        messageId: null,
        validated: false,
        reason: "invalid_message_ref",
        role: unit.role,
        evidenceRef: null,
      },
      unit,
    );
  }

  const slice = content.slice(unit.charStartInMessage, unit.charEndInMessage);
  if (slice !== unit.text) {
    return withSessionMeta(
      {
        messageRef: unit.ref,
        quote: unit.text,
        messageId: unit.messageId,
        validated: false,
        reason: "quote_not_found",
        role: unit.role,
        evidenceRef: null,
      },
      unit,
    );
  }

  return withSessionMeta(
    {
      messageRef: unit.ref,
      quote: unit.text,
      messageId: unit.messageId,
      validated: true,
      reason: null,
      role: unit.role,
      evidenceRef: unit.ref,
    },
    unit,
  );
}

export function resolveEvidenceRefs(
  refs: string[],
  unitsByRef: Map<string, EvidenceUnit>,
  contentByMessageId: Map<string, string>,
  max?: number,
) {
  return limitEvidenceRefs(refs, max).map((ref) =>
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
