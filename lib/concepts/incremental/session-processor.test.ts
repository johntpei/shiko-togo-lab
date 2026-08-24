import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { CONCEPT_EXTRACT_PROMPT_VERSION } from "@/lib/ai/prompts/concept-extract";
import type { StructuredGenerateRequest } from "@/lib/ai/provider";
import type { ConceptAssessmentOutput } from "@/lib/ai/concept-admission-assessment-schema";
import { hashSourceArtifactText } from "@/lib/concepts/admission/apply-manifest";
import { CONCEPT_EXTRACTION_VERSION } from "@/lib/concepts/types";
import { applySqlMigrations } from "@/lib/db/client";
import {
  countConceptAliases,
  countConceptOccurrences,
  countConcepts,
  insertConcept,
  insertConceptOccurrence,
} from "@/lib/db/concept-queries";
import * as schema from "@/lib/db/schema";
import { applyExistingMatchOccurrencesThenReconcile } from "./existing-append-lifecycle";
import {
  loadInitialConceptProcessingCoverage,
  type InitialConceptProcessingCoverageLoad,
} from "./eligibility";
import { ALL_ACTIONS_GROUNDING_REJECTED } from "./session-plan";
import type { IncrementalCandidateExtractor } from "./session-plan";
import { IncrementalExtractError } from "./extract";
import {
  processIncrementalConceptSession,
  type ProcessIncrementalConceptSessionDeps,
} from "./session-processor";

const COVERED_WITH_OCC = "session-covered-occ";
const COVERED_ZERO_OCC = "session-covered-zero";
const ELIGIBLE = "session-eligible";
const HUMAN_ID = "concept-human-relations";
const USER_A =
  "これまでの人間関係でなぜ上手くいかないのか理解できないと思った。";
const USER_MIXED =
  "人間関係と寂しさと統合支援ツールについて同じ文で考えています。";
const USER_NEW = "睡眠の質について今日は落ち着いて考えられた。";
const FORBIDDEN_USER_KEYS = [
  "surfaceForm",
  "canonicalLabel",
  "quote",
  "content",
  "message",
  "unitText",
  "evidence",
  "rawLlm",
  "raw",
];

function restore(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

async function withAssessmentEnv(run: () => Promise<void>) {
  const prev = {
    key: process.env.OPENAI_API_KEY,
    model: process.env.AI_MODEL,
    provider: process.env.AI_PROVIDER,
  };
  process.env.OPENAI_API_KEY = "sk-test-not-used";
  process.env.AI_MODEL = "test-model";
  process.env.AI_PROVIDER = "openai";
  try {
    await run();
  } finally {
    restore("OPENAI_API_KEY", prev.key);
    restore("AI_MODEL", prev.model);
    restore("AI_PROVIDER", prev.provider);
  }
}

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
    checkpoints: db.select().from(schema.conceptProcessingCheckpoints).all()
      .length,
  };
}

function seedSession(
  db: ReturnType<typeof openMemoryDb>,
  id: string,
  content = USER_A,
) {
  db.insert(schema.sessions)
    .values({
      id,
      title: id,
      occurredAt: "2099-01-01",
      source: "chatgpt",
      category: "制作",
      rawContent: "x",
      status: "parsed",
      sourceConversationId: null,
      importSource: "manual",
      sourceStartAt: null,
      sourceEndAt: null,
      createdAt: "2026-08-18T00:00:00.000Z",
      updatedAt: "2026-08-18T00:00:00.000Z",
    })
    .run();
  db.insert(schema.messages)
    .values({
      id: `${id}-u`,
      sessionId: id,
      index: 0,
      role: "user",
      content,
      charStart: 0,
      charEnd: content.length,
      sourceMessageId: null,
      sourceCreatedAt: "2026-07-15T12:00:00.000Z",
      contentType: "text",
      attachmentsJson: null,
    })
    .run();
}

