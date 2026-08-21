import { isEpisodicPhrase, isLongClauseLabel } from "./alias";
import { isGenericDeniedConcept } from "./deny-list";
import { containsHonorificPerson, isHonorificPersonLabel } from "./honorific";
import { normalizeConceptKey, normalizeConceptLabel } from "./normalize";
import type { ConceptRegistrySnapshot } from "./catalog";
import type {
  ConceptActionOutcome,
  ConceptOccurrenceOperation,
  ConceptProvisionalMatch,
} from "./resolve";

export const SUSPICIOUS_LONG_LABEL_CHARS = 12;
export const BROAD_SURFACE_LABELS = ["気持ち", "こと", "状態", "関係"] as const;

/** Prompt v4 評価用。hard reject には使わない。 */
export const REVIEW_GENERIC_SURFACES = [
  "気持ち",
  "ツール",
  "テーマ",
  "データ",
  "高性能",
  "設計",
  "状態",
  "方法",
  "こと",
  "関係",
  "感じ",
] as const;

export const REVIEW_ADJECTIVE_ONLY_SURFACES = [
  "論理的",
  "臨機応変",
  "高性能",
  "辛い",
  "怖い",
  "どうでもいい",
] as const;

/** unique Concept / USER Units が極端に高い Session を review 対象にする。hard reject ではない。 */
export const SESSION_OVER_EXTRACTION_SOFT_MAX = 8;
export const SESSION_OVER_EXTRACTION_UNIQUE_MIN = 12;
export const SESSION_OVER_EXTRACTION_RATIO = 0.5;

export type SessionUnitCount = {
  sessionId: string;
  userUnitCount: number;
};

export function isSessionOverExtraction(
  uniqueConcepts: number,
  userUnitCount: number,
) {
  if (uniqueConcepts >= SESSION_OVER_EXTRACTION_UNIQUE_MIN) {
    return true;
  }
  if (userUnitCount <= 0) {
    return false;
  }
  return (
    uniqueConcepts > SESSION_OVER_EXTRACTION_SOFT_MAX &&
    uniqueConcepts / userUnitCount >= SESSION_OVER_EXTRACTION_RATIO
  );
}

const CLAUSE_LIKE_TAIL =
  /(?:すること|したい欲求|しんどい状況|状況|方法)$/u;

export function isBroadSurface(label: string) {
  const key = normalizeConceptKey(label);
  return BROAD_SURFACE_LABELS.some(
    (item) => normalizeConceptKey(item) === key,
  );
}

export function isReviewGenericSurface(label: string) {
  const key = normalizeConceptKey(label);
  if (!key) {
    return false;
  }
  return REVIEW_GENERIC_SURFACES.some(
    (item) => normalizeConceptKey(item) === key,
  );
}

export function isAdjectiveOnlySurface(label: string) {
  const key = normalizeConceptKey(label);
  if (!key) {
    return false;
  }
  return REVIEW_ADJECTIVE_ONLY_SURFACES.some(
    (item) => normalizeConceptKey(item) === key,
  );
}

export function isClauseLikeLabel(label: string) {
  if (isLongClauseLabel(label)) {
    return true;
  }
  const trimmed = normalizeConceptLabel(label);
  if (!trimmed) {
    return false;
  }
  const len = [...trimmed].length;
  if (len >= 5 && /こと$/u.test(trimmed)) {
    return true;
  }
  if (len >= 8 && /欲求$/u.test(trimmed)) {
    return true;
  }
  return len >= 6 && CLAUSE_LIKE_TAIL.test(trimmed);
}

export type SuspiciousFinding = {
  kind:
    | "long_label"
    | "honorific_person"
    | "generic_deny"
    | "singleton_new"
    | "normalized_key_containment"
    | "alias_canonical_collision"
    | "canonical_surface_divergence"
    | "canonical_over_generalized"
    | "alias_honorific_person"
    | "alias_long_clause"
    | "episodic_phrase"
    | "semantic_provisional_match"
    | "semantic_lexical_gap"
    | "broad_surface_specific_canonical"
    | "surface_canonical_grain_mismatch"
    | "generic_surface"
    | "adjective_only"
    | "clause_like"
    | "session_over_extraction";
  conceptRef?: string;
  otherRef?: string;
  label?: string;
  detail?: string;
};

