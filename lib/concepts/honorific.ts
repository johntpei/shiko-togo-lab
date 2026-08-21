import { normalizeConceptLabel } from "./normalize";

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
