import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { CONCEPT_EXTRACT_PROMPT_VERSION } from "@/lib/ai/prompts/concept-extract";
import { CONCEPT_EXTRACTION_VERSION } from "@/lib/concepts/types";
import { applySqlMigrations } from "@/lib/db/client";
import {
  countConceptAliases,
  countConceptOccurrences,
  countConcepts,
  insertConcept,
} from "@/lib/db/concept-queries";
import * as schema from "@/lib/db/schema";
import type { EligibilityGatedIncrementalSessionResult } from "./eligible-session-plan";
import type { ExistingMatchPlan, IncrementalConceptPlan } from "./plan";
import {
  buildExistingMatchAppendIntent,
  existingMatchPlansFromGatedResult,
  freezeExistingMatchAppendIntent,
  intentToExistingMatchPlans,
  loadExistingMatchAppendIntent,
} from "./append-intent";

const SESSION_ID = "session-intent";
const HUMAN_ID = "concept-parents";
const ALIAS_ID = "concept-alias-target";
const USER =
  "SECRET_USER_BODY_INTENT_両親のことを何度も思い出してしまった。";
const EVIDENCE_FULL =
  "SECRET_EVIDENCE_FULL_このUnit全文はIntentへコピーしてはいけない。";
const RAW_LLM = "SECRET_RAW_LLM_OUTPUT_should_not_appear";
const SURFACE = "両親";
const ALIAS_SURFACE = "親たち";

const SOURCE = {
  model: "test-model",
  promptVersion: CONCEPT_EXTRACT_PROMPT_VERSION,
  extractionVersion: CONCEPT_EXTRACTION_VERSION,
  coverageSourceHash: "coverage-hash-fixture",
};

function openMemoryDb() {
  const sqlite = new Database(":memory:");
  applySqlMigrations(sqlite);
  sqlite.pragma("foreign_keys = ON");
  return drizzle(sqlite, { schema });
}

function counts(db: ReturnType<typeof openMemoryDb>) {
  return {
    concepts: countConcepts(db),
    aliases: countConceptAliases(db),
    occurrences: countConceptOccurrences(db),
    sessions: db.select().from(schema.sessions).all().length,
    messages: db.select().from(schema.messages).all().length,
  };
}

function exactPlan(overrides: Partial<ExistingMatchPlan> = {}): ExistingMatchPlan {
  return {
    kind: "existing_match",
    candidateRef: `${HUMAN_ID}:M001:E02:0`,
    conceptId: HUMAN_ID,
    matchReason: "exact_canonical",
    canonicalLabel: SURFACE,
    normalizedKey: SURFACE,
    provenance: {
      sessionId: SESSION_ID,
      messageId: `${SESSION_ID}-u`,
      evidenceRef: "M001:E02",
      occurredAt: "2026-07-13T00:00:00.000Z",
      surfaceForm: SURFACE,
      sourceRole: "user",
      sourceType: "evidence_unit",
      extractionVersion: CONCEPT_EXTRACTION_VERSION,
    },
    ...overrides,
  };
}

function aliasPlan(): ExistingMatchPlan {
  return {
    kind: "existing_match",
    candidateRef: `${ALIAS_ID}:M001:E01:0`,
    conceptId: ALIAS_ID,
    matchReason: "unique_observed_alias",
    canonicalLabel: "家族",
    normalizedKey: "家族",
    provenance: {
      sessionId: SESSION_ID,
      messageId: `${SESSION_ID}-u`,
      evidenceRef: "M001:E01",
      occurredAt: "2026-07-13T00:00:00.000Z",
      surfaceForm: ALIAS_SURFACE,
      sourceRole: "user",
      sourceType: "evidence_unit",
      extractionVersion: CONCEPT_EXTRACTION_VERSION,
    },
  };
}

function provisionalPlan(): IncrementalConceptPlan {
  return {
    kind: "provisional_new",
    candidateRef: "virtual:adhd:M001:E03:1",
    canonicalLabel: "ADHD",
    normalizedKey: "adhd",
    provisionalConceptId: "concept-adhd-memory",
    provisionalReason: "semantic",
    provenance: exactPlan().provenance,
  };
}