function candidateReport(selectedSessionIds: string[]) {
  return {
    metadata: {
      promptVersion: CONCEPT_EXTRACT_PROMPT_VERSION,
      extractionVersion: CONCEPT_EXTRACTION_VERSION,
      selectedSessionIds,
    },
    concepts: [],
    actions: selectedSessionIds.map((sessionId) => ({
      sessionId,
      evidenceRef: "M001:E01",
      originalAction: "skip",
    })),
    failedSessions: [],
  };
}

function defaultCoverage(): InitialConceptProcessingCoverageLoad {
  const candidateReportText = JSON.stringify(
    candidateReport([COVERED_WITH_OCC, COVERED_ZERO_OCC]),
  );
  return loadInitialConceptProcessingCoverage({
    candidateReportText,
    expectedSourceHash: hashSourceArtifactText(candidateReportText),
  });
}

function seedCoveredAndEligible(
  db: ReturnType<typeof openMemoryDb>,
  eligibleContent = USER_A,
) {
  seedSession(db, COVERED_WITH_OCC);
  seedSession(db, COVERED_ZERO_OCC);
  seedSession(db, ELIGIBLE, eligibleContent);
  insertConcept(
    {
      id: HUMAN_ID,
      canonicalLabel: "人間関係",
      createdAt: "2026-08-18T00:00:00.000Z",
    },
    db,
  );
  const inserted = insertConceptOccurrence(
    {
      id: "occ-covered",
      conceptId: HUMAN_ID,
      sessionId: COVERED_WITH_OCC,
      messageId: `${COVERED_WITH_OCC}-u`,
      evidenceRef: "M001:E01",
      occurredAt: "2026-07-15T12:00:00.000Z",
      sourceRole: "user",
      sourceType: "evidence_unit",
      extractionVersion: CONCEPT_EXTRACTION_VERSION,
    },
    db,
  );
  assert.equal(inserted.status, "inserted");
}

function countingExtractor(impl?: IncrementalCandidateExtractor) {
  let calls = 0;
  const extractCandidates: IncrementalCandidateExtractor = async (
    units,
    context,
  ) => {
    calls += 1;
    if (!impl) {
      throw new Error("extractor should not run");
    }
    return impl(units, context);
  };
  return { extractCandidates, calls: () => calls };
}

function newFromUnits(surfaceForm: string): IncrementalCandidateExtractor {
  return async (units) => [
    {
      action: "new",
      evidenceRef: units[0]!.evidenceRef,
      surfaceForm,
    },
  ];
}

function cover(
  refs: string[],
  form: ConceptAssessmentOutput["assessments"][number]["conceptForm"] = "specific_named_concept",
): ConceptAssessmentOutput {
  return {
    assessments: refs.map((candidateRef) => ({
      candidateRef,
      conceptForm: form,
      evidenceRole: "central" as const,
      longitudinalPotential: "high" as const,
    })),
  };
}

function stubAssessment(
  form: ConceptAssessmentOutput["assessments"][number]["conceptForm"] = "specific_named_concept",
) {
  return async (request: StructuredGenerateRequest) => {
    const refs = [...request.user.matchAll(/^## (.+)$/gm)].map(
      (match) => match[1]!,
    );
    return { parsed: cover(refs, form), model: request.model };
  };
}

function unusedStructured(): ProcessIncrementalConceptSessionDeps["generateStructured"] {
  return async () => {
    throw new Error("generateStructured should not run");
  };
}

function assertNoUserPayload(result: unknown) {
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /これまでの人間関係/);
  assert.doesNotMatch(serialized, /睡眠の質について/);
  assert.doesNotMatch(serialized, /SECRET_USER/);
  for (const key of FORBIDDEN_USER_KEYS) {
    assert.equal(
      serialized.includes(`"${key}"`),
      false,
      `result must not include ${key}`,
    );
  }
}

