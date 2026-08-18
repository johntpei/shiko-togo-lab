/**
 * Concept 照合キーの決定論的正規化。
 * 意味的な同一視（高性能AI → AI性能）は行わない。
 */
export function normalizeConceptKey(input: string) {
  const nfkc = input.normalize("NFKC");
  const trimmed = nfkc.trim();
  const spaced = trimmed.replace(/\s+/gu, " ");
  const compact = spaced.replace(/ /g, "");
  return lowerLatin(compact);
}

export function normalizeConceptLabel(input: string) {
  return input.normalize("NFKC").trim().replace(/\s+/gu, " ");
}

function lowerLatin(value: string) {
  return value.replace(/[A-Z]/g, (char) => char.toLowerCase());
}
