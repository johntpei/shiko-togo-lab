import assert from "node:assert/strict";
import test from "node:test";
import type { ConceptExtractAction } from "./actions";
import {
  addConceptToCatalog,
  createCatalogEntry,
  emptyConceptCatalog,
  lookupCatalogByAlias,
} from "./catalog";
import { isHonorificPersonLabel } from "./honorific";
import { summarizeConceptResolve } from "./metrics";
import {
  resolveConceptActions,
  stableResolveResult,
  type ConceptResolveResult,
} from "./resolve";
import type { ConceptExtractUnit } from "./user-units";

function unit(
  overrides: Partial<ConceptExtractUnit> = {},
): ConceptExtractUnit {
  return {
    evidenceRef: "M001:E01",
    messageId: "msg-1",
    sessionId: "session-a",
    text: "高性能AIやAIの性能、距離感、自動化、ChatGPT、Claude、方法、田中さんについて同じ文で触れていますよ今",
    sourceCreatedAt: "2026-08-02T12:00:00.000Z",
    sessionOccurredAt: "2026-08-02",
    ...overrides,
  };
}

function resolve(input: {
  units?: ConceptExtractUnit[];
  catalog?: ReturnType<typeof emptyConceptCatalog>;
  actions: ConceptExtractAction[];
}) {
  const units = input.units ?? [unit()];
  return resolveConceptActions({
    units,
    catalog: input.catalog ?? emptyConceptCatalog(),
    actions: input.actions,
  });
}

function seededCatalog() {
  return {
    entries: [
      createCatalogEntry({
        ref: "C01",
        conceptId: "concept-ai-perf",
        canonicalLabel: "AI性能",
        aliases: ["高性能AI"],
      }),
      createCatalogEntry({
        ref: "C02",
        conceptId: "concept-distance",
        canonicalLabel: "距離感",
      }),
    ],
  };
}

test("NEW でも normalizedKey 完全一致なら既存 Concept へ MATCH し canonical は変えない", () => {
  const result = resolve({
    catalog: seededCatalog(),
    actions: [
      {
        action: "new",
        evidenceRef: "M001:E01",
        surfaceForm: "高性能AI",
        proposedCanonicalLabel: "AI 性能",
      },
    ],
  });
  assert.equal(result.newConcepts.length, 0);
  assert.equal(result.occurrences.length, 1);
  assert.equal(result.occurrences[0]?.resolvedAs, "match");
  assert.equal(result.occurrences[0]?.conceptId, "concept-ai-perf");
  assert.equal(result.occurrences[0]?.canonicalLabel, "AI性能");
  assert.equal(result.nextCatalog.entries[0]?.canonicalLabel, "AI性能");
});

test("alias 一致だけでは自動 MATCH しない", () => {
  const result = resolve({
    catalog: seededCatalog(),
    actions: [
      {
        action: "new",
        evidenceRef: "M001:E01",
        surfaceForm: "高性能AI",
        proposedCanonicalLabel: "高性能AI",
      },
    ],
  });
  assert.equal(result.newConcepts.length, 1);
  assert.equal(result.newConcepts[0]?.canonicalLabel, "高性能AI");
  assert.notEqual(result.newConcepts[0]?.conceptId, "concept-ai-perf");
  assert.equal(
    lookupCatalogByAlias(seededCatalog(), "高性能AI").map((entry) => entry.ref)
      .join(),
    "C01",
  );
});

test("NEW で surfaceForm が canonical と違う場合は surface を alias candidate にする", () => {
  const result = resolve({
    actions: [
      {
        action: "new",
        evidenceRef: "M001:E01",
        surfaceForm: "高性能AI",
        proposedCanonicalLabel: "AI性能",
      },
    ],
  });
  assert.deepEqual(result.newConcepts[0]?.aliases, ["高性能AI"]);
  assert.equal(result.aliasCandidates[0]?.aliasLabel, "高性能AI");
});