async function runProcessor(
  db: ReturnType<typeof openMemoryDb>,
  input: {
    extractCandidates: IncrementalCandidateExtractor;
    generateStructured?: ProcessIncrementalConceptSessionDeps["generateStructured"];
    sessionId?: string;
  } & Partial<ProcessIncrementalConceptSessionDeps>,
) {
  return processIncrementalConceptSession(
    {
      sessionId: input.sessionId ?? ELIGIBLE,
      coverage: defaultCoverage(),
    },
    {
      db,
      extractCandidates: input.extractCandidates,
      generateStructured: input.generateStructured ?? unusedStructured(),
      model: "test-extract-model",
      applyExisting: input.applyExisting,
      applyNew: input.applyNew,
      writeCheckpoint: input.writeCheckpoint,
      runExistingPreflight: input.runExistingPreflight,
      runNewPreflight: input.runNewPreflight,
      assessNew: input.assessNew,
      persistPreparedRun: input.persistPreparedRun,
      loadPreparedRun: input.loadPreparedRun,
      updateRunPhase: input.updateRunPhase,
      verifyNewExact: input.verifyNewExact,
    },
  );
}

test("A. missing Session → no LLM / no write", async () => {
  const db = openMemoryDb();
  seedCoveredAndEligible(db);
  const before = counts(db);
  const extractor = countingExtractor();
  const result = await runProcessor(db, {
    sessionId: "missing-session",
    extractCandidates: extractor.extractCandidates,
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.reason, "missing_session");
  assert.equal(extractor.calls(), 0);
  assert.equal(result.extractionCalls, 0);
  assert.equal(result.assessmentCalls, 0);
  assert.deepEqual(counts(db), before);
  assertNoUserPayload(result);
});

test("B. Initial-covered → no LLM / no write", async () => {
  const db = openMemoryDb();
  seedCoveredAndEligible(db);
  const before = counts(db);
  const extractor = countingExtractor();
  const result = await runProcessor(db, {
    sessionId: COVERED_WITH_OCC,
    extractCandidates: extractor.extractCandidates,
  });
  assert.equal(result.status, "already_covered");
  assert.equal(result.reason, "initial_processing_coverage");
  assert.equal(extractor.calls(), 0);
  assert.equal(result.assessmentCalls, 0);
  assert.deepEqual(counts(db), before);
});

test("C. checkpoint-covered → no LLM / no write", async () => {
  const db = openMemoryDb();
  seedCoveredAndEligible(db);
  const extractor = countingExtractor(async () => []);
  const first = await runProcessor(db, {
    extractCandidates: extractor.extractCandidates,
  });
  assert.equal(first.status, "completed");
  const before = counts(db);
  const secondExtractor = countingExtractor();
  const second = await runProcessor(db, {
    extractCandidates: secondExtractor.extractCandidates,
  });
  assert.equal(second.status, "already_covered");
  assert.equal(second.reason, "incremental_processing_checkpoint");
  assert.equal(secondExtractor.calls(), 0);
  assert.equal(second.assessmentCalls, 0);
  assert.deepEqual(counts(db), before);
});

test("D. candidate 0 → no_actions checkpoint", async () => {
  const db = openMemoryDb();
  seedCoveredAndEligible(db);
  const before = counts(db);
  const extractor = countingExtractor(async () => []);
  const result = await runProcessor(db, {
    extractCandidates: extractor.extractCandidates,
  });
  assert.equal(result.status, "completed");
  assert.equal(result.planning.status, "no_actions");
  assert.equal(result.checkpoint.status, "completed");
  assert.equal(extractor.calls(), 1);
  assert.equal(result.assessmentCalls, 0);
  assert.equal(counts(db).concepts, before.concepts);
  assert.equal(counts(db).occurrences, before.occurrences);
  assert.equal(counts(db).checkpoints, before.checkpoints + 1);
  assert.equal(result.retryAttempted, false);
});

test("D2. extractor safe code reaches planning diagnostics without raw error content", async () => {
  const db = openMemoryDb();
  seedCoveredAndEligible(db);
  const before = counts(db);
  const result = await runProcessor(db, {
    extractCandidates: async () => {
      throw new IncrementalExtractError(
        "timeout",
        "SECRET_USER raw provider response and stack fixture",
      );
    },
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.reason, "extractor_failed");
  assert.equal(result.planning.failureCode, "timeout");
  assert.equal(result.stageOrder.at(-1), "planning");
  assert.equal(result.extractionCalls, 1);
  assert.equal(result.assessmentCalls, 0);
  assert.deepEqual(counts(db), before);
  assertNoUserPayload(result);
});

test("E. existing only → append + checkpoint", async () => {
  const db = openMemoryDb();
  seedCoveredAndEligible(db);
  const before = counts(db);
  const extractor = countingExtractor(newFromUnits("人間関係"));
  const result = await runProcessor(db, {
    extractCandidates: extractor.extractCandidates,
  });
  assert.equal(result.status, "completed");
  assert.equal(result.frozenExistingIntentUsed, true);
  assert.equal(result.newAssessmentAttempted, false);
  assert.equal(result.existingPrimary.status, "applied");
  assert.equal(result.checkpoint.status, "completed");
  assert.equal(counts(db).concepts, before.concepts);
  assert.equal(counts(db).aliases, before.aliases);
  assert.equal(counts(db).occurrences, before.occurrences + 1);
  assert.equal(counts(db).checkpoints, before.checkpoints + 1);
  assert.equal(result.assessmentCalls, 0);
  assertNoUserPayload(result);
});

test("F. NEW admitted → Concept + Occurrence + checkpoint", async () => {
  await withAssessmentEnv(async () => {
    const db = openMemoryDb();
    seedCoveredAndEligible(db, USER_NEW);
    const before = counts(db);
    const extractor = countingExtractor(newFromUnits("睡眠の質"));
    const result = await runProcessor(db, {
      extractCandidates: extractor.extractCandidates,
      generateStructured: stubAssessment(),
    });
    assert.equal(result.status, "completed");
    assert.equal(result.frozenNewIntentUsed, true);
    assert.equal(result.newAssessmentAttempted, true);
    assert.equal(result.newPrimary.status, "applied");
    assert.equal(result.newPrimary.aliasesCreated, 0);
    assert.equal(result.checkpoint.status, "completed");
    assert.equal(counts(db).concepts, before.concepts + 1);
    assert.equal(counts(db).occurrences, before.occurrences + 1);
    assert.equal(counts(db).aliases, before.aliases);
    assert.equal(counts(db).checkpoints, before.checkpoints + 1);
    assert.ok(result.assessmentCalls >= 1);
  });
});

test("G. NEW non-admit → no Concept create, proof completes", async () => {
  await withAssessmentEnv(async () => {
    const db = openMemoryDb();
    seedCoveredAndEligible(db, USER_NEW);
    const before = counts(db);
    const extractor = countingExtractor(newFromUnits("睡眠の質"));
    const result = await runProcessor(db, {
      extractCandidates: extractor.extractCandidates,
      generateStructured: stubAssessment("generic_head"),
    });
    assert.equal(result.status, "completed");
    assert.equal(result.planning.newCandidateCount, 1);
    assert.equal(result.newPrimary.status, "no_op");
    assert.equal(result.checkpoint.status, "completed");
    assert.equal(counts(db).concepts, before.concepts);
    assert.equal(counts(db).occurrences, before.occurrences);
    assert.equal(counts(db).checkpoints, before.checkpoints + 1);
  });
});

test("H. existing + NEW → assessment before existing primary", async () => {
  await withAssessmentEnv(async () => {
    const db = openMemoryDb();
    seedCoveredAndEligible(db, USER_MIXED);
    const extractor = countingExtractor(async (units) => {
      const evidenceRef = units[0]!.evidenceRef;
      return [
        { action: "new", evidenceRef, surfaceForm: "人間関係" },
        { action: "new", evidenceRef, surfaceForm: "統合支援ツール" },
      ];
    });
    const result = await runProcessor(db, {
      extractCandidates: extractor.extractCandidates,
      generateStructured: stubAssessment(),
    });
    assert.equal(result.status, "completed");
    assert.equal(result.existingPrimary.status, "applied");
    assert.equal(result.newPrimary.status, "applied");
    const assessmentAt = result.stageOrder.indexOf("assessment");
    const newPreflightAt = result.stageOrder.indexOf("new_preflight");
    const existingPrimaryAt = result.stageOrder.indexOf("existing_primary");
    assert.ok(assessmentAt >= 0);
    assert.ok(newPreflightAt >= 0);
    assert.ok(existingPrimaryAt > assessmentAt);
    assert.ok(existingPrimaryAt > newPreflightAt);
    assert.equal(result.checkpoint.status, "completed");
  });
});

test("I. provisional only → deferred + checkpoint, no Concept write", async () => {
  const db = openMemoryDb();
  seedCoveredAndEligible(db, USER_MIXED);
  const before = counts(db);
  const extractor = countingExtractor(async (units) => [
    {
      action: "match",
      evidenceRef: units[0]!.evidenceRef,
      surfaceForm: "寂しさ",
      existingConceptRef: HUMAN_ID,
    },
  ]);
  const result = await runProcessor(db, {
    extractCandidates: extractor.extractCandidates,
  });
  assert.equal(result.status, "completed");
  assert.equal(result.planning.provisionalNewCount, 1);
  assert.equal(result.planning.existingMatchCount, 0);
  assert.equal(result.planning.newCandidateCount, 0);
  assert.equal(result.newAssessmentAttempted, false);
  assert.equal(result.assessmentCalls, 0);
  assert.equal(result.checkpoint.status, "completed");
  assert.equal(counts(db).concepts, before.concepts);
  assert.equal(counts(db).occurrences, before.occurrences);
  assert.equal(counts(db).checkpoints, before.checkpoints + 1);
});

test("J. selective grounding → rejected count kept", async () => {
  await withAssessmentEnv(async () => {
    const db = openMemoryDb();
    seedCoveredAndEligible(db, USER_MIXED);
    const extractor = countingExtractor(async (units) => {
      const evidenceRef = units[0]!.evidenceRef;
      return [
        { action: "new", evidenceRef, surfaceForm: "人間関係" },
        { action: "new", evidenceRef, surfaceForm: "存在しない表層" },
        { action: "new", evidenceRef, surfaceForm: "統合支援ツール" },
      ];
    });
    const result = await runProcessor(db, {
      extractCandidates: extractor.extractCandidates,
      generateStructured: stubAssessment(),
    });
    assert.equal(result.status, "completed");
    assert.equal(result.planning.groundingRejectedCount, 1);
    assert.equal(result.planning.existingMatchCount, 1);
    assert.equal(result.planning.newCandidateCount, 1);
    assert.equal(result.checkpoint.status, "completed");
  });
});

test("K. all grounding rejected → no checkpoint", async () => {
  const db = openMemoryDb();
  seedCoveredAndEligible(db);
  const before = counts(db);
  const extractor = countingExtractor(newFromUnits("存在しない表層"));
  const result = await runProcessor(db, {
    extractCandidates: extractor.extractCandidates,
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.reason, ALL_ACTIONS_GROUNDING_REJECTED);
  assert.equal(result.checkpoint.status, "not_written");
  assert.deepEqual(counts(db), before);
});

test("L. Assessment failure before writes", async () => {
  await withAssessmentEnv(async () => {
    const db = openMemoryDb();
    seedCoveredAndEligible(db, USER_MIXED);
    const before = counts(db);
    const extractor = countingExtractor(async (units) => {
      const evidenceRef = units[0]!.evidenceRef;
      return [
        { action: "new", evidenceRef, surfaceForm: "人間関係" },
        { action: "new", evidenceRef, surfaceForm: "統合支援ツール" },
      ];
    });
    const result = await runProcessor(db, {
      extractCandidates: extractor.extractCandidates,
      generateStructured: async () => {
        throw new Error("assessment boom");
      },
    });
    assert.equal(result.status, "failed");
    assert.equal(result.existingPrimary.status === "applied", false);
    assert.equal(result.newPrimary.status === "applied", false);
    assert.equal(result.checkpoint.status, "not_written");
    assert.deepEqual(counts(db), before);
    assert.equal(result.retryAttempted, false);
  });
});

test("M. NEW preflight failure before writes", async () => {
  await withAssessmentEnv(async () => {
    const db = openMemoryDb();
    seedCoveredAndEligible(db, USER_NEW);
    const before = counts(db);
    const extractor = countingExtractor(newFromUnits("睡眠の質"));
    const result = await runProcessor(db, {
      extractCandidates: extractor.extractCandidates,
      generateStructured: stubAssessment(),
      runNewPreflight: () =>
        ({
          status: "blocked",
          code: "injected_new_preflight",
          detail: "test",
          admittedCount: 0,
          notAdmittedCount: 0,
          conflicts: [],
          registryCounts: { concepts: 0, conceptAliases: 0, conceptOccurrences: 0 },
        }) as never,
    });
    assert.equal(result.status, "blocked");
    assert.equal(result.checkpoint.status, "not_written");
    assert.deepEqual(counts(db), before);
  });
});

test("N. Existing preflight failure → no writes", async () => {
  const db = openMemoryDb();
  seedCoveredAndEligible(db);
  const before = counts(db);
  const extractor = countingExtractor(newFromUnits("人間関係"));
  const result = await runProcessor(db, {
    extractCandidates: extractor.extractCandidates,
    runExistingPreflight: () =>
      ({
        status: "blocked",
        plansChecked: 1,
        predictedCreates: 0,
        alreadyPresent: 0,
        conflicts: 0,
        blockers: [{ code: "injected_existing_preflight", detail: "test" }],
        diagnostics: [],
      }) as never,
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.checkpoint.status, "not_written");
  assert.deepEqual(counts(db), before);
});

test("O. Existing primary failure → no checkpoint", async () => {
  const db = openMemoryDb();
  seedCoveredAndEligible(db);
  const before = counts(db);
  const extractor = countingExtractor(newFromUnits("人間関係"));
  const result = await runProcessor(db, {
    extractCandidates: extractor.extractCandidates,
    applyExisting: () =>
      ({
        primary: {
          ok: false,
          transactionCommitted: false,
          occurrencesCreated: 0,
          alreadyPresent: 0,
          conflicts: 1,
          code: "injected_existing_primary",
          detail: "test",
        },
        relationReconciliation: { status: "not_needed" },
      }) as never,
  });
  assert.equal(result.status, "failed");
  assert.equal(result.reason, "existing_primary_failed");
  assert.equal(result.checkpoint.status, "not_written");
  assert.deepEqual(counts(db), before);
  assert.equal(result.retryAttempted, false);
});

test("P. NEW primary failure after Existing → partial", async () => {
  await withAssessmentEnv(async () => {
    const db = openMemoryDb();
    seedCoveredAndEligible(db, USER_MIXED);
    const before = counts(db);
    const extractor = countingExtractor(async (units) => {
      const evidenceRef = units[0]!.evidenceRef;
      return [
        { action: "new", evidenceRef, surfaceForm: "人間関係" },
        { action: "new", evidenceRef, surfaceForm: "統合支援ツール" },
      ];
    });
    const result = await runProcessor(db, {
      extractCandidates: extractor.extractCandidates,
      generateStructured: stubAssessment(),
      applyNew: () =>
        ({
          primary: {
            ok: false,
            status: "blocked",
            transactionCommitted: false,
            code: "injected_new_primary",
            detail: "test",
            conceptsCreated: 0,
            occurrencesCreated: 0,
            aliasesCreated: 0,
            alreadyPresent: 0,
            conflicts: [],
            mapping: [],
            registryCounts: {
              concepts: 0,
              conceptAliases: 0,
              conceptOccurrences: 0,
            },
          },
          relationReconciliation: { status: "not_needed" },
        }) as never,
    });
    assert.equal(result.status, "failed");
    assert.equal(result.reason, "partial_primary_commit");
    assert.equal(result.existingPrimary.status, "applied");
    assert.equal(result.newPrimary.status, "failed");
    assert.equal(result.checkpoint.status, "not_written");
    assert.equal(counts(db).occurrences, before.occurrences + 1);
    assert.equal(counts(db).checkpoints, before.checkpoints);
    assert.equal(result.retryAttempted, false);
  });
});

test("Q. relation failure → primary kept / checkpoint / warning", async () => {
  const db = openMemoryDb();
  seedCoveredAndEligible(db);
  const before = counts(db);
  const extractor = countingExtractor(newFromUnits("人間関係"));
  const result = await runProcessor(db, {
    extractCandidates: extractor.extractCandidates,
    applyExisting: (plans, deps) =>
      applyExistingMatchOccurrencesThenReconcile(plans, {
        ...deps,
        reconcile: () => {
          throw new Error("injected relation failure");
        },
      }),
  });
  assert.equal(result.status, "completed");
  assert.equal(result.existingPrimary.status, "applied");
  assert.equal(result.checkpoint.status, "completed");
  assert.equal(result.relationReconciliation.warnings.length >= 1, true);
  assert.equal(counts(db).occurrences, before.occurrences + 1);
  assert.equal(counts(db).checkpoints, before.checkpoints + 1);
});

test("R. checkpoint failure → primary kept / observable / no retry", async () => {
  const db = openMemoryDb();
  seedCoveredAndEligible(db);
  const before = counts(db);
  const extractor = countingExtractor(newFromUnits("人間関係"));
  const result = await runProcessor(db, {
    extractCandidates: extractor.extractCandidates,
    writeCheckpoint: () =>
      ({
        ok: false,
        code: "injected_checkpoint_failure",
        detail: "test",
      }) as never,
  });
  assert.equal(result.status, "failed");
  assert.equal(result.reason, "checkpoint_failed");
  assert.equal(result.existingPrimary.status, "applied");
  assert.equal(result.checkpoint.status, "failed");
  assert.equal(counts(db).occurrences, before.occurrences + 1);
  assert.equal(counts(db).checkpoints, before.checkpoints);
  assert.equal(result.retryAttempted, false);
});

test("S. successful second call → already_covered / LLM 0", async () => {
  const db = openMemoryDb();
  seedCoveredAndEligible(db);
  const firstExtractor = countingExtractor(newFromUnits("人間関係"));
  const first = await runProcessor(db, {
    extractCandidates: firstExtractor.extractCandidates,
  });
  assert.equal(first.status, "completed");
  const before = counts(db);
  const secondExtractor = countingExtractor();
  const second = await runProcessor(db, {
    extractCandidates: secondExtractor.extractCandidates,
  });
  assert.equal(second.status, "already_covered");
  assert.equal(secondExtractor.calls(), 0);
  assert.equal(second.assessmentCalls, 0);
  assert.deepEqual(counts(db), before);
});

test("T/U/V/Y/Z. frozen intents, provisional skip, no retry, order", async () => {
  await withAssessmentEnv(async () => {
    const db = openMemoryDb();
    seedCoveredAndEligible(db, USER_MIXED);
    const extractor = countingExtractor(async (units) => {
      const evidenceRef = units[0]!.evidenceRef;
      return [
        { action: "new", evidenceRef, surfaceForm: "人間関係" },
        { action: "new", evidenceRef, surfaceForm: "統合支援ツール" },
        {
          action: "match",
          evidenceRef,
          surfaceForm: "寂しさ",
          existingConceptRef: HUMAN_ID,
        },
      ];
    });
    const result = await runProcessor(db, {
      extractCandidates: extractor.extractCandidates,
      generateStructured: stubAssessment(),
    });
    assert.equal(result.status, "completed");
    assert.equal(result.frozenExistingIntentUsed, true);
    assert.equal(result.frozenNewIntentUsed, true);
    assert.equal(result.planning.provisionalNewCount, 1);
    assert.equal(result.retryAttempted, false);
    assert.equal(result.extractionCalls, 1);
    const freezeExisting = result.stageOrder.indexOf("freeze_existing");
    const freezeNew = result.stageOrder.indexOf("freeze_new");
    const assessment = result.stageOrder.indexOf("assessment");
    const existingPrimary = result.stageOrder.indexOf("existing_primary");
    const newPrimary = result.stageOrder.indexOf("new_primary");
    assert.ok(freezeExisting >= 0 && freezeNew >= 0);
    assert.ok(assessment > freezeNew);
    assert.ok(existingPrimary > assessment);
    assert.ok(newPrimary > existingPrimary);
    assertNoUserPayload(result);
  });
});
