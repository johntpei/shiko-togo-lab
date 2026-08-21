import {
  splitMessageIntoEvidenceUnits,
  toEvidenceRef,
  toEvidenceRole,
} from "@/lib/ai/evidence-units";

export type ConceptExtractMessage = {
  id: string;
  role: string;
  content: string;
  sourceCreatedAt?: string | null;
};

export type ConceptExtractSession = {
  sessionId: string;
  occurredAt: string;
  messages: ConceptExtractMessage[];
};

/**
 * Concept extraction 用の USER Evidence Unit。
 * provenance はここから Server が確定する。AI action からは受け取らない。
 */
export type ConceptExtractUnit = {
  evidenceRef: string;
  messageId: string;
  sessionId: string;
  text: string;
  sourceCreatedAt: string | null;
  sessionOccurredAt: string;
};

export function prepareUserEvidenceUnits(
  session: ConceptExtractSession,
): ConceptExtractUnit[] {
  const userMessages = session.messages.filter(
    (message) => toEvidenceRole(message.role) === "user",
  );
  const units: ConceptExtractUnit[] = [];

  for (const [messageIndex, message] of userMessages.entries()) {
    const slices = splitMessageIntoEvidenceUnits(message.content);
    for (const [unitIndex, slice] of slices.entries()) {
      const sourceCreatedAt = message.sourceCreatedAt?.trim() || null;
      units.push({
        evidenceRef: toEvidenceRef({ messageIndex, unitIndex }),
        messageId: message.id,
        sessionId: session.sessionId,
        text: slice.text,
        sourceCreatedAt,
        sessionOccurredAt: session.occurredAt,
      });
    }
  }

  return units;
}

export function conceptExtractUnitsByRef(
  units: ConceptExtractUnit[],
): Map<string, ConceptExtractUnit> {
  return new Map(units.map((unit) => [unit.evidenceRef, unit]));
}
