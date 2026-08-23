import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { applySqlMigrations } from "@/lib/db/client";
import {
  countConceptAliases,
  countConceptOccurrences,
  countConcepts,
  insertConcept,
  insertConceptAlias,
} from "@/lib/db/concept-queries";
import * as schema from "@/lib/db/schema";
import { CONCEPT_EXTRACTION_VERSION } from "@/lib/concepts/types";
import { createCatalogEntry } from "@/lib/concepts/catalog";
import {
  planIncrementalConceptCandidates,
  stableIncrementalPlan,
  type IncrementalGroundedCandidate,
} from "./plan";
import {
  conceptRegistrySnapshotFromState,
  loadConceptRegistrySnapshot,
} from "./registry";

const HUMAN_ID = "concept-human-relations";
const AI_ID = "concept-high-perf-ai";

function candidate(
  overrides: Partial<IncrementalGroundedCandidate> &
    Pick<IncrementalGroundedCandidate, "candidateRef" | "canonicalLabel" | "surfaceForm">,
): IncrementalGroundedCandidate {
  return {
    sessionId: "session-a",
    messageId: "msg-a",
    evidenceRef: "M001:E01",
    occurredAt: "2026-07-15",
    sourceRole: "user",
    sourceType: "evidence_unit",
    extractionVersion: CONCEPT_EXTRACTION_VERSION,
    ...overrides,
  };
}

function seededRegistry() {
  return {
    entries: [
      createCatalogEntry({
        ref: HUMAN_ID,
        conceptId: HUMAN_ID,
        canonicalLabel: "人間関係",
      }),
      createCatalogEntry({
        ref: AI_ID,
        conceptId: AI_ID,
        canonicalLabel: "高性能AI",
      }),
    ],
  };
}

function openMemoryDb() {
  const sqlite = new Database(":memory:");
  applySqlMigrations(sqlite);
  sqlite.pragma("foreign_keys = ON");
  return drizzle(sqlite, { schema });
}

test("A. exact canonical は existing_match で同じ Concept ID へ解決する", () => {
  const result = planIncrementalConceptCandidates(
    [
      candidate({
        candidateRef: "C20",
        canonicalLabel: "人間関係",
        surfaceForm: "人間関係",
      }),
    ],
    seededRegistry(),
  );
  assert.equal(result.plans.length, 1);
  const plan = result.plans[0];
  assert.equal(plan?.kind, "existing_match");
  if (plan?.kind !== "existing_match") {
    return;
  }
  assert.equal(plan.conceptId, HUMAN_ID);
  assert.equal(plan.matchReason, "exact_canonical");
  assert.equal(plan.canonicalLabel, "人間関係");
  assert.equal(plan.normalizedKey, "人間関係");
  assert.equal(plan.candidateRef, "C20");
});

test("B. 既存 normalization 後に同一なら exact canonical", () => {
  const result = planIncrementalConceptCandidates(
    [
      candidate({
        candidateRef: "C20b",
        canonicalLabel: "人間関係",
        surfaceForm: " 人間 関係 ",
      }),
      candidate({
        candidateRef: "C42b",
        canonicalLabel: "高性能AI",
        surfaceForm: "高性能ＡＩ",
        sessionId: "session-b",
        messageId: "msg-b",
        evidenceRef: "M001:E01",
        occurredAt: "2026-08-02",
      }),
    ],
    seededRegistry(),
  );
  assert.deepEqual(
    result.plans.map((item) => item.kind),
    ["existing_match", "existing_match"],
  );
  assert.equal(
    result.plans[0]?.kind === "existing_match" && result.plans[0].conceptId,
    HUMAN_ID,
  );
  assert.equal(
    result.plans[1]?.kind === "existing_match" && result.plans[1].matchReason,
    "exact_canonical",
  );
  assert.equal(
    result.plans[1]?.kind === "existing_match" && result.plans[1].conceptId,
    AI_ID,
  );
});

test("C. unique observed alias は existing_match", () => {
  const registry = {
    entries: [
      createCatalogEntry({
        ref: HUMAN_ID,
        conceptId: HUMAN_ID,
        canonicalLabel: "人間関係",
        aliases: ["対人関係"],
      }),
    ],
  };
  const result = planIncrementalConceptCandidates(
    [
      candidate({
        candidateRef: "C20a",
        canonicalLabel: "対人関係",
        surfaceForm: "対人関係",
      }),
    ],
    registry,
  );
  const plan = result.plans[0];
  assert.equal(plan?.kind, "existing_match");
  if (plan?.kind !== "existing_match") {
    return;
  }
  assert.equal(plan.matchReason, "unique_observed_alias");
  assert.equal(plan.conceptId, HUMAN_ID);
  assert.equal(plan.canonicalLabel, "人間関係");
});

