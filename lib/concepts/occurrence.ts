import { parseEvidenceRef } from "@/lib/ai/evidence-units";
import {
  CONCEPT_EXTRACTION_VERSION,
  CONCEPT_SOURCE_ROLES,
  CONCEPT_SOURCE_TYPES,
  type ConceptOccurrenceIdentity,
  type ConceptSourceRole,
  type ConceptSourceType,
} from "./types";

export const CONCEPT_OCCURRENCE_REJECTION_REASONS = [
  "missing_concept_id",
  "missing_session_id",
  "missing_message_id",
  "missing_occurred_at",
  "invalid_evidence_ref",
  "non_user_source_role",
  "unsupported_source_type",
  "unsupported_extraction_version",
] as const;

export type ConceptOccurrenceRejectionReason =
  (typeof CONCEPT_OCCURRENCE_REJECTION_REASONS)[number];

export type ConceptOccurrenceInput = {
  conceptId: string;
  sessionId: string;
  messageId: string;
  evidenceRef: string;
  occurredAt: string;
  sourceRole: string;
  sourceType: string;
  extractionVersion: string;
};

export type ConceptOccurrenceValidation =
  | {
      ok: true;
      sourceRole: ConceptSourceRole;
      sourceType: ConceptSourceType;
      extractionVersion: typeof CONCEPT_EXTRACTION_VERSION;
      identity: ConceptOccurrenceIdentity;
    }
  | {
      ok: false;
      reason: ConceptOccurrenceRejectionReason;
    };

export function conceptOccurrenceIdentity(
  input: Pick<
    ConceptOccurrenceInput,
    "extractionVersion" | "sourceType" | "messageId" | "evidenceRef" | "conceptId"
  >,
): ConceptOccurrenceIdentity {
  return {
    extractionVersion: input.extractionVersion,
    sourceType: input.sourceType,
    messageId: input.messageId,
    evidenceRef: input.evidenceRef,
    conceptId: input.conceptId,
  };
}

export function validateConceptOccurrence(
  input: ConceptOccurrenceInput,
): ConceptOccurrenceValidation {
  if (!input.conceptId.trim()) {
    return { ok: false, reason: "missing_concept_id" };
  }
  if (!input.sessionId.trim()) {
    return { ok: false, reason: "missing_session_id" };
  }
  if (!input.messageId.trim()) {
    return { ok: false, reason: "missing_message_id" };
  }
  if (!input.occurredAt.trim()) {
    return { ok: false, reason: "missing_occurred_at" };
  }
  if (!parseEvidenceRef(input.evidenceRef)) {
    return { ok: false, reason: "invalid_evidence_ref" };
  }
  if (
    !(CONCEPT_SOURCE_ROLES as readonly string[]).includes(input.sourceRole)
  ) {
    return { ok: false, reason: "non_user_source_role" };
  }
  if (
    !(CONCEPT_SOURCE_TYPES as readonly string[]).includes(input.sourceType)
  ) {
    return { ok: false, reason: "unsupported_source_type" };
  }
  if (input.extractionVersion !== CONCEPT_EXTRACTION_VERSION) {
    return { ok: false, reason: "unsupported_extraction_version" };
  }
  return {
    ok: true,
    sourceRole: input.sourceRole as ConceptSourceRole,
    sourceType: input.sourceType as ConceptSourceType,
    extractionVersion: CONCEPT_EXTRACTION_VERSION,
    identity: conceptOccurrenceIdentity(input),
  };
}
