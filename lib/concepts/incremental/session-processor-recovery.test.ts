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
import { markIncrementalConceptSessionCompleted } from "./checkpoint";
import {
  loadInitialConceptProcessingCoverage,
  type InitialConceptProcessingCoverageLoad,
} from "./eligibility";
import { applyIncrementalNewAdmissionManifestThenReconcile } from "./new-admission-lifecycle";
import type { IncrementalCandidateExtractor } from "./session-plan";
import {
  processIncrementalConceptSession,
  type ProcessIncrementalConceptSessionDeps,
} from "./session-processor";
import { buildIncrementalConceptSessionPreparedPayload } from "./session-run-payload";
import {
  countIncrementalSessionRuns,
  insertPreparedIncrementalSessionRun,
  updateIncrementalSessionRunPhase,
} from "./session-run-store";

const COVERED_WITH_OCC = "session-covered-occ";
const COVERED_ZERO_OCC = "session-covered-zero";
const ELIGIBLE = "session-eligible";
const HUMAN_ID = "concept-human-relations";
const USER_A =
  "これまでの人間関係でなぜ上手くいかないのか理解できないと思った。";
const USER_MIXED =
  "人間関係と寂しさと統合支援ツールについて同じ文で考えています。";
const USER_NEW = "睡眠の質について今日は落ち着いて考えられた。";

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
    runs: countIncrementalSessionRuns(db),
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
  insertConceptOccurrence(
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
      ...input,
    },
  );
}

test("E. fresh existing-only — prepared run before Existing write", async () => {
  const db = openMemoryDb();
  seedCoveredAndEligible(db);
  const result = await runProcessor(db, {
    extractCandidates: countingExtractor(newFromUnits("人間関係"))
      .extractCandidates,
  });
  assert.equal(result.status, "completed");
  assert.equal(result.executionMode, "fresh");
  assert.ok(result.runId);
  const persistAt = result.stageOrder.indexOf("prepared_run_persist");
  const existingPrimaryAt = result.stageOrder.indexOf("existing_primary");
  assert.ok(persistAt >= 0);
  assert.ok(existingPrimaryAt > persistAt);
  assert.equal(counts(db).runs, 1);
});

test("F. fresh NEW — prepared run before NEW write", async () => {
  await withAssessmentEnv(async () => {
    const db = openMemoryDb();
    seedCoveredAndEligible(db, USER_NEW);
    const result = await runProcessor(db, {
      extractCandidates: countingExtractor(newFromUnits("睡眠の質"))
        .extractCandidates,
      generateStructured: stubAssessment(),
    });
    assert.equal(result.status, "completed");
    const persistAt = result.stageOrder.indexOf("prepared_run_persist");
    const newPrimaryAt = result.stageOrder.indexOf("new_primary");
    assert.ok(persistAt >= 0);
    assert.ok(newPrimaryAt > persistAt);
  });
});

test("G. fresh existing + NEW — prepared run before first primary write", async () => {
  await withAssessmentEnv(async () => {
    const db = openMemoryDb();
    seedCoveredAndEligible(db, USER_MIXED);
    const result = await runProcessor(db, {
      extractCandidates: countingExtractor(async (units) => {
        const evidenceRef = units[0]!.evidenceRef;
        return [
          { action: "new", evidenceRef, surfaceForm: "人間関係" },
          { action: "new", evidenceRef, surfaceForm: "統合支援ツール" },
        ];
      }).extractCandidates,
      generateStructured: stubAssessment(),
    });
    assert.equal(result.status, "completed");
    const persistAt = result.stageOrder.indexOf("prepared_run_persist");
    const existingPrimaryAt = result.stageOrder.indexOf("existing_primary");
    assert.ok(persistAt >= 0);
    assert.ok(existingPrimaryAt > persistAt);
  });
});

