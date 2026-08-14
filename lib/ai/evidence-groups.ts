/**
 * Cross-session Evidence grouping.
 * Pass 1（clustering）と Pass 2（synthesis）へ将来分離できるよう、生成ロジックから独立させる。
 */

export const REVIEW_RELATION_TYPES = [
  "repetition",
  "contrast",
  "complement",
  "progression",
] as const;

export type ReviewRelationType = (typeof REVIEW_RELATION_TYPES)[number];

export type EvidenceGroup = {
  sessionRef: string;
  evidenceRefs: string[];
};

export function sessionRefFromEvidenceRef(ref: string) {
  const match = ref.trim().match(/^(S\d+):/);
  return match?.[1] ?? null;
}

export function flattenEvidenceGroups(groups: EvidenceGroup[]) {
  const seen = new Set<string>();
  const refs: string[] = [];
  for (const group of groups) {
    for (const ref of group.evidenceRefs) {
      const trimmed = ref.trim();
      if (trimmed && !seen.has(trimmed)) {
        seen.add(trimmed);
        refs.push(trimmed);
      }
    }
  }
  return refs;
}

export function distinctSessionRefsFromGroups(groups: EvidenceGroup[]) {
  const refs = new Set<string>();
  for (const group of groups) {
    const fromField = group.sessionRef.trim();
    if (fromField) {
      refs.add(fromField);
    }
    for (const evidenceRef of group.evidenceRefs) {
      const fromRef = sessionRefFromEvidenceRef(evidenceRef);
      if (fromRef) {
        refs.add(fromRef);
      }
    }
  }
  return [...refs];
}

export function mergeGroupedEvidenceRefs(
  groups?: EvidenceGroup[] | null,
  evidenceRefs?: string[] | null,
) {
  const fromGroups = groups?.length ? flattenEvidenceGroups(groups) : [];
  const fromRefs = (evidenceRefs ?? []).map((ref) => ref.trim()).filter(Boolean);
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const ref of [...fromGroups, ...fromRefs]) {
    if (!seen.has(ref)) {
      seen.add(ref);
      merged.push(ref);
    }
  }
  return merged;
}
