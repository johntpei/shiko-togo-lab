import { normalizeConceptLabel } from "./normalize";

const HONORIFIC_TOKEN = /([^\s、。，]{1,12}(?:さん|くん|ちゃん|様))/gu;
const HONORIFIC_SUFFIX = /(さん|くん|ちゃん|様)$/u;
const HONORIFIC_ALLOWLIST = new Set(["皆さん", "みなさん"]);

/**
 * 明らかな敬称付きラベルだけを拒否する minimal heuristic。
 * 人名推定を一般化して普通の Concept を落とさない。
 */
export function isHonorificPersonLabel(label: string) {
  const trimmed = normalizeConceptLabel(label);
  if (!trimmed || HONORIFIC_ALLOWLIST.has(trimmed)) {
    return false;
  }
  return HONORIFIC_SUFFIX.test(trimmed);
}

/** 敬称付き個人名を句の途中に含む場合（alias / surface 用）。 */
export function containsHonorificPerson(label: string) {
  const trimmed = normalizeConceptLabel(label);
  if (!trimmed) {
    return false;
  }
  for (const match of trimmed.matchAll(HONORIFIC_TOKEN)) {
    const token = match[1];
    if (token && !HONORIFIC_ALLOWLIST.has(token)) {
      return true;
    }
  }
  return false;
}
