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
import type {
  ExistingMatchPlan,
  IncrementalConceptPlan,
  NewCandidatePlan,
  ProvisionalNewPlan,
} from "./plan";
import {
  buildNewAssessmentIntent,
  freezeNewAssessmentIntent,
  intentToNewCandidatePlans,
  loadNewAssessmentIntent,
  newCandidatePlansFromGatedResult,
} from "./new-assessment-intent";

const SESSION_ID = "session-new-assessment-intent";
const OTHER_SESSION = "session-other";
const HUMAN_ID = "concept-parents";
const USER =
  "SECRET_USER_BODY_NEW_ASSESSMENT_INTENT_両親のことを何度も思い出してしまった。";
const EVIDENCE_FULL =
  "SECRET_EVIDENCE_FULL_このUnit全文はNEW Assessment Intentへコピーしてはいけない。";
const RAW_LLM = "SECRET_RAW_LLM_OUTPUT_should_not_appear";
const SURFACE_A = "睡眠の質";
const SURFACE_B = "仕事の優先順位";

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

function provenance(
  overrides: Partial<NewCandidatePlan["provenance"]> = {},
): NewCandidatePlan["provenance"] {
  return {
    sessionId: SESSION_ID,
    messageId: `${SESSION_ID}-u`,
    evidenceRef: "M001:E01",
    occurredAt: "2026-07-13T00:00:00.000Z",
    surfaceForm: SURFACE_A,
    sourceRole: "user",
    sourceType: "evidence_unit",
    extractionVersion: CONCEPT_EXTRACTION_VERSION,
    ...overrides,
  };
}

function newPlan(
  overrides: Partial<NewCandidatePlan> = {},
): NewCandidatePlan {
  return {
    kind: "new",
    candidateRef: `virtual:${SURFACE_A}:M001:E01:0`,
    canonicalLabel: SURFACE_A,
    normalizedKey: SURFACE_A,
    provenance: provenance(),
    ...overrides,
  };
}

function secondNewPlan(): NewCandidatePlan {
  return {
    kind: "new",
    candidateRef: `virtual:${SURFACE_B}:M001:E01:1`,
    canonicalLabel: SURFACE_B,
    normalizedKey: SURFACE_B,
    provenance: provenance({
      evidenceRef: "M001:E01",
      surfaceForm: SURFACE_B,
    }),
  };
}

function existingPlan(): ExistingMatchPlan {
  return {
    kind: "existing_match",
    candidateRef: `${HUMAN_ID}:M001:E02:0`,
    conceptId: HUMAN_ID,
    matchReason: "exact_canonical",
    canonicalLabel: "両親",
    normalizedKey: "両親",
    provenance: provenance({
      evidenceRef: "M001:E02",
      surfaceForm: "両親",
    }),
  };
}

function provisionalPlan(): ProvisionalNewPlan {
  return {
    kind: "provisional_new",
    candidateRef: "virtual:adhd:M001:E03:1",
    canonicalLabel: "ADHD",
    normalizedKey: "adhd",
    provisionalConceptId: "concept-adhd-memory",
    provisionalReason: "semantic",
    provenance: provenance({
      evidenceRef: "M001:E03",
      surfaceForm: "ADHD",
    }),
  };
}

test("A. single NEW freeze", () => {
  const built = buildNewAssessmentIntent({
    sessionId: SESSION_ID,
    plans: [newPlan()],
    source: SOURCE,
    now: () => "2026-08-22T00:00:00.000Z",
  });
  assert.equal(built.ok, true);
  if (!built.ok) {
    return;
  }
  assert.equal(
    built.intent.metadata.version,
    "concept-incremental-new-assessment-intent-v1",
  );
  assert.equal(built.intent.metadata.mode, "new_candidate_assessment");
  assert.equal(built.intent.candidates.length, 1);
  assert.equal(built.intent.candidates[0]?.kind, "new");
  assert.equal(built.intent.candidates[0]?.provenance.surfaceForm, SURFACE_A);
});