export function isCanonicalSurfaceDivergence(
  surfaceForm: string,
  canonicalLabel: string,
) {
  const surface = normalizeConceptLabel(surfaceForm);
  const canonical = normalizeConceptLabel(canonicalLabel);
  if (!surface || !canonical) {
    return false;
  }
  const surfaceKey = normalizeConceptKey(surface);
  const canonicalKey = normalizeConceptKey(canonical);
  if (surfaceKey === canonicalKey) {
    return false;
  }
  const contained =
    surfaceKey.includes(canonicalKey) || canonicalKey.includes(surfaceKey);
  if (contained) {
    return false;
  }
  const surfaceLen = [...surface].length;
  const canonicalLen = [...canonical].length;
  const longer = Math.max(surfaceLen, canonicalLen);
  const shorter = Math.min(surfaceLen, canonicalLen);
  const ratioHigh = longer >= 4 && shorter > 0 && longer / shorter >= 1.8;
  return ratioHigh || longestCommonSubstring(surfaceKey, canonicalKey) < 2;
}

function longestCommonSubstring(left: string, right: string) {
  let max = 0;
  for (let i = 0; i < left.length; i += 1) {
    for (let j = 0; j < right.length; j += 1) {
      let k = 0;
      while (
        i + k < left.length &&
        j + k < right.length &&
        left[i + k] === right[j + k]
      ) {
        k += 1;
      }
      if (k > max) {
        max = k;
      }
    }
  }
  return max;
}

const GRAMMATICAL_REMAINDER =
  /^(?:を|が|は|て|に|と|で|こと|している|感じている)+$/u;

export function isCanonicalOverGeneralized(
  surfaceForm: string,
  canonicalLabel: string,
) {
  const surfaceKey = normalizeConceptKey(surfaceForm);
  const canonicalKey = normalizeConceptKey(canonicalLabel);
  if (!surfaceKey || !canonicalKey || surfaceKey === canonicalKey) {
    return false;
  }
  if (!surfaceKey.includes(canonicalKey)) {
    return false;
  }
  const remainder = surfaceKey.replace(canonicalKey, "");
  if (!remainder || GRAMMATICAL_REMAINDER.test(remainder)) {
    return false;
  }
  if (surfaceKey.endsWith(canonicalKey) && remainder.endsWith("の")) {
    return remainder.length >= 3;
  }
  return surfaceKey.endsWith(canonicalKey) && remainder.length >= 2;
}

