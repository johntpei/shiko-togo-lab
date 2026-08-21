import assert from "node:assert/strict";
import test from "node:test";
import { createCatalogEntry } from "./catalog";
import { isGenericDeniedConcept } from "./deny-list";
import {
  detectSuspiciousConcepts,
  isAdjectiveOnlySurface,
  isCanonicalOverGeneralized,
  isCanonicalSurfaceDivergence,
  isClauseLikeLabel,
  isReviewGenericSurface,
  isSessionOverExtraction,
} from "./suspicious";
import type { ConceptOccurrenceOperation } from "./resolve";
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
    outcomes: [
      {
        originalAction: "new",
        evidenceRef: "M001:E01",
        surfaceForm: "第2の脳",
        status: "accepted",
        conceptRef: "C02",
        canonicalLabel: "自己管理システム",
      },
      {
        originalAction: "new",
        evidenceRef: "M002:E01",
        surfaceForm: "ADHDの記憶力",
        status: "accepted",
        conceptRef: "C03",
        canonicalLabel: "記憶力",
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

test("canonical/surface 乖離と modifier 脱落を suspicious にする", () => {
  const catalog = {
    entries: [
      createCatalogEntry({
        ref: "C01",
        conceptId: "c-brain",
        canonicalLabel: "自己管理システム",
        aliases: ["マエさんの誕生日", "相手のためを思ってやっているのに"],
      }),
      createCatalogEntry({
        ref: "C02",
        conceptId: "c-memory",
        canonicalLabel: "記憶力",
      }),
    ],
  };
  const findings = detectSuspiciousConcepts({
    catalog,
    occurrences: [
      {
        type: "occurrence",
        resolvedAs: "new",
        conceptId: "c-brain",
        canonicalLabel: "自己管理システム",
        sessionId: "s1",
        messageId: "m1",
        evidenceRef: "M001:E01",
        occurredAt: "2026-08-02",
        sourceRole: "user",
        sourceType: "evidence_unit",
        extractionVersion: CONCEPT_EXTRACTION_VERSION,
      },
    ],
    outcomes: [
      {
        originalAction: "new",
        evidenceRef: "M001:E01",
        surfaceForm: "第2の脳",
        status: "accepted",
        conceptRef: "C01",
        canonicalLabel: "自己管理システム",
      },
      {
        originalAction: "new",
        evidenceRef: "M002:E01",
        surfaceForm: "ADHDの記憶力",
        status: "accepted",
        conceptRef: "C02",
        canonicalLabel: "記憶力",
      },
    ],
  });
  assert.equal(
    findings.some((item) => item.kind === "canonical_surface_divergence"),
    true,
  );
  assert.equal(
    findings.some((item) => item.kind === "canonical_over_generalized"),
    true,
  );
  assert.equal(
    findings.some((item) => item.kind === "alias_honorific_person"),
    true,
  );
  assert.equal(
    findings.some((item) => item.kind === "alias_long_clause"),
    true,
  );
  assert.equal(
    findings.some((item) => item.kind === "singleton_new"),
    true,
  );
  assert.equal(
    findings.some((item) => item.kind === "normalized_key_containment"),
    false,
  );
});

test("canonical/surface heuristic は最小変換を落とさない", () => {
  assert.equal(isCanonicalSurfaceDivergence("第2の脳", "自己管理システム"), true);
  assert.equal(
    isCanonicalSurfaceDivergence("何も思っていなくて", "他者への無関心"),
    true,
  );
  assert.equal(isCanonicalSurfaceDivergence("高性能AI", "AI性能"), false);
  assert.equal(isCanonicalSurfaceDivergence("第2の脳", "第2の脳"), false);
  assert.equal(isCanonicalOverGeneralized("ADHDの記憶力", "記憶力"), true);
  assert.equal(isCanonicalOverGeneralized("統合支援ツール", "支援ツール"), true);
  assert.equal(
    isCanonicalOverGeneralized("寂しさを感じている", "寂しさ"),
    false,
  );
});

test("Prompt v4 評価用に generic / adjective / clause を review 検出する", () => {
  assert.equal(isReviewGenericSurface("気持ち"), true);
  assert.equal(isReviewGenericSurface("ツール"), true);
  assert.equal(isReviewGenericSurface("テーマ"), true);
  assert.equal(isReviewGenericSurface("データ"), true);
  assert.equal(isReviewGenericSurface("高性能"), true);
  assert.equal(isReviewGenericSurface("人間関係"), false);
  assert.equal(isReviewGenericSurface("他者モデル構築"), false);
  assert.equal(isGenericDeniedConcept("気持ち"), false);
  assert.equal(isGenericDeniedConcept("ツール"), false);
  assert.equal(isGenericDeniedConcept("高性能"), false);
  assert.equal(isAdjectiveOnlySurface("論理的"), true);
  assert.equal(isAdjectiveOnlySurface("臨機応変"), true);
  assert.equal(isAdjectiveOnlySurface("辛い"), true);
  assert.equal(isAdjectiveOnlySurface("人間関係"), false);
  assert.equal(isClauseLikeLabel("一生を1人で過ごすこと"), true);
  assert.equal(isClauseLikeLabel("精神的にもしんどい状況"), true);
  assert.equal(isClauseLikeLabel("連鎖から抜け出す方法"), true);
  assert.equal(isClauseLikeLabel("恐ろしいこと"), true);
  assert.equal(isClauseLikeLabel("負の連鎖"), false);
  assert.equal(isClauseLikeLabel("人間関係"), false);

  const catalog = {
    entries: [
      createCatalogEntry({
        ref: "C01",
        conceptId: "c-feel",
        canonicalLabel: "気持ち",
      }),
      createCatalogEntry({
        ref: "C02",
        conceptId: "c-logic",
        canonicalLabel: "論理的",
      }),
      createCatalogEntry({
        ref: "C03",
        conceptId: "c-clause",
        canonicalLabel: "一生を1人で過ごすこと",
      }),
      createCatalogEntry({
        ref: "C04",
        conceptId: "c-rel",
        canonicalLabel: "人間関係",
      }),
    ],
  };
  const findings = detectSuspiciousConcepts({
    catalog,
    occurrences: [],
  });
  assert.equal(
    findings.some(
      (item) => item.kind === "generic_surface" && item.label === "気持ち",
    ),
    true,
  );
  assert.equal(
    findings.some(
      (item) => item.kind === "adjective_only" && item.label === "論理的",
    ),
    true,
  );
  assert.equal(
    findings.some(
      (item) =>
        item.kind === "clause_like" && item.label === "一生を1人で過ごすこと",
    ),
    true,
  );
  assert.equal(
    findings.some(
      (item) => item.kind === "generic_surface" && item.label === "人間関係",
    ),
    false,
  );
});

test("semantic provisional match を lexical gap / broad surface として出す", () => {
  const catalog = {
    entries: [
      createCatalogEntry({
        ref: "C01",
        conceptId: "c-feel",
        canonicalLabel: "人の気持ちを考えられない",
      }),
    ],
  };
  const findings = detectSuspiciousConcepts({
    catalog,
    occurrences: [],
    provisionalMatches: [
      {
        type: "provisional_match",
        kind: "semantic",
        evidenceRef: "M007:E01",
        surfaceForm: "ADHDの記憶力",
        candidateConceptRef: "C01",
        existingCanonicalLabel: "人の気持ちを考えられない",
      },
      {
        type: "provisional_match",
        kind: "semantic",
        evidenceRef: "M001:E03",
        surfaceForm: "気持ち",
        candidateConceptRef: "C01",
        existingCanonicalLabel: "人の気持ちを考えられない",
      },
    ],
  });
  assert.equal(
    findings.filter((item) => item.kind === "semantic_provisional_match").length,
    2,
  );
  assert.equal(
    findings.some((item) => item.kind === "semantic_lexical_gap"),
    true,
  );
  assert.equal(
    findings.some((item) => item.kind === "broad_surface_specific_canonical"),
    true,
  );
});

test("session_over_extraction は unique/units が極端に高いときだけ review する", () => {
  assert.equal(isSessionOverExtraction(20, 24), true);
  assert.equal(isSessionOverExtraction(12, 24), true);
  assert.equal(isSessionOverExtraction(10, 16), true);
  assert.equal(isSessionOverExtraction(8, 24), false);
  assert.equal(isSessionOverExtraction(6, 24), false);
  assert.equal(isSessionOverExtraction(9, 24), false);
  assert.equal(isAdjectiveOnlySurface("怖い"), true);

  const occurrence = (
    conceptId: string,
    evidenceRef: string,
  ): ConceptOccurrenceOperation => ({
    type: "occurrence",
    resolvedAs: "new",
    conceptId,
    canonicalLabel: conceptId,
    sessionId: "080a113a",
    messageId: "m1",
    evidenceRef,
    occurredAt: "2026-07-15",
    sourceRole: "user",
    sourceType: "evidence_unit",
    extractionVersion: CONCEPT_EXTRACTION_VERSION,
  });

  const over = detectSuspiciousConcepts({
    catalog: { entries: [] },
    occurrences: Array.from({ length: 20 }, (_, index) =>
      occurrence(`c-${index}`, `M001:E${String(index + 1).padStart(2, "0")}`),
    ),
    sessionUnitCounts: [{ sessionId: "080a113a", userUnitCount: 24 }],
  });
  assert.equal(
    over.some(
      (item) =>
        item.kind === "session_over_extraction" &&
        item.label === "080a113a" &&
        item.detail === "unique=20/units=24",
    ),
    true,
  );

  const under = detectSuspiciousConcepts({
    catalog: { entries: [] },
    occurrences: Array.from({ length: 6 }, (_, index) =>
      occurrence(`c-${index}`, `M001:E${String(index + 1).padStart(2, "0")}`),
    ),
    sessionUnitCounts: [{ sessionId: "080a113a", userUnitCount: 24 }],
  });
  assert.equal(
    under.some((item) => item.kind === "session_over_extraction"),
    false,
  );
});