test("D. ambiguous alias は confirmed existing match にしない", () => {
  const registry = {
    entries: [
      createCatalogEntry({
        ref: HUMAN_ID,
        conceptId: HUMAN_ID,
        canonicalLabel: "人間関係",
        aliases: ["つながり"],
      }),
      createCatalogEntry({
        ref: "concept-trust",
        conceptId: "concept-trust",
        canonicalLabel: "信頼関係",
        aliases: ["つながり"],
      }),
    ],
  };
  const result = planIncrementalConceptCandidates(
    [
      candidate({
        candidateRef: "C99",
        canonicalLabel: "つながり",
        surfaceForm: "つながり",
      }),
    ],
    registry,
  );
  assert.equal(result.plans[0]?.kind, "new");
  assert.equal(
    result.plans[0]?.kind === "existing_match",
    false,
  );
});

test("E. confirmed match が無ければ new", () => {
  const result = planIncrementalConceptCandidates(
    [
      candidate({
        candidateRef: "C38",
        canonicalLabel: "寂しさ",
        surfaceForm: "寂しさ",
      }),
    ],
    seededRegistry(),
  );
  const plan = result.plans[0];
  assert.equal(plan?.kind, "new");
  if (plan?.kind !== "new") {
    return;
  }
  assert.equal(plan.canonicalLabel, "寂しさ");
  assert.equal(plan.provenance.evidenceRef, "M001:E01");
  assert.equal(plan.provenance.sessionId, "session-a");
  assert.equal(plan.provenance.messageId, "msg-a");
  assert.equal(plan.provenance.occurredAt, "2026-07-15");
  assert.equal(plan.provenance.extractionVersion, CONCEPT_EXTRACTION_VERSION);
});

test("F. semantic provisional は existing Concept へ attach しない", () => {
  const result = planIncrementalConceptCandidates(
    [
      candidate({
        candidateRef: "C38",
        canonicalLabel: "寂しさ",
        surfaceForm: "寂しさ",
        matchKind: "semantic",
        resolvedAs: "new",
        provisional: {
          conceptId: HUMAN_ID,
          existingCanonicalLabel: "人間関係",
        },
      }),
    ],
    seededRegistry(),
  );
  const plan = result.plans[0];
  assert.equal(plan?.kind, "provisional_new");
  if (plan?.kind !== "provisional_new") {
    return;
  }
  assert.equal(plan.provisionalReason, "semantic");
  assert.equal(plan.provisionalConceptId, HUMAN_ID);
  assert.equal(plan.canonicalLabel, "寂しさ");
  assert.notEqual(plan.canonicalLabel, "人間関係");
});

test("exact canonical は semantic hint より優先し、ambiguous+semantic は provisional_new", () => {
  const exact = planIncrementalConceptCandidates(
    [
      candidate({
        candidateRef: "C20",
        canonicalLabel: "人間関係",
        surfaceForm: "人間関係",
        matchKind: "semantic",
        provisional: { conceptId: AI_ID, existingCanonicalLabel: "高性能AI" },
      }),
    ],
    seededRegistry(),
  );
  assert.equal(exact.plans[0]?.kind, "existing_match");
  if (exact.plans[0]?.kind === "existing_match") {
    assert.equal(exact.plans[0].conceptId, HUMAN_ID);
    assert.equal(exact.plans[0].matchReason, "exact_canonical");
  }

  const ambiguous = {
    entries: [
      createCatalogEntry({
        ref: HUMAN_ID,
        conceptId: HUMAN_ID,
        canonicalLabel: "人間関係",
        aliases: ["つながり"],
      }),
      createCatalogEntry({
        ref: "concept-trust",
        conceptId: "concept-trust",
        canonicalLabel: "信頼関係",
        aliases: ["つながり"],
      }),
    ],
  };
  const provisional = planIncrementalConceptCandidates(
    [
      candidate({
        candidateRef: "C99",
        canonicalLabel: "つながり",
        surfaceForm: "つながり",
        matchKind: "semantic",
        provisional: { conceptId: HUMAN_ID, existingCanonicalLabel: "人間関係" },
      }),
    ],
    ambiguous,
  );
  assert.equal(provisional.plans[0]?.kind, "provisional_new");
});