export function detectSuspiciousConcepts(input: {
  catalog: ConceptRegistrySnapshot;
  occurrences: ConceptOccurrenceOperation[];
  outcomes?: ConceptActionOutcome[];
  provisionalMatches?: ConceptProvisionalMatch[];
  sessionUnitCounts?: SessionUnitCount[];
}): SuspiciousFinding[] {
  const findings: SuspiciousFinding[] = [];
  const occurrenceCount = new Map<string, Set<string>>();
  for (const occurrence of input.occurrences) {
    const refs = occurrenceCount.get(occurrence.conceptId) ?? new Set<string>();
    refs.add(`${occurrence.sessionId}:${occurrence.evidenceRef}`);
    occurrenceCount.set(occurrence.conceptId, refs);
  }

  for (const entry of input.catalog.entries) {
    if ([...entry.canonicalLabel].length > SUSPICIOUS_LONG_LABEL_CHARS) {
      findings.push({
        kind: "long_label",
        conceptRef: entry.ref,
        label: entry.canonicalLabel,
        detail: `>${SUSPICIOUS_LONG_LABEL_CHARS}`,
      });
    }
    if (isHonorificPersonLabel(entry.canonicalLabel)) {
      findings.push({
        kind: "honorific_person",
        conceptRef: entry.ref,
        label: entry.canonicalLabel,
      });
    }
    if (isGenericDeniedConcept(entry.canonicalLabel)) {
      findings.push({
        kind: "generic_deny",
        conceptRef: entry.ref,
        label: entry.canonicalLabel,
      });
    }
    if (isEpisodicPhrase(entry.canonicalLabel)) {
      findings.push({
        kind: "episodic_phrase",
        conceptRef: entry.ref,
        label: entry.canonicalLabel,
      });
    }
    if (isReviewGenericSurface(entry.canonicalLabel)) {
      findings.push({
        kind: "generic_surface",
        conceptRef: entry.ref,
        label: entry.canonicalLabel,
      });
    }
    if (isAdjectiveOnlySurface(entry.canonicalLabel)) {
      findings.push({
        kind: "adjective_only",
        conceptRef: entry.ref,
        label: entry.canonicalLabel,
      });
    }
    if (isClauseLikeLabel(entry.canonicalLabel)) {
      findings.push({
        kind: "clause_like",
        conceptRef: entry.ref,
        label: entry.canonicalLabel,
      });
    }
    const units = occurrenceCount.get(entry.conceptId);
    if (!units || units.size <= 1) {
      findings.push({
        kind: "singleton_new",
        conceptRef: entry.ref,
        label: entry.canonicalLabel,
      });
    }
    for (const alias of entry.aliases) {
      if (containsHonorificPerson(alias)) {
        findings.push({
          kind: "alias_honorific_person",
          conceptRef: entry.ref,
          label: alias,
        });
      }
      if (isLongClauseLabel(alias)) {
        findings.push({
          kind: "alias_long_clause",
          conceptRef: entry.ref,
          label: alias,
        });
      }
      if (isEpisodicPhrase(alias)) {
        findings.push({
          kind: "episodic_phrase",
          conceptRef: entry.ref,
          label: alias,
        });
      }
    }
  }

  for (const outcome of input.outcomes ?? []) {
    if (
      outcome.status !== "accepted" ||
      !outcome.canonicalLabel ||
      !outcome.surfaceForm ||
      !outcome.conceptRef
    ) {
      continue;
    }
    if (
      isCanonicalSurfaceDivergence(outcome.surfaceForm, outcome.canonicalLabel)
    ) {
      findings.push({
        kind: "canonical_surface_divergence",
        conceptRef: outcome.conceptRef,
        label: `${outcome.surfaceForm} → ${outcome.canonicalLabel}`,
      });
    }
    if (
      isCanonicalOverGeneralized(outcome.surfaceForm, outcome.canonicalLabel)
    ) {
      findings.push({
        kind: "canonical_over_generalized",
        conceptRef: outcome.conceptRef,
        label: `${outcome.surfaceForm} → ${outcome.canonicalLabel}`,
      });
    }
  }

  for (let i = 0; i < input.catalog.entries.length; i += 1) {
    const left = input.catalog.entries[i]!;
    for (let j = i + 1; j < input.catalog.entries.length; j += 1) {
      const right = input.catalog.entries[j]!;
      if (
        left.normalizedKey.length >= 2 &&
        right.normalizedKey.length >= 2 &&
        (left.normalizedKey.includes(right.normalizedKey) ||
          right.normalizedKey.includes(left.normalizedKey))
      ) {
        findings.push({
          kind: "normalized_key_containment",
          conceptRef: left.ref,
          otherRef: right.ref,
          label: `${left.canonicalLabel} / ${right.canonicalLabel}`,
        });
      }
    }
  }

  const canonicalByKey = new Map(
    input.catalog.entries.map((entry) => [entry.normalizedKey, entry]),
  );
  for (const entry of input.catalog.entries) {
    for (const alias of entry.aliases) {
      const key = normalizeConceptKey(alias);
      const hit = canonicalByKey.get(key);
      if (hit && hit.conceptId !== entry.conceptId) {
        findings.push({
          kind: "alias_canonical_collision",
          conceptRef: entry.ref,
          otherRef: hit.ref,
          label: alias,
        });
      }
    }
  }

  for (const item of input.provisionalMatches ?? []) {
    findings.push({
      kind: "semantic_provisional_match",
      conceptRef: item.candidateConceptRef,
      label: `${item.surfaceForm} → ${item.existingCanonicalLabel}`,
      detail: item.evidenceRef,
    });
    if (
      isCanonicalSurfaceDivergence(item.surfaceForm, item.existingCanonicalLabel)
    ) {
      findings.push({
        kind: "semantic_lexical_gap",
        conceptRef: item.candidateConceptRef,
        label: `${item.surfaceForm} → ${item.existingCanonicalLabel}`,
        detail: item.evidenceRef,
      });
    }
    if (
      isBroadSurface(item.surfaceForm) &&
      normalizeConceptKey(item.surfaceForm) !==
        normalizeConceptKey(item.existingCanonicalLabel)
    ) {
      findings.push({
        kind: "broad_surface_specific_canonical",
        conceptRef: item.candidateConceptRef,
        label: `${item.surfaceForm} → ${item.existingCanonicalLabel}`,
        detail: item.evidenceRef,
      });
    }
    if (
      isCanonicalOverGeneralized(
        item.existingCanonicalLabel,
        item.surfaceForm,
      ) ||
      isCanonicalOverGeneralized(item.surfaceForm, item.existingCanonicalLabel)
    ) {
      findings.push({
        kind: "surface_canonical_grain_mismatch",
        conceptRef: item.candidateConceptRef,
        label: `${item.surfaceForm} → ${item.existingCanonicalLabel}`,
        detail: item.evidenceRef,
      });
    }
  }

  const uniqueBySession = new Map<string, Set<string>>();
  for (const occurrence of input.occurrences) {
    const ids = uniqueBySession.get(occurrence.sessionId) ?? new Set<string>();
    ids.add(occurrence.conceptId);
    uniqueBySession.set(occurrence.sessionId, ids);
  }
  for (const session of input.sessionUnitCounts ?? []) {
    const uniqueConcepts = uniqueBySession.get(session.sessionId)?.size ?? 0;
    if (isSessionOverExtraction(uniqueConcepts, session.userUnitCount)) {
      findings.push({
        kind: "session_over_extraction",
        label: session.sessionId,
        detail: `unique=${uniqueConcepts}/units=${session.userUnitCount}`,
      });
    }
  }

  return findings;
}
