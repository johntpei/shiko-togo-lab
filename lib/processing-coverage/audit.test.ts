import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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
import {
  buildDualPipelineProcessingCoverageAudit,
  formatDualPipelineProcessingCoverageAudit,
} from "./audit";
import {
  loadDualPipelineProcessingCoverageAudit,
  loadInitialConceptCoverageFromCandidateText,
} from "./load";
import {
  DUAL_PIPELINE_PROCESSING_COVERAGE_AUDIT_VERSION,
  DUAL_PIPELINE_PRODUCTION_AUTOMATION,
  NATURAL_ACCUMULATION_CLASSIFICATION,
  type DualPipelineProcessingCoverageAuditInput,
} from "./types";

const USER_QUOTE = "SECRET_USER_QUOTE_dual_pipeline_coverage";

function emptyInput(): DualPipelineProcessingCoverageAuditInput {
  return {
    sessions: [],
    initialConceptCoveredSessionIds: [],
    incrementalCheckpointSessionIds: [],
    conceptOccurrenceSessionIds: [],
    reviews: [],
    reviewInputSessionIds: [],
    reviewsWithoutExplicitSessionScope: 0,
    evidenceSessionIds: [],
    observationSessionLinks: [],
    observations: [],
    supportRows: [],
    sessionAnalysisSessionIds: [],
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
) {
  db.insert(schema.sessions)
    .values({
      id,
      title: id,
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

test("A. empty sessions is valid empty coverage", () => {
  const audit = buildDualPipelineProcessingCoverageAudit(emptyInput());
  assert.equal(audit.version, DUAL_PIPELINE_PROCESSING_COVERAGE_AUDIT_VERSION);
  assert.equal(audit.totalSessions, 0);
  assert.equal(audit.conceptCoveredUnion, 0);
  assert.equal(audit.reviewCount, 0);
  assert.equal(audit.reviewUnknownSessions, 0);
  assert.equal(audit.productionAutomation.classification, NATURAL_ACCUMULATION_CLASSIFICATION);
});

test("B. Initial Concept coverage is counted", () => {
  const audit = buildDualPipelineProcessingCoverageAudit({
    ...emptyInput(),
    sessions: [
      { sessionId: "s-a", occurredAt: "2026-08-01" },
      { sessionId: "s-b", occurredAt: "2026-08-02" },
    ],
    initialConceptCoveredSessionIds: ["s-a"],
  });
  assert.equal(audit.initialConceptCoveredSessions, 1);
  assert.equal(audit.conceptCoveredUnion, 1);
  assert.equal(audit.conceptUncovered, 1);
  assert.deepEqual(audit.conceptUncoveredSessionIds, ["s-b"]);
});

test("C. Incremental checkpoint coverage is counted", () => {
  const audit = buildDualPipelineProcessingCoverageAudit({
    ...emptyInput(),
    sessions: [
      { sessionId: "s-a", occurredAt: "2026-08-01" },
      { sessionId: "s-b", occurredAt: "2026-08-02" },
    ],
    incrementalCheckpointSessionIds: ["s-b"],
  });
  assert.equal(audit.incrementalCheckpointCoveredSessions, 1);
  assert.equal(audit.conceptCoveredUnion, 1);
});

test("D. Initial + Incremental overlap is a union, not a double count", () => {
  const audit = buildDualPipelineProcessingCoverageAudit({
    ...emptyInput(),
    sessions: [
      { sessionId: "s-a", occurredAt: "2026-08-01" },
      { sessionId: "s-b", occurredAt: "2026-08-02" },
    ],
    initialConceptCoveredSessionIds: ["s-a", "s-b"],
    incrementalCheckpointSessionIds: ["s-b"],
  });
  assert.equal(audit.initialConceptCoveredSessions, 2);
  assert.equal(audit.incrementalCheckpointCoveredSessions, 1);
  assert.equal(audit.conceptCoveredUnion, 2);
  assert.equal(audit.conceptUncovered, 0);
});

test("E. ConceptOccurrence alone is not Concept coverage", () => {
  const audit = buildDualPipelineProcessingCoverageAudit({
    ...emptyInput(),
    sessions: [{ sessionId: "s-a", occurredAt: "2026-08-01" }],
    conceptOccurrenceSessionIds: ["s-a"],
  });
  assert.equal(audit.conceptCoveredUnion, 0);
  assert.equal(audit.conceptOccurrenceSessions, 1);
  assert.equal(audit.conceptUncovered, 1);
  assert.equal(audit.notes.conceptOccurrenceIsNotConceptCoverage, true);
});

test("F. explicit Review input scope is covered", () => {
  const audit = buildDualPipelineProcessingCoverageAudit({
    ...emptyInput(),
    sessions: [
      { sessionId: "s-a", occurredAt: "2026-08-01" },
      { sessionId: "s-b", occurredAt: "2026-08-02" },
    ],
    reviews: [{ reviewId: "r-1" }],
    reviewInputSessionIds: ["s-a", "s-b"],
  });
  assert.equal(audit.reviewCoverageSemantics, "explicit_durable");
  assert.equal(audit.explicitReviewCoveredSessions, 2);
  assert.equal(audit.reviewUncoveredSessions, 0);
  assert.equal(audit.reviewUnknownSessions, 0);
});

test("G. Evidence-only provenance does not become processing coverage", () => {
  const audit = buildDualPipelineProcessingCoverageAudit({
    ...emptyInput(),
    sessions: [{ sessionId: "s-a", occurredAt: "2026-08-01" }],
    reviews: [{ reviewId: "r-1" }],
    evidenceSessionIds: ["s-a"],
  });
  assert.equal(audit.explicitReviewCoveredSessions, 0);
  assert.equal(audit.evidenceLinkedSessions, 1);
  assert.equal(audit.reviewUncoveredSessions, 1);
  assert.equal(audit.notes.evidenceLinkedIsNotReviewProcessed, true);
});

test("H. ObservationSession link alone is not Review coverage", () => {
  const audit = buildDualPipelineProcessingCoverageAudit({
    ...emptyInput(),
    sessions: [{ sessionId: "s-a", occurredAt: "2026-08-01" }],
    observationSessionLinks: [{ observationId: "o-1", sessionId: "s-a" }],
    observations: [{ observationId: "o-1", completeExactEvidenceAnchorCount: 0 }],
  });
  assert.equal(audit.explicitReviewCoveredSessions, 0);
  assert.equal(audit.observationLinkedSessions, 1);
  assert.equal(audit.notes.observationLinkedIsNotReviewProcessed, true);
});

test("I. zero-Observation Review can still cover input Sessions", () => {
  const audit = buildDualPipelineProcessingCoverageAudit({
    ...emptyInput(),
    sessions: [
      { sessionId: "s-a", occurredAt: "2026-08-01" },
      { sessionId: "s-b", occurredAt: "2026-08-02" },
    ],
    reviews: [{ reviewId: "r-empty" }],
    reviewInputSessionIds: ["s-a", "s-b"],
    observations: [],
  });
  assert.equal(audit.observationCount, 0);
  assert.equal(audit.explicitReviewCoveredSessions, 2);
  assert.equal(audit.notes.zeroObservationReviewCanBeValid, true);
});

test("J. review unknown is not coerced to false; uncovered stays uncovered", () => {
  const audit = buildDualPipelineProcessingCoverageAudit({
    ...emptyInput(),
    sessions: [{ sessionId: "s-a", occurredAt: "2026-08-01" }],
    reviews: [{ reviewId: "r-orphan" }],
    reviewsWithoutExplicitSessionScope: 1,
  });
  assert.equal(audit.reviewUnknownSessions, 0);
  assert.equal(audit.reviewUncoveredSessions, 1);
  assert.equal(audit.reviewsWithoutExplicitSessionScope, 1);
  assert.equal(audit.explicitReviewCoveredSessions, 0);
});

test("K. complete Evidence identity is counted", () => {
  const audit = buildDualPipelineProcessingCoverageAudit({
    ...emptyInput(),
    sessions: [{ sessionId: "s-a", occurredAt: "2026-08-01" }],
    observations: [
      { observationId: "o-1", completeExactEvidenceAnchorCount: 2 },
    ],
  });
  assert.equal(audit.observationsWithCompleteExactEvidenceAnchor, 1);
  assert.equal(audit.completeEvidenceAnchorCount, 2);
  assert.equal(audit.explicitReviewCoveredSessions, 0);
});

test("L. legacy Observation without complete anchor is incomplete", () => {
  const audit = buildDualPipelineProcessingCoverageAudit({
    ...emptyInput(),
    sessions: [{ sessionId: "s-a", occurredAt: "2026-08-01" }],
    observations: [
      { observationId: "o-legacy", completeExactEvidenceAnchorCount: 0 },
    ],
  });
  assert.equal(audit.observationsWithoutCompleteExactEvidenceAnchor, 1);
  assert.equal(audit.observationsWithCompleteExactEvidenceAnchor, 0);
});

test("M. support rows are counted and never become coverage", () => {
  const audit = buildDualPipelineProcessingCoverageAudit({
    ...emptyInput(),
    sessions: [
      { sessionId: "s-a", occurredAt: "2026-08-01" },
      { sessionId: "s-b", occurredAt: "2026-08-02" },
    ],
    supportRows: [
      { observationId: "o-1", conceptId: "c-1" },
      { observationId: "o-1", conceptId: "c-1" },
      { observationId: "o-1", conceptId: "c-2" },
    ],
  });
  assert.equal(audit.supportRowCount, 3);
  assert.equal(audit.uniqueExactRelationCount, 2);
  assert.equal(audit.conceptCoveredUnion, 0);
  assert.equal(audit.explicitReviewCoveredSessions, 0);
  assert.equal(audit.provableDualCovered, 0);
});

test("N. serialized audit has no USER text", () => {
  const audit = buildDualPipelineProcessingCoverageAudit({
    ...emptyInput(),
    sessions: [{ sessionId: "s-a", occurredAt: "2026-08-01" }],
    initialConceptCoveredSessionIds: ["s-a"],
  });
  const serialized = JSON.stringify(audit);
  const formatted = formatDualPipelineProcessingCoverageAudit(audit);
  assert.doesNotMatch(serialized, new RegExp(USER_QUOTE));
  assert.doesNotMatch(formatted, new RegExp(USER_QUOTE));
  assert.doesNotMatch(serialized, /"quote"/);
  assert.doesNotMatch(serialized, /rawContent/);
});

test("O. LLM = 0 in audit modules", () => {
  for (const file of [
    "lib/processing-coverage/types.ts",
    "lib/processing-coverage/audit.ts",
    "lib/processing-coverage/load.ts",
  ]) {
    const source = readFileSync(resolve(process.cwd(), file), "utf8");
    assert.doesNotMatch(source, /from "openai"/);
    assert.doesNotMatch(source, /generateText|generateObject|streamText/);
    assert.doesNotMatch(source, /embedding/i);
  }
});

test("P. loader is read-only and Session import does not start pipelines", () => {
  const loadSource = readFileSync(
    resolve(process.cwd(), "lib/processing-coverage/load.ts"),
    "utf8",
  );
  const importSource = readFileSync(
    resolve(process.cwd(), "lib/db/import-chatgpt.ts"),
    "utf8",
  );
  const querySource = readFileSync(
    resolve(process.cwd(), "lib/db/queries.ts"),
    "utf8",
  );
  const sessionActionSource = readFileSync(
    resolve(process.cwd(), "app/(app)/sessions/actions.ts"),
    "utf8",
  );
  const importRouteSource = readFileSync(
    resolve(process.cwd(), "app/api/imports/chatgpt/route.ts"),
    "utf8",
  );
  assert.doesNotMatch(loadSource, /insert\(/);
  assert.doesNotMatch(loadSource, /reconcileObservationConceptEvidenceSupports/);
  assert.doesNotMatch(importSource, /createIntegratedReview|runIntegratedReview/);
  assert.doesNotMatch(importSource, /evaluateIncrementalSessionEligibility/);
  assert.doesNotMatch(querySource, /createIntegratedReview/);
  assert.doesNotMatch(sessionActionSource, /createIntegratedReview/);
  assert.doesNotMatch(importRouteSource, /createIntegratedReview/);
  assert.equal(DUAL_PIPELINE_PRODUCTION_AUTOMATION.sessionImportTriggersConcept, false);
  assert.equal(DUAL_PIPELINE_PRODUCTION_AUTOMATION.sessionImportTriggersReview, false);
  assert.equal(DUAL_PIPELINE_PRODUCTION_AUTOMATION.incrementalNewDedicatedCli, false);
});

test("Q. deterministic ordering ignores input order", () => {
  const forward = buildDualPipelineProcessingCoverageAudit({
    ...emptyInput(),
    sessions: [
      { sessionId: "s-b", occurredAt: "2026-08-02" },
      { sessionId: "s-a", occurredAt: "2026-08-01" },
    ],
    initialConceptCoveredSessionIds: ["s-b", "s-a"],
  });
  const reverse = buildDualPipelineProcessingCoverageAudit({
    ...emptyInput(),
    sessions: [
      { sessionId: "s-a", occurredAt: "2026-08-01" },
      { sessionId: "s-b", occurredAt: "2026-08-02" },
    ],
    initialConceptCoveredSessionIds: ["s-a", "s-b"],
  });
  assert.deepEqual(forward, reverse);
  assert.equal(forward.latestSessionOccurredAt, "2026-08-02");
  assert.equal(forward.latestConceptCoveredOccurredAt, "2026-08-02");
});

test("dual covered / concept-only / review-only / neither", () => {
  const audit = buildDualPipelineProcessingCoverageAudit({
    ...emptyInput(),
    sessions: [
      { sessionId: "s-dual", occurredAt: "2026-08-04" },
      { sessionId: "s-concept", occurredAt: "2026-08-03" },
      { sessionId: "s-review", occurredAt: "2026-08-02" },
      { sessionId: "s-none", occurredAt: "2026-08-01" },
    ],
    initialConceptCoveredSessionIds: ["s-dual", "s-concept"],
    reviews: [{ reviewId: "r-1" }],
    reviewInputSessionIds: ["s-dual", "s-review"],
  });
  assert.equal(audit.provableDualCovered, 1);
  assert.equal(audit.conceptOnly, 1);
  assert.equal(audit.reviewOnly, 1);
  assert.equal(audit.neither, 1);
});

test("temp SQLite: occurrence and observation links do not become coverage", () => {
  const db = openMemoryDb();
  seedSession(db, "s-initial", "2026-07-01");
  seedSession(db, "s-checkpoint", "2026-08-01");
  seedSession(db, "s-occurrence-only", "2026-08-10");
  seedSession(db, "s-review", "2026-08-12");
  seedSession(db, "s-none", "2026-08-20");
  seedMessage(db, { id: "m-1", sessionId: "s-review" });
  seedMessage(db, { id: "m-occ", sessionId: "s-occurrence-only" });
  seedReview(db, "r-1");
  db.insert(schema.reviewSessions)
    .values({ reviewId: "r-1", sessionId: "s-review" })
    .run();
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
  const concept = insertConcept(
    {
      id: "c-1",
      canonicalLabel: "ThemeA",
      createdAt: "2026-07-01T00:00:00.000Z",
    },
    db,
  );
  assert.equal(concept.status, "inserted");
  const occ = insertConceptOccurrence(
    {
      id: "occ-1",
      conceptId: "c-1",
      sessionId: "s-occurrence-only",
      messageId: "m-occ",
      evidenceRef: "M001:E01",
      occurredAt: "2026-08-10T00:00:00.000Z",
      sourceRole: "user",
      sourceType: "evidence_unit",
      extractionVersion: CONCEPT_EXTRACTION_VERSION,
    },
    db,
  );
  assert.equal(occ.status, "inserted", JSON.stringify(occ));
  db.insert(schema.observations)
    .values({
      id: "o-legacy",
      kind: "connection",
      projectionVersion: REVIEW_OBSERVATION_VERSION,
      sourceReviewId: "r-1",
      sourceRef: "o-legacy",
      title: "saved title",
      body: "saved body",
      supportType: null,
      payload: JSON.stringify({
        text: USER_QUOTE,
        evidence: [
          {
            messageRef: "M001",
            quote: USER_QUOTE,
            validated: true,
            messageId: "m-1",
            sessionId: "s-review",
          },
        ],
        semanticValid: true,
        relationType: "complement",
      }),
      firstSeenAt: "2026-08-12",
      lastSeenAt: "2026-08-12",
      detectedAt: "2026-08-18T00:00:00.000Z",
      distinctSessionCount: 1,
      createdAt: "2026-08-18T00:00:00.000Z",
    })
    .run();
  db.insert(schema.observationSessions)
    .values({ observationId: "o-legacy", sessionId: "s-review" })
    .run();

  const report = candidateReport(["s-initial"]);
  const text = JSON.stringify(report);
  const coverage = loadInitialConceptProcessingCoverage({
    candidateReportText: text,
    expectedSourceHash: hashSourceArtifactText(text),
  });
  assert.equal(coverage.ok, true);

  const before = {
    occurrences: countConceptOccurrences(db),
    observations: countObservations(db),
    sessions: db.select().from(schema.sessions).all().length,
  };
  const audit = loadDualPipelineProcessingCoverageAudit({
    db,
    initialCoverage: coverage,
  });
  assert.deepEqual(
    {
      occurrences: countConceptOccurrences(db),
      observations: countObservations(db),
      sessions: db.select().from(schema.sessions).all().length,
    },
    before,
  );

  assert.equal(audit.totalSessions, 5);
  assert.equal(audit.initialConceptCoveredSessions, 1);
  assert.equal(audit.incrementalCheckpointCoveredSessions, 1);
  assert.equal(audit.conceptCoveredUnion, 2);
  assert.equal(audit.conceptOccurrenceSessions, 1);
  assert.equal(audit.explicitReviewCoveredSessions, 1);
  assert.equal(audit.observationLinkedSessions, 1);
  assert.equal(audit.observationsWithoutCompleteExactEvidenceAnchor, 1);
  assert.equal(audit.provableDualCovered, 0);
  assert.equal(audit.conceptOnly, 2);
  assert.equal(audit.reviewOnly, 1);
  assert.equal(audit.neither, 2);
  assert.doesNotMatch(JSON.stringify(audit), new RegExp(USER_QUOTE));
  assert.equal(
    loadInitialConceptCoverageFromCandidateText(text).ok,
    true,
  );
});