test("alias 重複は normalize して除去する", () => {
  const result = resolve({
    actions: [
      {
        action: "new",
        evidenceRef: "M001:E01",
        surfaceForm: "高性能AI",
        proposedCanonicalLabel: "AI性能",
        aliases: ["高性能AI", "高性能 AI", "AI性能"],
      },
    ],
  });
  assert.deepEqual(result.newConcepts[0]?.aliases, ["高性能AI"]);
});

test("同じ NEW canonical を 2 Unit が返しても Concept candidate は 1 件、Occurrence は 2 件", () => {
  const units = [
    unit({
      evidenceRef: "M001:E01",
      messageId: "msg-1",
      text: "高性能AIについて詳しく話したいと思っています",
    }),
    unit({
      evidenceRef: "M002:E01",
      messageId: "msg-2",
      text: "AIの性能についても同じセッションで触れていますよ",
    }),
  ];
  const result = resolve({
    units,
    actions: [
      {
        action: "new",
        evidenceRef: "M001:E01",
        surfaceForm: "高性能AI",
        proposedCanonicalLabel: "AI性能",
      },
      {
        action: "new",
        evidenceRef: "M002:E01",
        surfaceForm: "AIの性能",
        proposedCanonicalLabel: "AI性能",
      },
    ],
  });
  assert.equal(result.newConcepts.length, 1);
  assert.equal(result.occurrences.length, 2);
  assert.equal(result.occurrences[0]?.conceptId, result.occurrences[1]?.conceptId);
  assert.equal(result.occurrences[0]?.resolvedAs, "new");
  assert.equal(result.occurrences[1]?.resolvedAs, "new");
  assert.equal(
    result.newConcepts[0]?.aliases.includes("高性能AI") &&
      result.newConcepts[0]?.aliases.includes("AIの性能"),
    true,
  );
  const metrics = summarizeConceptResolve(units.length, result);
  assert.equal(metrics.new, 1);
  assert.equal(metrics.occurrences, 2);
  assert.equal(metrics.uniqueConceptCandidates, 1);
});

test("1 Unit から 4 件の有効 Concept が出れば 4 件目は max_concepts_per_unit", () => {
  const result = resolve({
    actions: [
      {
        action: "new",
        evidenceRef: "M001:E01",
        surfaceForm: "距離感",
        proposedCanonicalLabel: "距離感",
      },
      {
        action: "new",
        evidenceRef: "M001:E01",
        surfaceForm: "自動化",
        proposedCanonicalLabel: "自動化",
      },
      {
        action: "new",
        evidenceRef: "M001:E01",
        surfaceForm: "ChatGPT",
        proposedCanonicalLabel: "ChatGPT",
      },
      {
        action: "new",
        evidenceRef: "M001:E01",
        surfaceForm: "Claude",
        proposedCanonicalLabel: "Claude",
      },
    ],
  });
  assert.equal(result.occurrences.length, 3);
  assert.equal(result.newConcepts.length, 3);
  assert.equal(result.rejected.length, 1);
  assert.equal(result.rejected[0]?.reason, "max_concepts_per_unit");
  assert.deepEqual(
    result.occurrences.map((item) => item.canonicalLabel),
    ["距離感", "自動化", "ChatGPT"],
  );
});

test("同一 Unit の重複 Concept は整理したあと max3 を適用する", () => {
  const result = resolve({
    actions: [
      {
        action: "new",
        evidenceRef: "M001:E01",
        surfaceForm: "距離感",
        proposedCanonicalLabel: "距離感",
      },
      {
        action: "new",
        evidenceRef: "M001:E01",
        surfaceForm: "自動化",
        proposedCanonicalLabel: "自動化",
      },
      {
        action: "new",
        evidenceRef: "M001:E01",
        surfaceForm: "距離感",
        proposedCanonicalLabel: "距離感",
      },
      {
        action: "new",
        evidenceRef: "M001:E01",
        surfaceForm: "ChatGPT",
        proposedCanonicalLabel: "ChatGPT",
      },
      {
        action: "new",
        evidenceRef: "M001:E01",
        surfaceForm: "Claude",
        proposedCanonicalLabel: "Claude",
      },
    ],
  });
  assert.equal(result.occurrences.length, 3);
  assert.equal(
    result.rejected.filter((item) => item.reason === "duplicate_concept_in_unit")
      .length,
    1,
  );
  assert.equal(
    result.rejected.filter((item) => item.reason === "max_concepts_per_unit")
      .length,
    1,
  );
  assert.deepEqual(
    result.occurrences.map((item) => item.canonicalLabel),
    ["距離感", "自動化", "ChatGPT"],
  );
});

