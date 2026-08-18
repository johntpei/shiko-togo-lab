import { normalizeConceptKey } from "./normalize";

/**
 * hard deny は明確な generic 会話語だけ。
 * 製品名（ChatGPT / Claude）やテーマ語は含めない。
 * PII はこのリストでは扱わない。
 */
export const GENERIC_CONCEPT_DENY_TERMS = [
  "今日",
  "質問",
  "相談",
  "重要",
  "方法",
] as const;

const GENERIC_CONCEPT_DENY_KEYS = new Set(
  GENERIC_CONCEPT_DENY_TERMS.map((term) => normalizeConceptKey(term)),
);

export function isGenericDeniedConcept(label: string) {
  const key = normalizeConceptKey(label);
  if (!key) {
    return false;
  }
  return GENERIC_CONCEPT_DENY_KEYS.has(key);
}
