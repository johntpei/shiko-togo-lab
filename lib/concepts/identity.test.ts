import assert from "node:assert/strict";
import test from "node:test";
import { classifyServerIdentity } from "./identity";
import { createCatalogEntry } from "./catalog";

function catalog() {
  return {
    entries: [
      createCatalogEntry({
        ref: "C01",
        conceptId: "c-perf",
        canonicalLabel: "AI性能",
        aliases: ["高性能AI"],
      }),
      createCatalogEntry({
        ref: "C02",
        conceptId: "c-distance",
        canonicalLabel: "距離感",
      }),
    ],
  };
}

test("exact は canonical normalizedKey 完全一致", () => {
  const result = classifyServerIdentity(catalog(), "AI性能");
  assert.equal(result.kind, "exact");
  if (result.kind === "exact") {
    assert.equal(result.entry.ref, "C01");
  }
});

test("unique observed alias は確定可能", () => {
  const result = classifyServerIdentity(catalog(), "高性能AI");
  assert.equal(result.kind, "observed_alias");
  if (result.kind === "observed_alias") {
    assert.equal(result.entry.ref, "C01");
  }
});

test("ambiguous alias は確定しない", () => {
  const ambiguous = {
    entries: [
      createCatalogEntry({
        ref: "C01",
        conceptId: "c-1",
        canonicalLabel: "AI性能",
        aliases: ["高性能AI"],
      }),
      createCatalogEntry({
        ref: "C02",
        conceptId: "c-2",
        canonicalLabel: "推論速度",
        aliases: ["高性能AI"],
      }),
    ],
  };
  assert.equal(classifyServerIdentity(ambiguous, "高性能AI").kind, "ambiguous_alias");
});

test("文字列が一致しなければ none（semantic は Server 確定しない）", () => {
  assert.equal(classifyServerIdentity(catalog(), "寂しさ").kind, "none");
});
