import {
  isAnalyzableEvidenceRole,
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

/**
 * 抽出対象は USER だけ。
 * EvidenceRef の Message 番号は Session 全体（user / assistant）の ordinal。
 * Assistant Message は番号を消費するが Unit にはしない。
 */
export function prepareUserEvidenceUnits(
  session: ConceptExtractSession,
): ConceptExtractUnit[] {
  const analyzable = session.messages.filter((message) =>
    isAnalyzableEvidenceRole(message.role),
  );
  const units: ConceptExtractUnit[] = [];

  for (const [messageIndex, message] of analyzable.entries()) {
    if (toEvidenceRole(message.role) !== "user") {
      continue;
    }
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

export function formatUserEvidenceUnitsForLlm(
  units: ConceptExtractUnit[],
): string {
  if (units.length === 0) {
    return "（USER Evidence Unit はありません）";
  }
  return units
    .map((unit) => `[${unit.evidenceRef}][USER] ${unit.text}`)
    .join("\n\n");
}

export function listRequiredEvidenceRefs(units: ConceptExtractUnit[]) {
  return units.map((unit) => unit.evidenceRef);
}
