import {
  parseEvidenceRef,
  toEvidenceRef,
  toUnitSuffix,
} from "@/lib/ai/evidence-units";
import {
  buildIntegratedReviewInput,
  type ReviewSessionSource,
} from "@/lib/ai/review-input";
import {
  conceptExtractUnitsByRef,
  prepareUserEvidenceUnits,
  type ConceptExtractSession,
} from "@/lib/concepts/user-units";

export type CanonicalEvidenceIdentity = {
  sessionId: string;
  messageId: string;
  evidenceOrdinal: number;
};

export const CANONICAL_EVIDENCE_REJECTION_REASONS = [
  "missing_evidence_ref",
  "malformed_ref",
  "noncanonical_ref",
  "session_ref_unresolved",
  "session_mismatch",
  "message_ref_unresolved",
  "message_mismatch",
  "evidence_ordinal_out_of_range",
  "unsupported_legacy_provenance",
] as const;

export type CanonicalEvidenceRejectionReason =
  (typeof CANONICAL_EVIDENCE_REJECTION_REASONS)[number];

export type CanonicalEvidenceResolution =
  | { ok: true; identity: CanonicalEvidenceIdentity }
  | { ok: false; reason: CanonicalEvidenceRejectionReason };

export type CanonicalEvidenceResolutionContext = {
  reviewSourcesByReviewId: Map<string, ReviewSessionSource[]>;
  conceptSessionsById: Map<string, ConceptExtractSession>;
};

type ProducerCoordinates = {
  sessionIndex: number | null;
  messageIndex: number;
  unitIndex: number;
};

function strictProducerCoordinates(
  evidenceRef: string | null | undefined,
  source: "observation" | "concept_occurrence",
):
  | { ok: true; coordinates: ProducerCoordinates }
  | { ok: false; reason: CanonicalEvidenceRejectionReason } {
  if (evidenceRef == null || evidenceRef === "") {
    return { ok: false, reason: "missing_evidence_ref" };
  }
  const parsed = parseEvidenceRef(evidenceRef);
  if (
    !parsed ||
    parsed.messageIndex < 0 ||
    parsed.unitIndex < 0 ||
    (parsed.sessionIndex != null && parsed.sessionIndex < 0)
  ) {
    return { ok: false, reason: "malformed_ref" };
  }
  if (source === "observation" && parsed.sessionIndex == null) {
    return { ok: false, reason: "unsupported_legacy_provenance" };
  }
  if (source === "concept_occurrence" && parsed.sessionIndex != null) {
    return { ok: false, reason: "unsupported_legacy_provenance" };
  }
  const serialized = toEvidenceRef({
    sessionIndex: parsed.sessionIndex ?? undefined,
    messageIndex: parsed.messageIndex,
    unitIndex: parsed.unitIndex,
  });
  if (serialized !== evidenceRef) {
    return { ok: false, reason: "noncanonical_ref" };
  }
  return { ok: true, coordinates: parsed };
}

export function canonicalEvidenceIdentityEquals(
  left: CanonicalEvidenceIdentity,
  right: CanonicalEvidenceIdentity,
) {
  return (
    left.sessionId === right.sessionId &&
    left.messageId === right.messageId &&
    left.evidenceOrdinal === right.evidenceOrdinal
  );
}

export function canonicalEvidenceIdentityKey(
  identity: CanonicalEvidenceIdentity,
) {
  return JSON.stringify([
    identity.sessionId,
    identity.messageId,
    identity.evidenceOrdinal,
  ]);
}

export function serializeCanonicalEvidenceLocalRef(evidenceOrdinal: number) {
  if (!Number.isSafeInteger(evidenceOrdinal) || evidenceOrdinal < 1) {
    throw new Error("evidenceOrdinal must be a positive safe integer");
  }
  return toUnitSuffix(evidenceOrdinal - 1);
}

export function resolveObservationEvidenceIdentity(input: {
  sourceReviewId: string;
  sessionId: string | null | undefined;
  messageId: string | null | undefined;
  evidenceRef: string | null | undefined;
  reviewSources: ReviewSessionSource[] | undefined;
}): CanonicalEvidenceResolution {
  const strict = strictProducerCoordinates(input.evidenceRef, "observation");
  if (!strict.ok) {
    return strict;
  }
  const sessionIndex = strict.coordinates.sessionIndex;
  if (sessionIndex == null) {
    return { ok: false, reason: "unsupported_legacy_provenance" };
  }
  if (!input.reviewSources || input.reviewSources.length === 0) {
    return { ok: false, reason: "session_ref_unresolved" };
  }

  const reviewInput = buildIntegratedReviewInput(input.reviewSources);
  const session = reviewInput.transportSessions[sessionIndex];
  if (!session) {
    return { ok: false, reason: "session_ref_unresolved" };
  }
  if (!input.sessionId || session.sessionId !== input.sessionId) {
    return { ok: false, reason: "session_mismatch" };
  }

  const message = session.messages[strict.coordinates.messageIndex];
  if (!message) {
    return { ok: false, reason: "message_ref_unresolved" };
  }
  const unit = message.units[strict.coordinates.unitIndex];
  if (!unit) {
    return { ok: false, reason: "evidence_ordinal_out_of_range" };
  }
  if (!input.messageId || unit.messageId !== input.messageId) {
    return { ok: false, reason: "message_mismatch" };
  }

  return {
    ok: true,
    identity: {
      sessionId: session.sessionId,
      messageId: unit.messageId,
      evidenceOrdinal: strict.coordinates.unitIndex + 1,
    },
  };
}

export function resolveConceptOccurrenceEvidenceIdentity(input: {
  sessionId: string;
  messageId: string;
  evidenceRef: string | null | undefined;
  session: ConceptExtractSession | undefined;
}): CanonicalEvidenceResolution {
  const strict = strictProducerCoordinates(
    input.evidenceRef,
    "concept_occurrence",
  );
  if (!strict.ok) {
    return strict;
  }
  if (!input.session || input.session.sessionId !== input.sessionId) {
    return { ok: false, reason: "session_ref_unresolved" };
  }

  const units = prepareUserEvidenceUnits(input.session);
  const unit = conceptExtractUnitsByRef(units).get(input.evidenceRef!);
  if (!unit) {
    const messageRefs = new Map(
      units.map((candidate) => [candidate.evidenceRef.split(":")[0], candidate]),
    );
    const messageRef = toEvidenceRef({
      messageIndex: strict.coordinates.messageIndex,
      unitIndex: 0,
    }).split(":")[0]!;
    const candidate = messageRefs.get(messageRef);
    if (!candidate) {
      return { ok: false, reason: "message_ref_unresolved" };
    }
    if (candidate.messageId !== input.messageId) {
      return { ok: false, reason: "message_mismatch" };
    }
    return { ok: false, reason: "evidence_ordinal_out_of_range" };
  }
  if (unit.messageId !== input.messageId) {
    return { ok: false, reason: "message_mismatch" };
  }

  return {
    ok: true,
    identity: {
      sessionId: input.sessionId,
      messageId: unit.messageId,
      evidenceOrdinal: strict.coordinates.unitIndex + 1,
    },
  };
}
