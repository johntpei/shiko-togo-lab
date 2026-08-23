import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { CONCEPT_EXTRACT_PROMPT_VERSION } from "@/lib/ai/prompts/concept-extract";
import { hashSourceArtifactText } from "@/lib/concepts/admission/apply-manifest";
import { CONCEPT_INCREMENTAL_PROCESSING_VERSION } from "@/lib/concepts/incremental/checkpoint";
import { loadInitialConceptProcessingCoverage } from "@/lib/concepts/incremental/eligibility";
import { CONCEPT_EXTRACTION_VERSION } from "@/lib/concepts/types";
import { applySqlMigrations } from "@/lib/db/client";
import {
  countConceptOccurrences,
  insertConcept,
  insertConceptOccurrence,
} from "@/lib/db/concept-queries";
import { countObservations } from "@/lib/db/observation-queries";
import * as schema from "@/lib/db/schema";
import { REVIEW_OBSERVATION_VERSION } from "@/lib/observations/types";
import { parseDualPipelineOrchestratorPlanArgs } from "./args";
import {
  loadDualPipelineOrchestratorPlan,
  loadInitialConceptCoverageFromCandidateText,
} from "./load";
import {
  buildDualPipelineOrchestratorPlan,
  formatDualPipelineOrchestratorPlan,
} from "./plan";
import {
  DUAL_PIPELINE_ORCHESTRATOR_CODE_FACTS,
  DUAL_PIPELINE_ORCHESTRATOR_PLAN_VERSION,
  type DualPipelineOrchestratorPlanInput,
} from "./types";

const USER_QUOTE = "SECRET_USER_QUOTE_orchestrator_plan";

function emptyInput(): DualPipelineOrchestratorPlanInput {
  return {
    requestedSessionIds: [],
    existingSessionIds: [],
    conceptEvaluations: [],
    reviewCoveredSessionIds: [],
  };
}

function openMemoryDb() {
  const sqlite = new Database(":memory:");
  applySqlMigrations(sqlite);
  sqlite.pragma("foreign_keys = ON");
  return drizzle(sqlite, { schema });
}

