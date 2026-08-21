import assert from "node:assert/strict";
import test from "node:test";
import {
  addConceptToCatalog,
  createCatalogEntry,
  emptyConceptCatalog,
  formatConceptCatalogForLlm,
  lookupCatalogByAlias,
  lookupCatalogByNormalizedKey,
} from "./catalog";

test("同じ alias を複数 Concept が持てる。自動 MATCH はしない", () => {
  const catalog = {
    entries: [
      createCatalogEntry({
        ref: "C01",
        conceptId: "concept-1",
        canonicalLabel: "AI性能",
        aliases: ["高性能AI"],
      }),
      createCatalogEntry({
        ref: "C02",
        conceptId: "concept-2",
        canonicalLabel: "推論速度",
        aliases: ["高性能AI"],
      }),
    ],
  };
  const hits = lookupCatalogByAlias(catalog, "高性能AI");
  assert.equal(hits.length, 2);
  assert.deepEqual(
    hits.map((entry) => entry.ref),
    ["C01", "C02"],
  );
  assert.equal(lookupCatalogByNormalizedKey(catalog, "高性能ai"), undefined);
});

test("virtual catalog へ NEW 相当を追加できる", () => {
  const next = addConceptToCatalog(emptyConceptCatalog(), {
    conceptId: "virtual:ai性能",
    canonicalLabel: "AI性能",
    aliases: ["高性能AI"],
  });
  assert.equal(next.entries[0]?.ref, "C01");
  assert.equal(next.entries[0]?.normalizedKey, "ai性能");
  assert.deepEqual(next.entries[0]?.aliases, ["高性能AI"]);
});

test("LLM catalog は ConceptRef と canonical と aliases だけを渡す", () => {
  const catalog = {
    entries: [
      createCatalogEntry({
        ref: "C01",
        conceptId: "virtual:ai性能",
        canonicalLabel: "AI性能",
        aliases: ["高性能AI"],
      }),
    ],
  };
  const labeled = formatConceptCatalogForLlm(catalog);
  assert.equal(labeled, "C01 | AI性能 | aliases: 高性能AI");
  assert.doesNotMatch(labeled, /virtual:/);
  assert.equal(formatConceptCatalogForLlm(emptyConceptCatalog()), "（まだ Concept はありません）");
});