function newPlan(): IncrementalConceptPlan {
  return {
    kind: "new",
    candidateRef: "virtual:new:M001:E04:2",
    canonicalLabel: "新しい概念",
    normalizedKey: "新しい概念",
    provenance: {
      ...exactPlan().provenance,
      evidenceRef: "M001:E04",
      surfaceForm: "新しい概念",
    },
  };
}

test("A. exact canonical plan freeze", () => {
  const built = buildExistingMatchAppendIntent({
    sessionId: SESSION_ID,
    plans: [exactPlan()],
    source: SOURCE,
    now: () => "2026-08-22T00:00:00.000Z",
  });
  assert.equal(built.ok, true);
  if (!built.ok) {
    return;
  }
  assert.equal(built.intent.metadata.version, "concept-incremental-existing-append-intent-v1");
  assert.equal(built.intent.metadata.mode, "existing_match_append");
  assert.equal(built.intent.plans.length, 1);
  assert.equal(built.intent.plans[0]?.matchReason, "exact_canonical");
  assert.equal(built.intent.plans[0]?.provenance.surfaceForm, SURFACE);
});

test("B. unique alias plan freeze", () => {
  const built = buildExistingMatchAppendIntent({
    sessionId: SESSION_ID,
    plans: [aliasPlan()],
    source: SOURCE,
  });
  assert.equal(built.ok, true);
  if (!built.ok) {
    return;
  }
  assert.equal(built.intent.plans[0]?.matchReason, "unique_observed_alias");
  assert.equal(built.intent.plans[0]?.provenance.surfaceForm, ALIAS_SURFACE);
});

test("C. surfaceForm preservation through serialize/load/replay", () => {
  const built = buildExistingMatchAppendIntent({
    sessionId: SESSION_ID,
    plans: [exactPlan()],
    source: SOURCE,
    now: () => "2026-08-22T00:00:00.000Z",
  });
  assert.equal(built.ok, true);
  if (!built.ok) {
    return;
  }
  const loaded = loadExistingMatchAppendIntent(JSON.stringify(built.intent));
  assert.equal(loaded.ok, true);
  if (!loaded.ok) {
    return;
  }
  assert.equal(
    loaded.intent.plans[0]?.provenance.surfaceForm,
    built.intent.plans[0]?.provenance.surfaceForm,
  );
});

test("D. full plan lossless replay", () => {
  const original = exactPlan();
  const built = buildExistingMatchAppendIntent({
    sessionId: SESSION_ID,
    plans: [original, provisionalPlan()],
    source: SOURCE,
  });
  assert.equal(built.ok, true);
  if (!built.ok) {
    return;
  }
  const replayed = intentToExistingMatchPlans(built.intent);
  assert.deepEqual(replayed, [original]);
  const loaded = loadExistingMatchAppendIntent(JSON.stringify(built.intent));
  assert.equal(loaded.ok, true);
  if (!loaded.ok) {
    return;
  }
  assert.deepEqual(intentToExistingMatchPlans(loaded.intent), [original]);
});

test("E. provisional_new excluded", () => {
  const built = buildExistingMatchAppendIntent({
    sessionId: SESSION_ID,
    plans: [exactPlan(), provisionalPlan()],
    source: SOURCE,
  });
  assert.equal(built.ok, true);
  if (!built.ok) {
    return;
  }
  assert.equal(built.intent.plans.length, 1);
  assert.equal(built.intent.plans[0]?.kind, "existing_match");
  assert.equal(
    JSON.stringify(built.intent).includes("provisional_new"),
    false,
  );
});

test("F. new excluded", () => {
  const built = buildExistingMatchAppendIntent({
    sessionId: SESSION_ID,
    plans: [exactPlan(), newPlan()],
    source: SOURCE,
  });
  assert.equal(built.ok, true);
  if (!built.ok) {
    return;
  }
  assert.equal(built.intent.plans.length, 1);
  assert.equal(
    built.intent.plans.some((plan) => plan.kind !== "existing_match"),
    false,
  );
});

test("G. semantic reason reject", () => {
  const built = buildExistingMatchAppendIntent({
    sessionId: SESSION_ID,
    plans: [
      {
        ...exactPlan(),
        matchReason: "semantic" as ExistingMatchPlan["matchReason"],
      },
    ],
    source: SOURCE,
  });
  assert.equal(built.ok, false);
  if (built.ok) {
    return;
  }
  assert.equal(built.code, "invalid_plan");
  assert.match(built.detail, /matchReason/);
});