test("G. 同一 Evidence の複数 Candidate は collapse しない", () => {
  const result = planIncrementalConceptCandidates(
    [
      candidate({
        candidateRef: "C20",
        canonicalLabel: "人間関係",
        surfaceForm: "人間関係",
      }),
      candidate({
        candidateRef: "C42",
        canonicalLabel: "高性能AI",
        surfaceForm: "高性能AI",
      }),
    ],
    seededRegistry(),
  );
  assert.equal(result.plans.length, 2);
  assert.equal(result.plans[0]?.candidateRef, "C20");
  assert.equal(result.plans[1]?.candidateRef, "C42");
  assert.equal(result.plans[0]?.provenance.evidenceRef, "M001:E01");
  assert.equal(result.plans[1]?.provenance.evidenceRef, "M001:E01");
  assert.equal(result.plans[0]?.kind, "existing_match");
  assert.equal(result.plans[1]?.kind, "existing_match");
});

test("H. 同じ input + Registry なら Plan は決定論的", () => {
  const input = [
    candidate({
      candidateRef: "C20",
      canonicalLabel: "人間関係",
      surfaceForm: "人間関係",
    }),
    candidate({
      candidateRef: "C38",
      canonicalLabel: "寂しさ",
      surfaceForm: "寂しさ",
      matchKind: "semantic" as const,
      provisional: { conceptId: HUMAN_ID },
    }),
  ];
  const registry = seededRegistry();
  const first = planIncrementalConceptCandidates(input, registry);
  const second = planIncrementalConceptCandidates(input, registry);
  assert.equal(stableIncrementalPlan(first), stableIncrementalPlan(second));
  assert.deepEqual(first, second);
});

test("I. planner / snapshot load は DB counts を変えない", () => {
  const db = openMemoryDb();
  insertConcept(
    {
      id: HUMAN_ID,
      canonicalLabel: "人間関係",
      createdAt: "2026-08-18T00:00:00.000Z",
    },
    db,
  );
  insertConceptAlias(
    { conceptId: HUMAN_ID, aliasLabel: "対人関係" },
    db,
  );
  const before = {
    concepts: countConcepts(db),
    aliases: countConceptAliases(db),
    occurrences: countConceptOccurrences(db),
  };
  const snapshot = loadConceptRegistrySnapshot(db);
  const fromState = conceptRegistrySnapshotFromState({
    concepts: [
      {
        id: HUMAN_ID,
        canonicalLabel: "人間関係",
        normalizedKey: "人間関係",
      },
    ],
    aliases: [
      {
        conceptId: HUMAN_ID,
        aliasLabel: "対人関係",
        normalizedAlias: "対人関係",
      },
    ],
  });
  assert.equal(snapshot.entries[0]?.conceptId, fromState.entries[0]?.conceptId);
  planIncrementalConceptCandidates(
    [
      candidate({
        candidateRef: "C20",
        canonicalLabel: "人間関係",
        surfaceForm: "人間関係",
      }),
      candidate({
        candidateRef: "C20a",
        canonicalLabel: "対人関係",
        surfaceForm: "対人関係",
      }),
    ],
    snapshot,
  );
  assert.deepEqual(
    {
      concepts: countConcepts(db),
      aliases: countConceptAliases(db),
      occurrences: countConceptOccurrences(db),
    },
    before,
  );
});

test("planner は write / LLM / Initial Apply / Calibration に依存しない", () => {
  const sources = [
    "lib/concepts/incremental/plan.ts",
    "lib/concepts/incremental/registry.ts",
  ].map((path) => readFileSync(resolve(process.cwd(), path), "utf8"));
  for (const source of sources) {
    assert.doesNotMatch(source, /insertConcept/);
    assert.doesNotMatch(source, /insertConceptOccurrence/);
    assert.doesNotMatch(source, /insertConceptAlias/);
    assert.doesNotMatch(source, /applyInitialAdmissionManifest/);
    assert.doesNotMatch(source, /getDb\(/);
    assert.doesNotMatch(source, /openai/);
    assert.doesNotMatch(source, /from "\.\.\/admission\/calibration"/);
    assert.doesNotMatch(source, /from "\.\/calibration"/);
    assert.doesNotMatch(source, /負の連鎖/);
    assert.doesNotMatch(source, /POLICY_NAMED_OR_HIGH/);
    assert.doesNotMatch(source, /evaluateInitialRegistryGate/);
  }
});
