import { isGenericDeniedConcept } from "./deny-list";
import { containsHonorificPerson } from "./honorific";
import { normalizeConceptKey, normalizeConceptLabel } from "./normalize";

export const MAX_ALIAS_CHARS = 16;

export const ALIAS_REJECTION_REASONS = [
  "empty",
  "generic_term",
  "honorific_person",
  "long_clause",
  "episodic_phrase",
  "too_divergent",
] as const;

export type AliasRejectionReason = (typeof ALIAS_REJECTION_REASONS)[number];

export type AliasValidation =
  | { ok: true; aliasLabel: string }
  | { ok: false; reason: AliasRejectionReason };

const EPISODIC_TASK =
  /(?:を送って|セッティング|してください|してほしい|お願い|プレゼントや)/u;

export function isLongClauseLabel(label: string) {
  const trimmed = normalizeConceptLabel(label);
  if (!trimmed) {
    return false;
  }
  if ([...trimmed].length > MAX_ALIAS_CHARS) {
    return true;
  }
  if (/[。！？]/.test(trimmed)) {
    return true;
  }
  return /(?:のに|こと)$/u.test(trimmed) && [...trimmed].length > 8;
}

export function isEpisodicPhrase(label: string) {
  const trimmed = normalizeConceptLabel(label);
  if (!trimmed) {
    return false;
  }
  if (EPISODIC_TASK.test(trimmed)) {
    return true;
  }
  return containsHonorificPerson(trimmed) && /(?:誕生日|予定|メッセージ)/u.test(trimmed);
}

export function isAliasTooDivergent(canonicalLabel: string, aliasLabel: string) {
  const canonical = normalizeConceptLabel(canonicalLabel);
  const alias = normalizeConceptLabel(aliasLabel);
  if (!canonical || !alias) {
    return false;
  }
  const canonicalLen = [...canonical].length;
  const aliasLen = [...alias].length;
  if (aliasLen <= 8) {
    return false;
  }
  return aliasLen > canonicalLen * 2;
}

export function validateAliasCandidate(
  aliasLabel: string,
  canonicalLabel?: string,
): AliasValidation {
  const normalized = normalizeConceptLabel(aliasLabel);
  if (!normalized || !normalizeConceptKey(aliasLabel)) {
    return { ok: false, reason: "empty" };
  }
  if (isGenericDeniedConcept(normalized)) {
    return { ok: false, reason: "generic_term" };
  }
  if (containsHonorificPerson(normalized)) {
    return { ok: false, reason: "honorific_person" };
  }
  if (isEpisodicPhrase(normalized)) {
    return { ok: false, reason: "episodic_phrase" };
  }
  if (isLongClauseLabel(normalized)) {
    return { ok: false, reason: "long_clause" };
  }
  if (canonicalLabel && isAliasTooDivergent(canonicalLabel, normalized)) {
    return { ok: false, reason: "too_divergent" };
  }
  return { ok: true, aliasLabel: normalized };
}
