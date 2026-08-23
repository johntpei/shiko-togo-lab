import type { ConceptRegistrySnapshot } from "@/lib/concepts/catalog";
import { createCatalogEntry } from "@/lib/concepts/catalog";
import type { ConceptQueryDb } from "@/lib/db/concept-queries";
import { conceptAliases, concepts } from "@/lib/db/schema";

export type IncrementalRegistryConcept = {
  id: string;
  canonicalLabel: string;
  normalizedKey: string;
};

export type IncrementalRegistryAlias = {
  conceptId: string;
  aliasLabel: string;
  normalizedAlias: string;
};

function byId(left: string, right: string) {
  return left.localeCompare(right);
}

/**
 * DB row / fixture から Identity Kernel が使う Registry snapshot を作る。
 * 新しい normalizer は使わない。
 */
export function conceptRegistrySnapshotFromState(input: {
  concepts: IncrementalRegistryConcept[];
  aliases?: IncrementalRegistryAlias[];
}): ConceptRegistrySnapshot {
  const aliases = [...(input.aliases ?? [])].sort((left, right) => {
    const concept = byId(left.conceptId, right.conceptId);
    if (concept !== 0) {
      return concept;
    }
    return left.normalizedAlias.localeCompare(right.normalizedAlias);
  });
  const conceptsSorted = [...input.concepts].sort((left, right) =>
    byId(left.id, right.id),
  );
  return {
    entries: conceptsSorted.map((concept) =>
      createCatalogEntry({
        ref: concept.id,
        conceptId: concept.id,
        canonicalLabel: concept.canonicalLabel,
        aliases: aliases
          .filter((alias) => alias.conceptId === concept.id)
          .map((alias) => alias.aliasLabel),
      }),
    ),
  };
}

/**
 * Read-only SELECT のみ。insert / update / transaction write はしない。
 */
export function loadConceptRegistrySnapshot(
  db: ConceptQueryDb,
): ConceptRegistrySnapshot {
  const conceptRows = db.select().from(concepts).all();
  const aliasRows = db.select().from(conceptAliases).all();
  return conceptRegistrySnapshotFromState({
    concepts: conceptRows.map((row) => ({
      id: row.id,
      canonicalLabel: row.canonicalLabel,
      normalizedKey: row.normalizedKey,
    })),
    aliases: aliasRows.map((row) => ({
      conceptId: row.conceptId,
      aliasLabel: row.aliasLabel,
      normalizedAlias: row.normalizedAlias,
    })),
  });
}
