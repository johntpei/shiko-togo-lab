import { isGenericDeniedConcept } from "./deny-list";
import { isHonorificPersonLabel } from "./honorific";
import { normalizeConceptKey } from "./normalize";
import type { ConceptRegistrySnapshot } from "./catalog";
import type { ConceptOccurrenceOperation } from "./resolve";

export const SUSPICIOUS_LONG_LABEL_CHARS = 12;

export type SuspiciousFinding = {
  kind:
    | "long_label"
    | "honorific_person"
    | "generic_deny"
    | "singleton_new"
    | "normalized_key_containment"
    | "alias_canonical_collision";
  conceptRef?: string;
  otherRef?: string;
  label?: string;
  detail?: string;
};

export function detectSuspiciousConcepts(input: {
  catalog: ConceptRegistrySnapshot;
  occurrences: ConceptOccurrenceOperation[];
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
    const units = occurrenceCount.get(entry.conceptId);
    if (!units || units.size <= 1) {
      findings.push({
        kind: "singleton_new",
        conceptRef: entry.ref,
        label: entry.canonicalLabel,
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

  return findings;
}