function seedSession(
  db: ReturnType<typeof openMemoryDb>,
  id: string,
  occurredAt = "2026-08-02",
  title = id,
) {
  db.insert(schema.sessions)
    .values({
      id,
      title,
      occurredAt,
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
}

function seedMessage(
  db: ReturnType<typeof openMemoryDb>,
  input: { id: string; sessionId: string },
) {
  db.insert(schema.messages)
    .values({
      id: input.id,
      sessionId: input.sessionId,
      index: 0,
      role: "user",
      content: "x",
      charStart: 0,
      charEnd: 1,
      sourceMessageId: null,
      sourceCreatedAt: null,
      contentType: "text",
      attachmentsJson: null,
    })
    .run();
}

function seedReview(db: ReturnType<typeof openMemoryDb>, id: string) {
  db.insert(schema.reviews)
    .values({
      id,
      title: id,
      model: "test",
      promptVersion: "integrated-review-v5",
      payload: "{}",
      createdAt: "2026-08-18T00:00:00.000Z",
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

function coverageFor(sessionIds: string[]) {
  const text = JSON.stringify(candidateReport(sessionIds));
  return loadInitialConceptProcessingCoverage({
    candidateReportText: text,
    expectedSourceHash: hashSourceArtifactText(text),
  });
}

test("A. empty selection is a valid no_selection plan", () => {
  const plan = buildDualPipelineOrchestratorPlan(emptyInput());
  assert.equal(plan.version, DUAL_PIPELINE_ORCHESTRATOR_PLAN_VERSION);
  assert.equal(plan.authorizesExecution, false);
  assert.equal(plan.concept.action, "no_selection");
  assert.equal(plan.review.action, "no_selection");
  assert.equal(plan.workload.conceptExtractionCallsKnown, 0);
  assert.equal(plan.workload.reviewCallsKnown, 0);
  assert.equal(plan.codeFacts.triggerPolicy, "explicit_session_selection");
});

test("B. missing Session is invalid and not execution-ready", () => {
  const plan = buildDualPipelineOrchestratorPlan({
    ...emptyInput(),
    requestedSessionIds: ["s-missing"],
    existingSessionIds: [],
  });
  assert.deepEqual(plan.selection.invalidSessionIds, ["s-missing"]);
  assert.equal(plan.concept.action, "no_valid_session");
  assert.equal(plan.review.action, "no_valid_session");
  assert.equal(plan.review.executionReady, false);
  assert.equal(plan.concept.executionReady, false);
});

test("C. duplicate Session IDs are deduped", () => {
  const plan = buildDualPipelineOrchestratorPlan({
    ...emptyInput(),
    requestedSessionIds: [" s-b ", "s-a", "s-b", "s-a"],
    existingSessionIds: ["s-a", "s-b"],
    conceptEvaluations: [
      { sessionId: "s-a", status: "eligible", reason: "not_covered" },
      { sessionId: "s-b", status: "eligible", reason: "not_covered" },
    ],
  });
  assert.deepEqual(plan.selection.requestedSessionIds, ["s-a", "s-b"]);
  assert.deepEqual(plan.selection.validSessionIds, ["s-a", "s-b"]);
});

test("D. Concept initial coverage is covered", () => {
  const plan = buildDualPipelineOrchestratorPlan({
    ...emptyInput(),
    requestedSessionIds: ["s-a"],
    existingSessionIds: ["s-a"],
    conceptEvaluations: [
      {
        sessionId: "s-a",
        status: "already_covered",
        reason: "initial_processing_coverage",
      },
    ],
  });
  assert.deepEqual(plan.concept.coveredSessionIds, ["s-a"]);
  assert.equal(plan.concept.action, "not_needed");
  assert.equal(plan.concept.sessions[0]?.reason, "initial_processing_coverage");
});

test("E. Concept checkpoint coverage is covered", () => {
  const plan = buildDualPipelineOrchestratorPlan({
    ...emptyInput(),
    requestedSessionIds: ["s-b"],
    existingSessionIds: ["s-b"],
    conceptEvaluations: [
      {
        sessionId: "s-b",
        status: "already_covered",
        reason: "incremental_processing_checkpoint",
      },
    ],
  });
  assert.deepEqual(plan.concept.coveredSessionIds, ["s-b"]);
  assert.equal(plan.concept.action, "not_needed");
});

test("F. Concept uncovered needs_processing", () => {
  const plan = buildDualPipelineOrchestratorPlan({
    ...emptyInput(),
    requestedSessionIds: ["s-a"],
    existingSessionIds: ["s-a"],
    conceptEvaluations: [
      { sessionId: "s-a", status: "eligible", reason: "not_covered" },
    ],
  });
  assert.deepEqual(plan.concept.needsProcessingSessionIds, ["s-a"]);
  assert.equal(plan.concept.action, "needs_processing");
  assert.equal(plan.concept.executionReady, false);
  assert.equal(
    plan.concept.blockingReason,
    "unified_session_processor_missing",
  );
});

test("G. ConceptOccurrence alone is not Concept covered", () => {
  const db = openMemoryDb();
  seedSession(db, "s-occ", "2026-08-10");
  seedMessage(db, { id: "m-occ", sessionId: "s-occ" });
  const concept = insertConcept(
    {
      id: "c-1",
      canonicalLabel: "ThemeA",
      createdAt: "2026-08-10T00:00:00.000Z",
    },
    db,
  );
  assert.equal(concept.status, "inserted");
  const occ = insertConceptOccurrence(
    {
      id: "occ-1",
      conceptId: "c-1",
      sessionId: "s-occ",
      messageId: "m-occ",
      evidenceRef: "M001:E01",
      occurredAt: "2026-08-10T00:00:00.000Z",
      sourceRole: "user",
      sourceType: "evidence_unit",
      extractionVersion: CONCEPT_EXTRACTION_VERSION,
    },
    db,
  );
  assert.equal(occ.status, "inserted");
  assert.equal(countConceptOccurrences(db), 1);
  const plan = loadDualPipelineOrchestratorPlan({
    db,
    sessionIds: ["s-occ"],
    initialCoverage: coverageFor([]),
  });
  assert.deepEqual(plan.concept.needsProcessingSessionIds, ["s-occ"]);
  assert.equal(plan.concept.coveredSessionIds.length, 0);
});

test("H. Review covered comes from review_sessions", () => {
  const db = openMemoryDb();
  seedSession(db, "s-a", "2026-08-01");
  seedSession(db, "s-b", "2026-08-02");
  seedReview(db, "r-1");
  db.insert(schema.reviewSessions)
    .values([
      { reviewId: "r-1", sessionId: "s-a" },
      { reviewId: "r-1", sessionId: "s-b" },
    ])
    .run();
  const plan = loadDualPipelineOrchestratorPlan({
    db,
    sessionIds: ["s-b", "s-a"],
    initialCoverage: coverageFor([]),
  });
  assert.deepEqual(plan.review.coveredSessionIds, ["s-a", "s-b"]);
  assert.equal(plan.review.action, "not_needed");
  assert.equal(plan.review.executionReady, false);
});

test("I. Observation link alone is not Review covered", () => {
  const db = openMemoryDb();
  seedSession(db, "s-a", "2026-08-01", USER_QUOTE);
  seedSession(db, "s-b", "2026-08-02");
  seedMessage(db, { id: "m-1", sessionId: "s-a" });
  seedReview(db, "r-1");
  db.insert(schema.observations)
    .values({
      id: "o-1",
      kind: "connection",
      projectionVersion: REVIEW_OBSERVATION_VERSION,
      sourceReviewId: "r-1",
      sourceRef: "o-1",
      title: USER_QUOTE,
      body: USER_QUOTE,
      supportType: null,
      payload: "{}",
      firstSeenAt: "2026-08-01",
      lastSeenAt: "2026-08-01",
      detectedAt: "2026-08-18T00:00:00.000Z",
      distinctSessionCount: 1,
      createdAt: "2026-08-18T00:00:00.000Z",
    })
    .run();
  db.insert(schema.observationSessions)
    .values({ observationId: "o-1", sessionId: "s-a" })
    .run();
  assert.equal(countObservations(db), 1);
  const plan = loadDualPipelineOrchestratorPlan({
    db,
    sessionIds: ["s-a", "s-b"],
    initialCoverage: coverageFor([]),
  });
  assert.deepEqual(plan.review.uncoveredSessionIds, ["s-a", "s-b"]);
  assert.equal(plan.review.action, "run_for_selection");
  assert.doesNotMatch(formatDualPipelineOrchestratorPlan(plan), new RegExp(USER_QUOTE));
  assert.doesNotMatch(JSON.stringify(plan), new RegExp(USER_QUOTE));
});

test("J. Review selection of 1 Session is blocked; Concept plan is kept", () => {
  const plan = buildDualPipelineOrchestratorPlan({
    ...emptyInput(),
    requestedSessionIds: ["s-a"],
    existingSessionIds: ["s-a"],
    conceptEvaluations: [
      { sessionId: "s-a", status: "eligible", reason: "not_covered" },
    ],
  });
  assert.equal(plan.review.action, "blocked");
  assert.equal(
    plan.review.blockingReason,
    "review_requires_at_least_two_sessions",
  );
  assert.equal(plan.concept.action, "needs_processing");
  assert.deepEqual(plan.concept.needsProcessingSessionIds, ["s-a"]);
});

test("K. Review selection of 2 uncovered Sessions is run_for_selection", () => {
  const plan = buildDualPipelineOrchestratorPlan({
    ...emptyInput(),
    requestedSessionIds: ["s-b", "s-a"],
    existingSessionIds: ["s-a", "s-b"],
    conceptEvaluations: [
      { sessionId: "s-a", status: "eligible", reason: "not_covered" },
      { sessionId: "s-b", status: "eligible", reason: "not_covered" },
    ],
  });
  assert.equal(plan.review.action, "run_for_selection");
  assert.equal(plan.review.executionReady, true);
  assert.deepEqual(plan.review.selectedSessionIds, ["s-a", "s-b"]);
  assert.equal(plan.workload.reviewCallsKnown, 1);
  assert.equal(plan.workload.conceptExtractionCallsKnown, 2);
  assert.equal(plan.workload.conceptAssessmentCalls, "unknown_until_extraction");
});

test("L. mixed Review coverage does not shrink selection", () => {
  const plan = buildDualPipelineOrchestratorPlan({
    ...emptyInput(),
    requestedSessionIds: ["s-a", "s-b"],
    existingSessionIds: ["s-a", "s-b"],
    conceptEvaluations: [
      { sessionId: "s-a", status: "eligible", reason: "not_covered" },
      { sessionId: "s-b", status: "eligible", reason: "not_covered" },
    ],
    reviewCoveredSessionIds: ["s-a"],
  });
  assert.deepEqual(plan.review.selectedSessionIds, ["s-a", "s-b"]);
  assert.deepEqual(plan.review.coveredSessionIds, ["s-a"]);
  assert.deepEqual(plan.review.uncoveredSessionIds, ["s-b"]);
  assert.equal(plan.review.action, "run_for_selection");
});

test("M. all Review-covered Sessions are not_needed for coverage fill", () => {
  const plan = buildDualPipelineOrchestratorPlan({
    ...emptyInput(),
    requestedSessionIds: ["s-a", "s-b"],
    existingSessionIds: ["s-a", "s-b"],
    conceptEvaluations: [
      {
        sessionId: "s-a",
        status: "already_covered",
        reason: "initial_processing_coverage",
      },
      {
        sessionId: "s-b",
        status: "already_covered",
        reason: "initial_processing_coverage",
      },
    ],
    reviewCoveredSessionIds: ["s-a", "s-b"],
  });
  assert.equal(plan.review.action, "not_needed");
  assert.equal(plan.concept.action, "not_needed");
  assert.equal(plan.review.executionReady, false);
});

test("N. invalid + valid mix keeps stage status distinct", () => {
  const plan = buildDualPipelineOrchestratorPlan({
    ...emptyInput(),
    requestedSessionIds: ["s-missing", "s-a", "s-b"],
    existingSessionIds: ["s-a", "s-b"],
    conceptEvaluations: [
      { sessionId: "s-a", status: "eligible", reason: "not_covered" },
      { sessionId: "s-b", status: "eligible", reason: "not_covered" },
    ],
  });
  assert.deepEqual(plan.selection.invalidSessionIds, ["s-missing"]);
  assert.deepEqual(plan.selection.validSessionIds, ["s-a", "s-b"]);
  assert.equal(plan.concept.action, "needs_processing");
  assert.equal(plan.review.action, "run_for_selection");
});

test("O. Relation is not a primary stage", () => {
  const plan = buildDualPipelineOrchestratorPlan({
    ...emptyInput(),
    requestedSessionIds: ["s-a", "s-b"],
    existingSessionIds: ["s-a", "s-b"],
    conceptEvaluations: [
      { sessionId: "s-a", status: "eligible", reason: "not_covered" },
      { sessionId: "s-b", status: "eligible", reason: "not_covered" },
    ],
  });
  assert.equal(plan.relation.isPrimaryStage, false);
  assert.equal(plan.relation.mode, "automatic_after_primary_commit");
  assert.equal(plan.codeFacts.relationIsPrimaryStage, false);
});

test("P. Concept execution readiness is composable_but_not_wired", () => {
  const plan = buildDualPipelineOrchestratorPlan({
    ...emptyInput(),
    requestedSessionIds: ["s-a"],
    existingSessionIds: ["s-a"],
    conceptEvaluations: [
      { sessionId: "s-a", status: "eligible", reason: "not_covered" },
    ],
  });
  assert.equal(
    plan.codeFacts.conceptExecutionReadiness,
    "composable_but_not_wired",
  );
  assert.equal(plan.codeFacts.conceptUnifiedSessionProcessor, false);
  assert.equal(plan.codeFacts.conceptExistingAppendWritesCheckpoint, false);
  assert.equal(plan.codeFacts.conceptNewAdmissionDedicatedCli, false);
  assert.equal(plan.concept.executionReady, false);
});

test("Q. Review execution readiness uses existing production entry", () => {
  const plan = buildDualPipelineOrchestratorPlan({
    ...emptyInput(),
    requestedSessionIds: ["s-a", "s-b"],
    existingSessionIds: ["s-a", "s-b"],
    conceptEvaluations: [
      { sessionId: "s-a", status: "eligible", reason: "not_covered" },
      { sessionId: "s-b", status: "eligible", reason: "not_covered" },
    ],
  });
  assert.equal(
    plan.codeFacts.reviewProductionEntry,
    "createIntegratedReviewAction",
  );
  assert.equal(plan.codeFacts.reviewRepeatCreatesNewRow, true);
  assert.equal(plan.codeFacts.sessionAnalysesRequiredForReview, false);
  assert.equal(plan.review.executionReady, true);
});

test("R. known Concept extraction calls equal needs_processing count", () => {
  const plan = buildDualPipelineOrchestratorPlan({
    ...emptyInput(),
    requestedSessionIds: ["s-a", "s-b", "s-c"],
    existingSessionIds: ["s-a", "s-b", "s-c"],
    conceptEvaluations: [
      {
        sessionId: "s-a",
        status: "already_covered",
        reason: "initial_processing_coverage",
      },
      { sessionId: "s-b", status: "eligible", reason: "not_covered" },
      { sessionId: "s-c", status: "eligible", reason: "not_covered" },
    ],
  });
  assert.equal(plan.workload.conceptExtractionCallsKnown, 2);
  assert.equal(plan.workload.reviewCallsKnown, 1);
});

test("S. NEW assessment calls are unknown until extraction", () => {
  const plan = buildDualPipelineOrchestratorPlan({
    ...emptyInput(),
    requestedSessionIds: ["s-a", "s-b"],
    existingSessionIds: ["s-a", "s-b"],
    conceptEvaluations: [
      { sessionId: "s-a", status: "eligible", reason: "not_covered" },
      { sessionId: "s-b", status: "eligible", reason: "not_covered" },
    ],
  });
  assert.equal(plan.workload.conceptAssessmentCalls, "unknown_until_extraction");
});

test("T. plan and format omit USER text", () => {
  const plan = buildDualPipelineOrchestratorPlan({
    ...emptyInput(),
    requestedSessionIds: ["s-a", "s-b"],
    existingSessionIds: ["s-a", "s-b"],
    conceptEvaluations: [
      { sessionId: "s-a", status: "eligible", reason: "not_covered" },
      { sessionId: "s-b", status: "eligible", reason: "not_covered" },
    ],
  });
  const rendered = formatDualPipelineOrchestratorPlan(plan);
  assert.doesNotMatch(rendered, /SECRET_USER_QUOTE/);
  assert.doesNotMatch(JSON.stringify(plan), /title|quote|body|surfaceForm/);
});

test("U. planner does not import LLM provider", () => {
  const source = readFileSync(new URL("./plan.ts", import.meta.url), "utf8");
  const loadSource = readFileSync(new URL("./load.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /getAiProvider|generateStructured/);
  assert.doesNotMatch(loadSource, /getAiProvider|generateStructured/);
});

test("V. planner does not mutate DB", () => {
  const db = openMemoryDb();
  seedSession(db, "s-a");
  seedSession(db, "s-b");
  const before = {
    sessions: db.select().from(schema.sessions).all().length,
    reviews: db.select().from(schema.reviews).all().length,
    checkpoints: db.select().from(schema.conceptProcessingCheckpoints).all()
      .length,
  };
  loadDualPipelineOrchestratorPlan({
    db,
    sessionIds: ["s-a", "s-b"],
    initialCoverage: coverageFor([]),
  });
  assert.deepEqual(
    {
      sessions: db.select().from(schema.sessions).all().length,
      reviews: db.select().from(schema.reviews).all().length,
      checkpoints: db.select().from(schema.conceptProcessingCheckpoints).all()
        .length,
    },
    before,
  );
});

test("W. output is deterministic across input order", () => {
  const forward = buildDualPipelineOrchestratorPlan({
    ...emptyInput(),
    requestedSessionIds: ["s-b", "s-a"],
    existingSessionIds: ["s-b", "s-a"],
    conceptEvaluations: [
      { sessionId: "s-b", status: "eligible", reason: "not_covered" },
      { sessionId: "s-a", status: "eligible", reason: "not_covered" },
    ],
    reviewCoveredSessionIds: ["s-b"],
  });
  const reverse = buildDualPipelineOrchestratorPlan({
    ...emptyInput(),
    requestedSessionIds: ["s-a", "s-b"],
    existingSessionIds: ["s-a", "s-b"],
    conceptEvaluations: [
      { sessionId: "s-a", status: "eligible", reason: "not_covered" },
      { sessionId: "s-b", status: "eligible", reason: "not_covered" },
    ],
    reviewCoveredSessionIds: ["s-b"],
  });
  assert.deepEqual(forward, reverse);
});

test("loader reuses eligibility: initial coverage and checkpoint", () => {
  const db = openMemoryDb();
  seedSession(db, "s-initial", "2026-07-01");
  seedSession(db, "s-checkpoint", "2026-08-01");
  seedSession(db, "s-open", "2026-08-20");
  db.insert(schema.conceptProcessingCheckpoints)
    .values({
      sessionId: "s-checkpoint",
      processingVersion: CONCEPT_INCREMENTAL_PROCESSING_VERSION,
      completedAt: "2026-08-18T00:00:00.000Z",
      existingMatchCount: 0,
      newCandidateCount: 0,
      provisionalNewCount: 0,
      groundingRejectedCount: 0,
    })
    .run();
  const plan = loadDualPipelineOrchestratorPlan({
    db,
    sessionIds: ["s-open", "s-checkpoint", "s-initial"],
    initialCoverage: coverageFor(["s-initial"]),
  });
  assert.deepEqual(plan.concept.coveredSessionIds, [
    "s-checkpoint",
    "s-initial",
  ]);
  assert.deepEqual(plan.concept.needsProcessingSessionIds, ["s-open"]);
});

test("CLI requires --session and rejects --apply", () => {
  assert.equal(parseDualPipelineOrchestratorPlanArgs([]).ok, false);
  const apply = parseDualPipelineOrchestratorPlanArgs([
    "--session",
    "s-a",
    "--apply",
  ]);
  assert.equal(apply.ok, false);
  if (!apply.ok) {
    assert.equal(apply.code, "apply_not_allowed");
  }
  const parsed = parseDualPipelineOrchestratorPlanArgs([
    "--session",
    "s-b",
    "--session",
    "s-a",
  ]);
  assert.equal(parsed.ok, true);
  if (parsed.ok && !parsed.help) {
    assert.deepEqual(parsed.sessionIds, ["s-b", "s-a"]);
  }
});

test("empty selection does not scan all Sessions", () => {
  const db = openMemoryDb();
  seedSession(db, "s-a");
  seedSession(db, "s-b");
  const plan = loadDualPipelineOrchestratorPlan({
    db,
    sessionIds: [],
    initialCoverage: coverageFor([]),
  });
  assert.equal(plan.selection.requestedSessionIds.length, 0);
  assert.equal(plan.selection.validSessionIds.length, 0);
  assert.equal(plan.concept.action, "no_selection");
});

test("candidate coverage helper matches eligibility loader", () => {
  const text = JSON.stringify(candidateReport(["s-a"]));
  const coverage = loadInitialConceptCoverageFromCandidateText(text);
  assert.equal(coverage.ok, true);
});

test("code facts recommend unified Concept session processor", () => {
  assert.equal(
    DUAL_PIPELINE_ORCHESTRATOR_CODE_FACTS.recommendedNextStep,
    "unified_incremental_concept_session_processor",
  );
  assert.equal(
    DUAL_PIPELINE_ORCHESTRATOR_CODE_FACTS.recommendedStageOrder,
    "independent",
  );
});