test("H. candidate 0 — prepared run before checkpoint", async () => {
  const db = openMemoryDb();
  seedCoveredAndEligible(db);
  const extractor = countingExtractor(async () => []);
  const result = await runProcessor(db, {
    extractCandidates: extractor.extractCandidates,
  });
  assert.equal(result.status, "completed");
  assert.equal(result.planning.status, "no_actions");
  const persistAt = result.stageOrder.indexOf("prepared_run_persist");
  const checkpointAt = result.stageOrder.indexOf("checkpoint");
  assert.ok(persistAt >= 0);
  assert.ok(checkpointAt > persistAt);
});

test("I. provisional-only — prepared run before checkpoint", async () => {
  const db = openMemoryDb();
  seedCoveredAndEligible(db, USER_MIXED);
  const result = await runProcessor(db, {
    extractCandidates: countingExtractor(async (units) => [
      {
        action: "match",
        evidenceRef: units[0]!.evidenceRef,
        surfaceForm: "寂しさ",
        existingConceptRef: HUMAN_ID,
      },
    ]).extractCandidates,
  });
  assert.equal(result.status, "completed");
  assert.equal(result.planning.provisionalNewCount, 1);
  assert.ok(result.stageOrder.includes("prepared_run_persist"));
});

test("J. partial primary — second invocation Extraction=0 Assessment=0", async () => {
  await withAssessmentEnv(async () => {
    const db = openMemoryDb();
    seedCoveredAndEligible(db, USER_MIXED);
    let newCalls = 0;
    const first = await runProcessor(db, {
      extractCandidates: countingExtractor(async (units) => {
        const evidenceRef = units[0]!.evidenceRef;
        return [
          { action: "new", evidenceRef, surfaceForm: "人間関係" },
          { action: "new", evidenceRef, surfaceForm: "統合支援ツール" },
        ];
      }).extractCandidates,
      generateStructured: stubAssessment(),
      applyNew: (manifest, deps) => {
        newCalls += 1;
        if (newCalls === 1) {
          return {
            primary: {
              ok: false,
              status: "blocked",
              transactionCommitted: false,
              code: "injected_new_primary",
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
          } as never;
        }
        return applyIncrementalNewAdmissionManifestThenReconcile(manifest, deps);
      },
    });
    assert.equal(first.status, "failed");
    assert.equal(first.reason, "partial_primary_commit");
    assert.equal(first.extractionCalls, 1);
    assert.equal(first.assessmentCalls, 1);
    assert.equal(counts(db).runs, 1);

    const secondExtractor = countingExtractor();
    const second = await runProcessor(db, {
      extractCandidates: secondExtractor.extractCandidates,
      generateStructured: unusedStructured(),
    });
    assert.equal(second.status, "completed");
    assert.equal(second.executionMode, "resumed");
    assert.equal(secondExtractor.calls(), 0);
    assert.equal(second.extractionCalls, 0);
    assert.equal(second.assessmentCalls, 0);
    assert.equal(second.existingPrimary.alreadyPresent >= 1, true);
    assert.equal(second.newPrimary.status, "applied");
    assert.equal(second.checkpoint.status, "completed");
  });
});

test("K. checkpoint failure — second invocation LLM 0", async () => {
  const db = openMemoryDb();
  seedCoveredAndEligible(db);
  let checkpointCalls = 0;
  const first = await runProcessor(db, {
    extractCandidates: countingExtractor(newFromUnits("人間関係"))
      .extractCandidates,
    writeCheckpoint: (proof, ctx) => {
      checkpointCalls += 1;
      if (checkpointCalls === 1) {
        return {
          ok: false,
          code: "injected_checkpoint_failure",
          detail: "test",
        } as never;
      }
      return markIncrementalConceptSessionCompleted(proof, ctx);
    },
  });
  assert.equal(first.status, "failed");
  assert.equal(first.reason, "checkpoint_failed");

  const secondExtractor = countingExtractor();
  const second = await runProcessor(db, {
    extractCandidates: secondExtractor.extractCandidates,
    writeCheckpoint: markIncrementalConceptSessionCompleted,
  });
  assert.equal(second.status, "completed");
  assert.equal(secondExtractor.calls(), 0);
  assert.equal(second.extractionCalls, 0);
  assert.equal(second.assessmentCalls, 0);
  assert.equal(second.checkpoint.status, "completed");
});

test("L. no-actions checkpoint failure resume — LLM 0", async () => {
  const db = openMemoryDb();
  seedCoveredAndEligible(db);
  let checkpointCalls = 0;
  const first = await runProcessor(db, {
    extractCandidates: countingExtractor(async () => []).extractCandidates,
    writeCheckpoint: () => {
      checkpointCalls += 1;
      if (checkpointCalls === 1) {
        return { ok: false, code: "injected_checkpoint", detail: "x" } as never;
      }
      throw new Error("unexpected");
    },
  });
  assert.equal(first.status, "failed");
  const second = await runProcessor(db, {
    extractCandidates: countingExtractor().extractCandidates,
    writeCheckpoint: markIncrementalConceptSessionCompleted,
  });
  assert.equal(second.extractionCalls, 0);
  assert.equal(second.assessmentCalls, 0);
  assert.equal(second.status, "completed");
});

test("M. provisional-only checkpoint failure resume — LLM 0", async () => {
  const db = openMemoryDb();
  seedCoveredAndEligible(db, USER_MIXED);
  let checkpointCalls = 0;
  const first = await runProcessor(db, {
    extractCandidates: countingExtractor(async (units) => [
      {
        action: "match",
        evidenceRef: units[0]!.evidenceRef,
        surfaceForm: "寂しさ",
        existingConceptRef: HUMAN_ID,
      },
    ]).extractCandidates,
    writeCheckpoint: () => {
      checkpointCalls += 1;
      if (checkpointCalls === 1) {
        return { ok: false, code: "injected_checkpoint", detail: "x" } as never;
      }
      throw new Error("unexpected");
    },
  });
  assert.equal(first.status, "failed");
  const second = await runProcessor(db, {
    extractCandidates: countingExtractor().extractCandidates,
    writeCheckpoint: markIncrementalConceptSessionCompleted,
  });
  assert.equal(second.extractionCalls, 0);
  assert.equal(second.assessmentCalls, 0);
  assert.equal(second.status, "completed");
});

test("S. existing phase update failure — resume succeeds LLM 0", async () => {
  const db = openMemoryDb();
  seedCoveredAndEligible(db);
  const first = await runProcessor(db, {
    extractCandidates: countingExtractor(newFromUnits("人間関係"))
      .extractCandidates,
    updateRunPhase: (input) => {
      if (input.phase === "existing_primary_done") {
        throw new Error("phase update failed");
      }
      updateIncrementalSessionRunPhase(input);
    },
  });
  assert.equal(first.status, "completed");

  const second = await runProcessor(db, {
    extractCandidates: countingExtractor().extractCandidates,
  });
  assert.equal(second.status, "already_covered");
  assert.equal(second.extractionCalls, 0);
  assert.equal(second.assessmentCalls, 0);
});

test("T. NEW phase update failure — exact verifier resume LLM 0", async () => {
  await withAssessmentEnv(async () => {
    const db = openMemoryDb();
    seedCoveredAndEligible(db, USER_NEW);
    let updateCalls = 0;
    const first = await runProcessor(db, {
      extractCandidates: countingExtractor(newFromUnits("睡眠の質"))
        .extractCandidates,
      generateStructured: stubAssessment(),
      updateRunPhase: (input) => {
        if (input.phase === "new_primary_done") {
          updateCalls += 1;
          throw new Error("phase update failed");
        }
        updateIncrementalSessionRunPhase(input);
      },
    });
    assert.equal(first.status, "completed");
    assert.equal(updateCalls, 1);

    db.delete(schema.conceptProcessingCheckpoints).run();
    const second = await runProcessor(db, {
      extractCandidates: countingExtractor().extractCandidates,
      generateStructured: unusedStructured(),
    });
    assert.equal(second.status, "completed", second.reason ?? "");
    assert.equal(second.executionMode, "resumed");
    assert.equal(second.extractionCalls, 0);
    assert.equal(second.assessmentCalls, 0);
  });
});

test("U. checkpoint success + run completion update failure → next already_covered", async () => {
  const db = openMemoryDb();
  seedCoveredAndEligible(db);
  const first = await runProcessor(db, {
    extractCandidates: countingExtractor(newFromUnits("人間関係"))
      .extractCandidates,
    updateRunPhase: (input) => {
      if (input.phase === "checkpoint_done") {
        throw new Error("run completion update failed");
      }
      updateIncrementalSessionRunPhase(input);
    },
  });
  assert.equal(first.status, "completed");

  const second = await runProcessor(db, {
    extractCandidates: countingExtractor().extractCandidates,
  });
  assert.equal(second.status, "already_covered");
  assert.equal(second.extractionCalls, 0);
  assert.equal(second.assessmentCalls, 0);
});

test("V. duplicate prepared insertion — one row", () => {
  const db = openMemoryDb();
  seedSession(db, ELIGIBLE);
  const payload = {
    sessionId: ELIGIBLE,
    planning: {
      status: "no_actions" as const,
      existingMatchCount: 0,
      newCandidateCount: 0,
      provisionalNewCount: 0,
      groundingRejectedCount: 0,
    },
    existingAppendIntent: null,
    newAssessmentIntent: null,
    newAdmissionManifest: null,
  };
  const built = buildIncrementalConceptSessionPreparedPayload(payload);
  const a = insertPreparedIncrementalSessionRun({
    sessionId: ELIGIBLE,
    payload: built,
    db,
    createRunId: () => "run-v1",
  });
  const b = insertPreparedIncrementalSessionRun({
    sessionId: ELIGIBLE,
    payload: built,
    db,
    createRunId: () => "run-v2",
  });
  assert.equal(a.ok, true);
  assert.equal(b.ok, false);
  assert.equal(counts(db).runs, 1);
});

test("W. race loser uses winner durable payload", async () => {
  const db = openMemoryDb();
  seedCoveredAndEligible(db);
  let persistCalls = 0;
  const loser = await runProcessor(db, {
    extractCandidates: countingExtractor(newFromUnits("人間関係"))
      .extractCandidates,
    persistPreparedRun: (input) => {
      persistCalls += 1;
      if (persistCalls === 1) {
        insertPreparedIncrementalSessionRun({
          ...input,
          createRunId: () => "winner-run",
        });
        return { ok: false, code: "unique_conflict" };
      }
      return insertPreparedIncrementalSessionRun(input);
    },
  });
  assert.equal(persistCalls, 1);
  assert.equal(loser.executionMode, "resumed");
  assert.equal(loser.extractionCalls, 1);
  assert.equal(loser.status, "completed");
  assert.equal(loser.existingPrimary.status, "applied");
  assert.equal(counts(db).runs, 1);
});

test("X. relation failure — concept completion / checkpoint still possible", async () => {
  const db = openMemoryDb();
  seedCoveredAndEligible(db);
  const result = await runProcessor(db, {
    extractCandidates: countingExtractor(newFromUnits("人間関係"))
      .extractCandidates,
    applyExisting: (plans, deps) =>
      applyExistingMatchOccurrencesThenReconcile(plans, {
        ...deps,
        reconcile: () => {
          throw new Error("injected relation failure");
        },
      }),
  });
  assert.equal(result.status, "completed");
  assert.equal(result.checkpoint.status, "completed");
  assert.ok(result.relationReconciliation.warnings.length >= 1);
});

test("Y. resumed already-applied stage retries relation reconciliation", async () => {
  await withAssessmentEnv(async () => {
    const db = openMemoryDb();
    seedCoveredAndEligible(db, USER_MIXED);
    let newCalls = 0;
    const first = await runProcessor(db, {
      extractCandidates: countingExtractor(async (units) => {
        const evidenceRef = units[0]!.evidenceRef;
        return [
          { action: "new", evidenceRef, surfaceForm: "人間関係" },
          { action: "new", evidenceRef, surfaceForm: "統合支援ツール" },
        ];
      }).extractCandidates,
      generateStructured: stubAssessment(),
      applyNew: (manifest, deps) => {
        newCalls += 1;
        if (newCalls === 1) {
          return {
            primary: {
              ok: false,
              status: "blocked",
              transactionCommitted: false,
              code: "injected_new_primary",
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
          } as never;
        }
        return applyIncrementalNewAdmissionManifestThenReconcile(manifest, {
          ...deps,
          reconcile: () => {
            throw new Error("injected relation failure");
          },
        });
      },
    });
    assert.equal(first.status, "failed");

    const second = await runProcessor(db, {
      extractCandidates: countingExtractor().extractCandidates,
      generateStructured: unusedStructured(),
    });
    assert.equal(second.status, "completed");
    assert.equal(second.extractionCalls, 0);
    assert.equal(second.assessmentCalls, 0);
  });
});

test("Z. fresh normalizedKey conflict semantics unchanged", async () => {
  await withAssessmentEnv(async () => {
    const db = openMemoryDb();
    seedCoveredAndEligible(db, USER_NEW);
    const result = await runProcessor(db, {
      extractCandidates: countingExtractor(newFromUnits("睡眠の質"))
        .extractCandidates,
      generateStructured: stubAssessment(),
      applyNew: () =>
        ({
          primary: {
            ok: false,
            status: "blocked",
            transactionCommitted: false,
            code: "normalized_key_conflict",
            detail: "test",
            conceptsCreated: 0,
            occurrencesCreated: 0,
            aliasesCreated: 0,
            alreadyPresent: 0,
            conflicts: [
              {
                candidateRef: "injected",
                code: "normalized_key_conflict",
                detail: "test",
              },
            ],
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
    assert.equal(result.newPrimary.code, "normalized_key_conflict");
    assert.equal(result.executionMode, "fresh");
    assert.equal(result.checkpoint.status, "not_written");
  });
});

test("corrupt prepared run → blocked / no primary write", async () => {
  const db = openMemoryDb();
  seedCoveredAndEligible(db);
  db.insert(schema.conceptIncrementalSessionRuns)
    .values({
      runId: "corrupt-run",
      sessionId: ELIGIBLE,
      processingVersion: "concept-incremental-processing-v1",
      processorVersion: "incremental-concept-session-processor-v0",
      runVersion: "incremental-concept-session-run-v1",
      phase: "prepared",
      preparedPayload: "{bad",
      lastFailureStage: null,
      lastFailureCode: null,
      createdAt: "2026-08-24T00:00:00.000Z",
      updatedAt: "2026-08-24T00:00:00.000Z",
    })
    .run();
  const before = counts(db);
  const result = await runProcessor(db, {
    extractCandidates: countingExtractor(newFromUnits("人間関係"))
      .extractCandidates,
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.reason, "invalid_prepared_run");
  assert.equal(result.extractionCalls, 0);
  assert.equal(result.assessmentCalls, 0);
  assert.deepEqual(counts(db).concepts, before.concepts);
  assert.deepEqual(counts(db).occurrences, before.occurrences);
});

test("prepared persist failure → no primary writes", async () => {
  const db = openMemoryDb();
  seedCoveredAndEligible(db);
  const before = counts(db);
  const result = await runProcessor(db, {
    extractCandidates: countingExtractor(newFromUnits("人間関係"))
      .extractCandidates,
    persistPreparedRun: () => ({ ok: false, code: "insert_failed" }),
  });
  assert.equal(result.status, "failed");
  assert.equal(result.reason, "prepared_run_persist_failed");
  assert.equal(result.existingPrimary.status, "not_started");
  assert.deepEqual(counts(db).occurrences, before.occurrences);
  assert.equal(counts(db).checkpoints, before.checkpoints);
});