test("SKIP / UNCERTAIN / REJECTED を区別し、unknown ConceptRef は reject する", () => {
  const result = resolve({
    catalog: seededCatalog(),
    actions: [
      { action: "skip", evidenceRef: "M001:E01", surfaceForm: "方法" },
      { action: "uncertain", evidenceRef: "M001:E01", surfaceForm: "田中さん" },
      {
        action: "match",
        evidenceRef: "M001:E01",
        surfaceForm: "高性能AI",
        existingConceptRef: "C99",
      },
    ],
  });
  assert.equal(result.skipped.length, 1);
  assert.equal(result.uncertain.length, 1);
  assert.equal(result.rejected.length, 1);
  assert.equal(result.rejected[0]?.reason, "unknown_concept_ref");
  const metrics = summarizeConceptResolve(1, result);
  assert.equal(metrics.skip, 1);
  assert.equal(metrics.uncertain, 1);
  assert.equal(metrics.rejected, 1);
  assert.equal(metrics.match, 0);
});

test("provenance は Unit から Server が構築し AI action は決めない", () => {
  const withSource = unit({
    sourceCreatedAt: "2026-08-02T12:00:00.000Z",
    sessionOccurredAt: "2026-08-01",
  });
  const fallback = unit({
    evidenceRef: "M002:E01",
    messageId: "msg-2",
    sourceCreatedAt: null,
    sessionOccurredAt: "2026-08-01",
    text: "距離感について同じ文で触れていますよ今",
  });
  const result = resolve({
    units: [withSource, fallback],
    actions: [
      {
        action: "new",
        evidenceRef: "M001:E01",
        surfaceForm: "高性能AI",
        proposedCanonicalLabel: "AI性能",
      },
      {
        action: "new",
        evidenceRef: "M002:E01",
        surfaceForm: "距離感",
        proposedCanonicalLabel: "距離感",
      },
    ],
  });
  assert.equal(result.occurrences[0]?.messageId, "msg-1");
  assert.equal(result.occurrences[0]?.sessionId, "session-a");
  assert.equal(result.occurrences[0]?.sourceRole, "user");
  assert.equal(result.occurrences[0]?.sourceType, "evidence_unit");
  assert.equal(result.occurrences[0]?.occurredAt, "2026-08-02T12:00:00.000Z");
  assert.equal(result.occurrences[1]?.occurredAt, "2026-08-01");
  assert.equal(
    Object.prototype.hasOwnProperty.call(result.occurrences[0], "role"),
    false,
  );
});

test("generic / 結合 Concept は reject し Occurrence は validator を通る", () => {
  const result = resolve({
    actions: [
      {
        action: "new",
        evidenceRef: "M001:E01",
        surfaceForm: "方法",
        proposedCanonicalLabel: "方法",
      },
      {
        action: "new",
        evidenceRef: "M001:E01",
        surfaceForm: "自動化",
        proposedCanonicalLabel: "自動化と人間判断",
      },
      {
        action: "new",
        evidenceRef: "M001:E01",
        surfaceForm: "距離感",
        proposedCanonicalLabel: "距離感",
      },
    ],
  });
  assert.equal(
    result.rejected.filter((item) => item.reason === "invalid_candidate").length,
    2,
  );
  assert.equal(
    result.rejected.some((item) => item.detail === "generic_term"),
    true,
  );
  assert.equal(
    result.rejected.some((item) => item.detail === "compound_relation"),
    true,
  );
  assert.equal(result.occurrences.length, 1);
  assert.equal(result.occurrences[0]?.sourceRole, "user");
  assert.equal(result.occurrences[0]?.extractionVersion, "concept-extraction-v1");
});