test("H. empty existing → no_existing_matches", () => {
  const none = buildExistingMatchAppendIntent({
    sessionId: SESSION_ID,
    plans: [],
    source: SOURCE,
  });
  const onlyOther = buildExistingMatchAppendIntent({
    sessionId: SESSION_ID,
    plans: [provisionalPlan(), newPlan()],
    source: SOURCE,
  });
  assert.equal(none.ok, false);
  assert.equal(onlyOther.ok, false);
  if (!none.ok) {
    assert.equal(none.code, "no_existing_matches");
  }
  if (!onlyOther.ok) {
    assert.equal(onlyOther.code, "no_existing_matches");
  }
});

test("I. missing surfaceForm reject, no guess", () => {
  const built = buildExistingMatchAppendIntent({
    sessionId: SESSION_ID,
    plans: [
      exactPlan({
        provenance: {
          ...exactPlan().provenance,
          surfaceForm: "   ",
        },
      }),
    ],
    source: SOURCE,
  });
  assert.equal(built.ok, false);
  if (!built.ok) {
    assert.equal(built.code, "invalid_plan");
    assert.equal(built.detail, "surfaceForm");
  }
  const source = readFileSync(
    resolve(process.cwd(), "lib/concepts/incremental/append-intent.ts"),
    "utf8",
  );
  assert.doesNotMatch(source, /canonicalLabel.*surfaceForm/);
  assert.doesNotMatch(source, /unit\.text/);
});

test("J. no full USER / Evidence / raw LLM content", () => {
  const built = buildExistingMatchAppendIntent({
    sessionId: SESSION_ID,
    plans: [exactPlan()],
    source: SOURCE,
  });
  assert.equal(built.ok, true);
  if (!built.ok) {
    return;
  }
  const serialized = JSON.stringify(built.intent);
  assert.equal(serialized.includes(USER), false);
  assert.equal(serialized.includes(EVIDENCE_FULL), false);
  assert.equal(serialized.includes(RAW_LLM), false);
  assert.equal(serialized.includes("SECRET_USER_BODY"), false);
  assert.doesNotMatch(serialized, /"content":/);
  assert.doesNotMatch(serialized, /"rawContent":/);
  assert.match(serialized, /"surfaceForm":"両親"/);
});

test("K. deterministic contentHash ignores generatedAt", () => {
  const first = buildExistingMatchAppendIntent({
    sessionId: SESSION_ID,
    plans: [exactPlan()],
    source: SOURCE,
    now: () => "2026-08-22T00:00:00.000Z",
  });
  const second = buildExistingMatchAppendIntent({
    sessionId: SESSION_ID,
    plans: [exactPlan()],
    source: SOURCE,
    now: () => "2026-08-22T12:00:00.000Z",
  });
  assert.equal(first.ok && second.ok, true);
  if (!first.ok || !second.ok) {
    return;
  }
  assert.equal(first.intent.metadata.contentHash, second.intent.metadata.contentHash);
  assert.notEqual(first.intent.metadata.generatedAt, second.intent.metadata.generatedAt);
});

test("L. tampered intent without hash update is rejected", () => {
  const built = buildExistingMatchAppendIntent({
    sessionId: SESSION_ID,
    plans: [exactPlan()],
    source: SOURCE,
  });
  assert.equal(built.ok, true);
  if (!built.ok) {
    return;
  }
  const tampered = structuredClone(built.intent);
  tampered.plans[0]!.provenance.surfaceForm = "別人";
  const loaded = loadExistingMatchAppendIntent(JSON.stringify(tampered));
  assert.equal(loaded.ok, false);
  if (!loaded.ok) {
    assert.equal(loaded.code, "content_hash");
  }
  tampered.plans[0]!.conceptId = "other-concept";
  const loadedConcept = loadExistingMatchAppendIntent(JSON.stringify(tampered));
  assert.equal(loadedConcept.ok, false);
});

test("M. candidateRef preservation", () => {
  const original = exactPlan();
  const built = buildExistingMatchAppendIntent({
    sessionId: SESSION_ID,
    plans: [original],
    source: SOURCE,
  });
  assert.equal(built.ok, true);
  if (!built.ok) {
    return;
  }
  assert.equal(built.intent.plans[0]?.candidateRef, original.candidateRef);
  assert.deepEqual(intentToExistingMatchPlans(built.intent)[0]?.candidateRef, original.candidateRef);
});

