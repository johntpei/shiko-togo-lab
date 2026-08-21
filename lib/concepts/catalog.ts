import { MAX_PROPOSED_ALIASES } from "./actions";
import { validateAliasCandidate } from "./alias";
import { normalizeConceptKey, normalizeConceptLabel } from "./normalize";

export type ConceptCatalogEntry = {
  ref: string;
  conceptId: string;
  canonicalLabel: string;
  normalizedKey: string;
  aliases: string[];
};

/**
 * DB に依存しない Registry snapshot。
 * 3C-1b の virtual registry / Session 間 MATCH に使う。
 */
export type ConceptRegistrySnapshot = {
  entries: ConceptCatalogEntry[];
};

export function emptyConceptCatalog(): ConceptRegistrySnapshot {
  return { entries: [] };
}

export function cloneConceptCatalog(
  catalog: ConceptRegistrySnapshot,
): ConceptRegistrySnapshot {
  return {
    entries: catalog.entries.map((entry) => ({
      ...entry,
      aliases: [...entry.aliases],
    })),
  };
}

export function virtualConceptId(normalizedKey: string) {
  return `virtual:${normalizedKey}`;
}

export function nextCatalogRef(catalog: ConceptRegistrySnapshot) {
  return `C${String(catalog.entries.length + 1).padStart(2, "0")}`;
}

export function createCatalogEntry(input: {
  ref: string;
  conceptId: string;
  canonicalLabel: string;
  aliases?: string[];
}): ConceptCatalogEntry {
  return {
    ref: input.ref,
    conceptId: input.conceptId,
    canonicalLabel: input.canonicalLabel,
    normalizedKey: normalizeConceptKey(input.canonicalLabel),
    aliases: uniqueAliasLabels(input.canonicalLabel, input.aliases ?? []),
  };
}

export function lookupCatalogByRef(
  catalog: ConceptRegistrySnapshot,
  ref: string,
) {
  return catalog.entries.find((entry) => entry.ref === ref);
}

export function lookupCatalogByNormalizedKey(
  catalog: ConceptRegistrySnapshot,
  normalizedKey: string,
) {
  return catalog.entries.find((entry) => entry.normalizedKey === normalizedKey);
}

/**
 * alias 完全一致は Identity の補助情報。自動 MATCH には使わない。
 * 同一 alias を複数 Concept が持つ場合は複数件返す。
 */
export function lookupCatalogByAlias(
  catalog: ConceptRegistrySnapshot,
  aliasLabel: string,
): ConceptCatalogEntry[] {
  const key = normalizeConceptKey(aliasLabel);
  if (!key) {
    return [];
  }
  return catalog.entries.filter((entry) =>
    entry.aliases.some((alias) => normalizeConceptKey(alias) === key),
  );
}

export function uniqueAliasLabels(canonicalLabel: string, labels: string[]) {
  const canonicalKey = normalizeConceptKey(canonicalLabel);
  const seen = new Set<string>(canonicalKey ? [canonicalKey] : []);
  const aliases: string[] = [];
  for (const label of labels) {
    const normalized = normalizeConceptLabel(label);
    const key = normalizeConceptKey(label);
    if (!normalized || !key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    aliases.push(normalized);
  }
  return aliases;
}

export function collectAliasCandidates(input: {
  canonicalLabel: string;
  proposedAliases?: string[];
}): {
  accepted: string[];
  rejected: Array<{ aliasLabel: string; reason: string }>;
} {
  const proposed = (input.proposedAliases ?? []).slice(0, MAX_PROPOSED_ALIASES);
  const accepted: string[] = [];
  const rejected: Array<{ aliasLabel: string; reason: string }> = [];
  for (const raw of uniqueAliasLabels(input.canonicalLabel, proposed)) {
    const check = validateAliasCandidate(raw, input.canonicalLabel);
    if (!check.ok) {
      rejected.push({ aliasLabel: raw, reason: check.reason });
      continue;
    }
    accepted.push(check.aliasLabel);
  }
  return { accepted, rejected };
}

export function addConceptToCatalog(
  catalog: ConceptRegistrySnapshot,
  input: {
    conceptId: string;
    canonicalLabel: string;
    aliases?: string[];
  },
): ConceptRegistrySnapshot {
  const next = cloneConceptCatalog(catalog);
  const normalizedKey = normalizeConceptKey(input.canonicalLabel);
  const existing = lookupCatalogByNormalizedKey(next, normalizedKey);
  if (existing) {
    existing.aliases = uniqueAliasLabels(existing.canonicalLabel, [
      ...existing.aliases,
      ...(input.aliases ?? []),
    ]);
    return next;
  }
  next.entries.push(
    createCatalogEntry({
      ref: nextCatalogRef(next),
      conceptId: input.conceptId,
      canonicalLabel: input.canonicalLabel,
      aliases: input.aliases,
    }),
  );
  return next;
}

export function addAliasesToCatalog(
  catalog: ConceptRegistrySnapshot,
  conceptId: string,
  aliases: string[],
): ConceptRegistrySnapshot {
  const next = cloneConceptCatalog(catalog);
  const existing = next.entries.find((entry) => entry.conceptId === conceptId);
  if (!existing) {
    return next;
  }
  existing.aliases = uniqueAliasLabels(existing.canonicalLabel, [
    ...existing.aliases,
    ...aliases,
  ]);
  return next;
}

export function lookupCatalogByConceptId(
  catalog: ConceptRegistrySnapshot,
  conceptId: string,
) {
  return catalog.entries.find((entry) => entry.conceptId === conceptId);
}

export function formatConceptCatalogForLlm(
  catalog: ConceptRegistrySnapshot,
): string {
  if (catalog.entries.length === 0) {
    return "（まだ Concept はありません）";
  }
  return catalog.entries
    .map((entry) => {
      if (entry.aliases.length === 0) {
        return `${entry.ref} | ${entry.canonicalLabel}`;
      }
      return `${entry.ref} | ${entry.canonicalLabel} | aliases: ${entry.aliases.join(", ")}`;
    })
    .join("\n");
}
