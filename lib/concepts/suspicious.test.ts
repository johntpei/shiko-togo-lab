import assert from "node:assert/strict";
import test from "node:test";
import { createCatalogEntry } from "./catalog";
import { detectSuspiciousConcepts } from "./suspicious";
import { CONCEPT_EXTRACTION_VERSION } from "./types";

test("長い label / singleton NEW / prefix / alias 衝突を検出する", () => {
  const catalog = {
    entries: [
      createCatalogEntry({
        ref: "C01",
        conceptId: "c-ai",
        canonicalLabel: "AI",
      }),
      createCatalogEntry({
        ref: "C02",
        conceptId: "c-ai-perf",
        canonicalLabel: "AI性能についての非常に長いラベル",
        aliases: ["距離感"],
      }),
      createCatalogEntry({
        ref: "C03",
        conceptId: "c-distance",
        canonicalLabel: "距離感",
      }),
    ],
  };
  const findings = detectSuspiciousConcepts({
    catalog,
    occurrences: [
      {
        type: "occurrence",
        resolvedAs: "new",
        conceptId: "c-ai",
        canonicalLabel: "AI",
        sessionId: "s1",
        messageId: "m1",
        evidenceRef: "M001:E01",
        occurredAt: "2026-08-02",
        sourceRole: "user",
        sourceType: "evidence_unit",
        extractionVersion: CONCEPT_EXTRACTION_VERSION,
      },
    ],
  });
  assert.equal(
    findings.some((item) => item.kind === "long_label"),
    true,
  );
  assert.equal(
    findings.some((item) => item.kind === "singleton_new"),
    true,
  );
  assert.equal(
    findings.some((item) => item.kind === "normalized_key_containment"),
    true,
  );
  assert.equal(
    findings.some((item) => item.kind === "alias_canonical_collision"),
    true,
  );
});