test("B. multiple NEW keep both Evidence-level candidates", () => {
  const built = buildNewAssessmentIntent({
    sessionId: SESSION_ID,
    plans: [newPlan(), secondNewPlan()],
    source: SOURCE,
    now: () => "2026-08-22T00:00:00.000Z",
  });
  assert.equal(built.ok, true);
  if (!built.ok) {
    return;
  }
  assert.equal(built.intent.candidates.length, 2);
  assert.equal(
    built.intent.candidates[0]?.candidateRef,
    `virtual:${SURFACE_A}:M001:E01:0`,
  );
  assert.equal(
    built.intent.candidates[1]?.candidateRef,
    `virtual:${SURFACE_B}:M001:E01:1`,
  );
  assert.equal(built.intent.candidates[0]?.provenance.evidenceRef, "M001:E01");
  assert.equal(built.intent.candidates[1]?.provenance.evidenceRef, "M001:E01");
});

test("C. existing_match is excluded", () => {
  const built = buildNewAssessmentIntent({
    sessionId: SESSION_ID,
    plans: [existingPlan(), newPlan()],
    source: SOURCE,
    now: () => "2026-08-22T00:00:00.000Z",
  });
  assert.equal(built.ok, true);
  if (!built.ok) {
    return;
  }
  assert.equal(built.intent.candidates.length, 1);
  assert.equal(built.intent.candidates[0]?.kind, "new");
  assert.equal(built.intent.candidates[0]?.canonicalLabel, SURFACE_A);
});

test("D. provisional_new is excluded and not promoted", () => {
  const built = buildNewAssessmentIntent({
    sessionId: SESSION_ID,
    plans: [newPlan(), provisionalPlan()],
    source: SOURCE,
    now: () => "2026-08-22T00:00:00.000Z",
  });
  assert.equal(built.ok, true);
  if (!built.ok) {
    return;
  }
  assert.equal(built.intent.candidates.length, 1);
  assert.equal(built.intent.candidates[0]?.kind, "new");
  const serialized = JSON.stringify(built.intent);
  assert.doesNotMatch(serialized, /provisional_new/);
  assert.doesNotMatch(serialized, /provisionalReason/);
  assert.doesNotMatch(serialized, /semantic/);
});

test("E. provisional-only yields no_new_candidates", () => {
  const built = buildNewAssessmentIntent({
    sessionId: SESSION_ID,
    plans: [provisionalPlan()],
    source: SOURCE,
  });
  assert.equal(built.ok, false);
  if (!built.ok) {
    assert.equal(built.code, "no_new_candidates");
  }
});

test("F. existing-only yields no_new_candidates", () => {
  const built = buildNewAssessmentIntent({
    sessionId: SESSION_ID,
    plans: [existingPlan()],
    source: SOURCE,
  });
  assert.equal(built.ok, false);
  if (!built.ok) {
    assert.equal(built.code, "no_new_candidates");
  }
});

test("G. grounded identity is preserved", () => {
  const plan = newPlan();
  const built = buildNewAssessmentIntent({
    sessionId: SESSION_ID,
    plans: [plan],
    source: SOURCE,
    now: () => "2026-08-22T00:00:00.000Z",
  });
  assert.equal(built.ok, true);
  if (!built.ok) {
    return;
  }
  const frozen = built.intent.candidates[0]!;
  assert.equal(frozen.candidateRef, plan.candidateRef);
  assert.equal(frozen.canonicalLabel, plan.canonicalLabel);
  assert.equal(frozen.normalizedKey, plan.normalizedKey);
  assert.equal(frozen.provenance.surfaceForm, plan.provenance.surfaceForm);
  assert.equal(frozen.provenance.evidenceRef, plan.provenance.evidenceRef);
  assert.equal(frozen.provenance.messageId, plan.provenance.messageId);
  assert.equal(frozen.provenance.occurredAt, plan.provenance.occurredAt);
  assert.equal(frozen.provenance.sessionId, plan.provenance.sessionId);
  assert.equal(frozen.provenance.sourceRole, "user");
  assert.equal(frozen.provenance.sourceType, "evidence_unit");
  assert.equal(frozen.provenance.extractionVersion, CONCEPT_EXTRACTION_VERSION);
});

