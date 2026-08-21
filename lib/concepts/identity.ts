import {
  lookupCatalogByAlias,
  lookupCatalogByNormalizedKey,
  type ConceptCatalogEntry,
  type ConceptRegistrySnapshot,
} from "./catalog";
import { normalizeConceptKey } from "./normalize";

export const CONCEPT_MATCH_KINDS = [
  "exact",
  "observed_alias",
  "semantic",
] as const;

export type ConceptMatchKind = (typeof CONCEPT_MATCH_KINDS)[number];

export type ServerIdentity =
  | { kind: "exact"; entry: ConceptCatalogEntry }
  | { kind: "observed_alias"; entry: ConceptCatalogEntry }
  | { kind: "ambiguous_alias" }
  | { kind: "none" };

/**
 * LLM の semantic 判断より先に、文字列だけで確定できる Identity。
 * exact と一意な observed alias だけを自動確定する。
 */
export function classifyServerIdentity(
  catalog: ConceptRegistrySnapshot,
  surfaceForm: string,
): ServerIdentity {
  const key = normalizeConceptKey(surfaceForm);
  if (!key) {
    return { kind: "none" };
  }
  const exact = lookupCatalogByNormalizedKey(catalog, key);
  if (exact) {
    return { kind: "exact", entry: exact };
  }
  const aliases = lookupCatalogByAlias(catalog, surfaceForm);
  if (aliases.length === 1) {
    return { kind: "observed_alias", entry: aliases[0]! };
  }
  if (aliases.length > 1) {
    return { kind: "ambiguous_alias" };
  }
  return { kind: "none" };
}