test("N. canonicalLabel / normalizedKey freeze", () => {
  const original = exactPlan({
    canonicalLabel: "両親",
    normalizedKey: "両親",
  });
  const built = buildExistingMatchAppendIntent({
    sessionId: SESSION_ID,
    plans: [original],
    source: SOURCE,
  });
  assert.equal(built.ok, true);
  if (!built.ok) {
    return;
  }
  const replayed = intentToExistingMatchPlans(built.intent)[0];
  assert.equal(replayed?.canonicalLabel, original.canonicalLabel);
  assert.equal(replayed?.normalizedKey, original.normalizedKey);
});

test("O. occurredAt preservation", () => {
  const original = exactPlan();
  const built = buildExistingMatchAppendIntent({
    sessionId: SESSION_ID,
    plans: [original],
    source: SOURCE,
  });
  assert.equal(built.ok, true);
  if (!built.ok) {
    return;
  }
  assert.equal(
    intentToExistingMatchPlans(built.intent)[0]?.provenance.occurredAt,
    original.provenance.occurredAt,
  );
});

test("P. zero DB write and gated-result integration", () => {
  const db = openMemoryDb();
  insertConcept(
    {
      id: HUMAN_ID,
      canonicalLabel: SURFACE,
      createdAt: "2026-08-18T00:00:00.000Z",
    },
    db,
  );
  const before = counts(db);
  const gated: EligibilityGatedIncrementalSessionResult = {
    status: "planned",
    sessionId: SESSION_ID,
    planResult: {
      status: "planned",
      sessionId: SESSION_ID,
      userEvidenceUnits: 8,
      candidatesExtracted: 2,
      existingMatches: 1,
      newCandidates: 0,
      provisionalNewCandidates: 1,
      plans: [exactPlan(), provisionalPlan()],
      adapterActions: 2,
      actionsEnteringGrounding: 2,
      groundedActions: 2,
      groundedCandidates: 2,
      groundingRejectedCount: 0,
      groundingRejections: [],
    },
  };
  const extracted = existingMatchPlansFromGatedResult(gated);
  assert.deepEqual(extracted, [exactPlan()]);
  const dir = mkdtempSync(join(tmpdir(), "existing-match-intent-"));
  const outputPath = join(dir, "intent.json");
  const frozen = freezeExistingMatchAppendIntent({
    sessionId: SESSION_ID,
    plans: gated.planResult.status === "planned" ? gated.planResult.plans : [],
    source: SOURCE,
    outputPath,
    now: () => "2026-08-22T00:00:00.000Z",
  });
  assert.equal(frozen.ok, true);
  if (!frozen.ok) {
    return;
  }
  const loaded = loadExistingMatchAppendIntent(readFileSync(outputPath, "utf8"));
  assert.equal(loaded.ok, true);
  assert.deepEqual(counts(db), before);
});

test("write failure is explicit and creates no success", () => {
  const result = freezeExistingMatchAppendIntent({
    sessionId: SESSION_ID,
    plans: [exactPlan()],
    source: SOURCE,
    outputPath: "/tmp/should-not-matter.json",
    writeIntent: () => {
      throw new Error("disk full");
    },
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "write_failed");
  }
});

test("module does not call Safety Engine / LLM / diagnostic report merge", () => {
  const source = readFileSync(
    resolve(process.cwd(), "lib/concepts/incremental/append-intent.ts"),
    "utf8",
  );
  assert.match(source, /atomicWriteJsonFile/);
  assert.match(source, /hashJsonContent/);
  assert.doesNotMatch(source, /planEligibleIncrementalSession\(/);
  assert.doesNotMatch(source, /classifyExistingMatchOccurrencePlan/);
  assert.doesNotMatch(source, /runExistingMatchOccurrencePreflight/);
  assert.doesNotMatch(source, /applyExistingMatchOccurrences/);
  assert.doesNotMatch(source, /createProductionIncrementalCandidateExtractor/);
  assert.doesNotMatch(source, /getAiProvider/);
  assert.doesNotMatch(source, /classifyServerIdentity/);
  assert.doesNotMatch(source, /concept-incremental-pilot-result-v1/);
});