test("H. serialized Intent excludes USER / Evidence body / raw LLM", () => {
  const built = buildNewAssessmentIntent({
    sessionId: SESSION_ID,
    plans: [newPlan()],
    source: SOURCE,
    now: () => "2026-08-22T00:00:00.000Z",
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
  assert.doesNotMatch(serialized, /"parsed":/);
  assert.doesNotMatch(serialized, /"rawContent":/);
  assert.doesNotMatch(serialized, /occurrenceCount/);
  assert.doesNotMatch(serialized, /distinctSessionCount/);
  assert.doesNotMatch(serialized, /sessionIds/);
  assert.doesNotMatch(serialized, /suspiciousFlags/);
  assert.doesNotMatch(serialized, /provisionalHints/);
  assert.match(serialized, /"surfaceForm":/);
});

test("I. contentHash ignores generatedAt", () => {
  const first = buildNewAssessmentIntent({
    sessionId: SESSION_ID,
    plans: [newPlan(), secondNewPlan()],
    source: SOURCE,
    now: () => "2026-08-22T00:00:00.000Z",
  });
  const second = buildNewAssessmentIntent({
    sessionId: SESSION_ID,
    plans: [newPlan(), secondNewPlan()],
    source: SOURCE,
    now: () => "2099-01-01T00:00:00.000Z",
  });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (!first.ok || !second.ok) {
    return;
  }
  assert.equal(first.intent.metadata.contentHash, second.intent.metadata.contentHash);
  assert.notEqual(first.intent.metadata.generatedAt, second.intent.metadata.generatedAt);
});

test("J. tampered candidate identity is rejected", () => {
  const built = buildNewAssessmentIntent({
    sessionId: SESSION_ID,
    plans: [newPlan()],
    source: SOURCE,
    now: () => "2026-08-22T00:00:00.000Z",
  });
  assert.equal(built.ok, true);
  if (!built.ok) {
    return;
  }
  const tampered = structuredClone(built.intent);
  tampered.candidates[0]!.provenance.surfaceForm = "改ざん";
  const loaded = loadNewAssessmentIntent(JSON.stringify(tampered));
  assert.equal(loaded.ok, false);
  if (!loaded.ok) {
    assert.equal(loaded.code, "content_hash");
  }
});

test("K. session invariant is rejected", () => {
  const built = buildNewAssessmentIntent({
    sessionId: SESSION_ID,
    plans: [
      newPlan({
        provenance: provenance({ sessionId: OTHER_SESSION }),
      }),
    ],
    source: SOURCE,
  });
  assert.equal(built.ok, false);
  if (!built.ok) {
    assert.equal(built.code, "invalid_plan");
    assert.match(built.detail, /sessionId/);
  }

  const valid = buildNewAssessmentIntent({
    sessionId: SESSION_ID,
    plans: [newPlan()],
    source: SOURCE,
    now: () => "2026-08-22T00:00:00.000Z",
  });
  assert.equal(valid.ok, true);
  if (!valid.ok) {
    return;
  }
  const tampered = structuredClone(valid.intent);
  tampered.metadata.sessionId = OTHER_SESSION;
  const loaded = loadNewAssessmentIntent(JSON.stringify(tampered));
  assert.equal(loaded.ok, false);
  if (!loaded.ok) {
    assert.equal(loaded.code, "invalid_plan");
  }
});

test("L. lossless replay preserves builder input NEW candidates", () => {
  const input: IncrementalConceptPlan[] = [
    existingPlan(),
    newPlan(),
    secondNewPlan(),
    provisionalPlan(),
  ];
  const built = buildNewAssessmentIntent({
    sessionId: SESSION_ID,
    plans: input,
    source: SOURCE,
    now: () => "2026-08-22T00:00:00.000Z",
  });
  assert.equal(built.ok, true);
  if (!built.ok) {
    return;
  }
  const loaded = loadNewAssessmentIntent(JSON.stringify(built.intent));
  assert.equal(loaded.ok, true);
  if (!loaded.ok) {
    return;
  }
  const replayed = intentToNewCandidatePlans(loaded.intent);
  assert.deepEqual(replayed, [newPlan(), secondNewPlan()]);
  assert.equal(replayed[0]?.candidateRef, newPlan().candidateRef);
  assert.equal(replayed[1]?.candidateRef, secondNewPlan().candidateRef);
});

test("M. freeze writes the Intent file and does not write DB", () => {
  const db = openMemoryDb();
  insertConcept(
    {
      id: HUMAN_ID,
      canonicalLabel: "両親",
      createdAt: "2026-08-18T00:00:00.000Z",
    },
    db,
  );
  const before = counts(db);
  const dir = mkdtempSync(join(tmpdir(), "new-assessment-intent-"));
  const outputPath = join(dir, "intent.json");
  const gated: EligibilityGatedIncrementalSessionResult = {
    status: "planned",
    sessionId: SESSION_ID,
    planResult: {
      status: "planned",
      sessionId: SESSION_ID,
      userEvidenceUnits: 8,
      candidatesExtracted: 3,
      existingMatches: 1,
      newCandidates: 1,
      provisionalNewCandidates: 1,
      plans: [existingPlan(), newPlan(), provisionalPlan()],
      adapterActions: 3,
      actionsEnteringGrounding: 3,
      groundedActions: 3,
      groundedCandidates: 3,
      groundingRejectedCount: 0,
      groundingRejections: [],
    },
  };
  assert.deepEqual(newCandidatePlansFromGatedResult(gated), [newPlan()]);
  const frozen = freezeNewAssessmentIntent({
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
  const loaded = loadNewAssessmentIntent(readFileSync(outputPath, "utf8"));
  assert.equal(loaded.ok, true);
  assert.deepEqual(counts(db), before);
});

test("empty Intent is not written for no_new_candidates", () => {
  let wrote = false;
  const result = freezeNewAssessmentIntent({
    sessionId: SESSION_ID,
    plans: [existingPlan(), provisionalPlan()],
    source: SOURCE,
    outputPath: "/tmp/should-not-write-new-assessment-intent.json",
    writeIntent: () => {
      wrote = true;
    },
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "no_new_candidates");
  }
  assert.equal(wrote, false);
});

test("N. module does not call Planning / Assessment / Policy / LLM", () => {
  const source = readFileSync(
    resolve(process.cwd(), "lib/concepts/incremental/new-assessment-intent.ts"),
    "utf8",
  );
  assert.match(source, /atomicWriteJsonFile/);
  assert.match(source, /hashJsonContent/);
  assert.doesNotMatch(source, /planEligibleIncrementalSession\(/);
  assert.doesNotMatch(source, /planIncrementalSession\(/);
  assert.doesNotMatch(source, /planIncrementalConceptCandidates\(/);
  assert.doesNotMatch(source, /runExistingMatchOccurrencePreflight/);
  assert.doesNotMatch(source, /applyExistingMatchOccurrences/);
  assert.doesNotMatch(source, /buildExistingMatchAppendIntent/);
  assert.doesNotMatch(source, /loadExistingMatchAppendIntent/);
  assert.doesNotMatch(source, /runConceptAssessment/);
  assert.doesNotMatch(source, /named_or_high/);
  assert.doesNotMatch(source, /evaluatePolicyCalibration/);
  assert.doesNotMatch(source, /getAiProvider/);
  assert.doesNotMatch(source, /createProductionIncrementalCandidateExtractor/);
  assert.doesNotMatch(source, /occurrenceCount/);
  assert.doesNotMatch(source, /102a1678-dbe6-47a3-a064-a8b898425b06/);
});
