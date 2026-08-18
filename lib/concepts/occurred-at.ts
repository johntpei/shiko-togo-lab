/**
 * ConceptOccurrence.occurredAt の思考時刻。
 * 分析日 / Review 日 / Observation detectedAt は使わない。
 */
export function conceptThoughtOccurredAt(input: {
  sourceCreatedAt?: string | null;
  sessionOccurredAt: string;
}) {
  const fromMessage = input.sourceCreatedAt?.trim();
  if (fromMessage) {
    return fromMessage;
  }
  return input.sessionOccurredAt;
}