test("敬称付きラベルは minimal heuristic で拒否し、普通の Concept は残す", () => {
  assert.equal(isHonorificPersonLabel("田中さん"), true);
  assert.equal(isHonorificPersonLabel("距離感"), false);
  assert.equal(isHonorificPersonLabel("皆さん"), false);
  const result = resolve({
    actions: [
      {
        action: "new",
        evidenceRef: "M001:E01",
        surfaceForm: "田中さん",
        proposedCanonicalLabel: "田中さん",
      },
      {
        action: "new",
        evidenceRef: "M001:E01",
        surfaceForm: "距離感",
        proposedCanonicalLabel: "距離感",
      },
    ],
  });
  assert.equal(result.rejected[0]?.reason, "honorific_person");
  assert.equal(result.occurrences[0]?.canonicalLabel, "距離感");
});

test("Session A の NEW を仮想 Catalog へ追加し Session B から MATCH できる", () => {
  const sessionA = resolve({
    units: [unit({ sessionId: "session-a" })],
    actions: [
      {
        action: "new",
        evidenceRef: "M001:E01",
        surfaceForm: "高性能AI",
        proposedCanonicalLabel: "AI性能",
      },
    ],
  });
  const created = sessionA.nextCatalog.entries[0];
  assert.ok(created);
  const sessionB = resolve({
    units: [
      unit({
        sessionId: "session-b",
        messageId: "msg-b",
        sessionOccurredAt: "2026-08-03",
      }),
    ],
    catalog: sessionA.nextCatalog,
    actions: [
      {
        action: "match",
        evidenceRef: "M001:E01",
        surfaceForm: "高性能AI",
        existingConceptRef: created.ref,
      },
    ],
  });
  assert.equal(sessionB.newConcepts.length, 0);
  assert.equal(sessionB.occurrences[0]?.resolvedAs, "match");
  assert.equal(sessionB.occurrences[0]?.conceptId, created.conceptId);
  assert.equal(sessionB.occurrences[0]?.canonicalLabel, "AI性能");
  assert.equal(sessionB.occurrences[0]?.sessionId, "session-b");
});

test("同じ入力と fake actions から同じ結果になる", () => {
  const input = {
    catalog: addConceptToCatalog(emptyConceptCatalog(), {
      conceptId: "concept-distance",
      canonicalLabel: "距離感",
    }),
    units: [unit()],
    actions: [
      {
        action: "new",
        evidenceRef: "M001:E01",
        surfaceForm: "高性能AI",
        proposedCanonicalLabel: "AI性能",
      },
      { action: "skip", evidenceRef: "M001:E01", surfaceForm: "方法" },
    ] satisfies ConceptExtractAction[],
  };
  const first: ConceptResolveResult = resolveConceptActions(input);
  const second: ConceptResolveResult = resolveConceptActions(input);
  assert.equal(stableResolveResult(first), stableResolveResult(second));
});

test("metrics は match / new / skip / uncertain / rejected を分けて集計する", () => {
  const result = resolve({
    catalog: seededCatalog(),
    actions: [
      {
        action: "match",
        evidenceRef: "M001:E01",
        surfaceForm: "距離感",
        existingConceptRef: "C02",
      },
      {
        action: "new",
        evidenceRef: "M001:E01",
        surfaceForm: "自動化",
        proposedCanonicalLabel: "自動化",
      },
      { action: "skip", evidenceRef: "M001:E01", surfaceForm: "方法" },
      { action: "uncertain", evidenceRef: "M001:E01", surfaceForm: "田中さん" },
      {
        action: "new",
        evidenceRef: "M001:E01",
        surfaceForm: "高性能AI",
        proposedCanonicalLabel: "方法",
      },
    ],
  });
  const metrics = summarizeConceptResolve(1, result);
  assert.equal(metrics.processedUnits, 1);
  assert.equal(metrics.match, 1);
  assert.equal(metrics.new, 1);
  assert.equal(metrics.skip, 1);
  assert.equal(metrics.uncertain, 1);
  assert.equal(metrics.rejected, 1);
  assert.equal(metrics.occurrences, 2);
  assert.equal(metrics.uniqueConceptCandidates, 2);
  assert.ok(metrics.rejectReasons["invalid_candidate:generic_term"]);
});
