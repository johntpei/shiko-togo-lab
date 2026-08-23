import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { CONCEPT_EXTRACT_PROMPT_VERSION } from "@/lib/ai/prompts/concept-extract";
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
import {
  CONCEPT_INCREMENTAL_PROCESSING_VERSION,
  hasIncrementalConceptProcessingCheckpoint,
  markIncrementalConceptSessionCompleted,
  validateIncrementalConceptCompletionProof,
  type IncrementalConceptCompletionProof,
} from "./checkpoint";
import {
  evaluateIncrementalSessionEligibility,
  loadInitialConceptProcessingCoverage,
} from "./eligibility";

const INITIAL_A = "session-initial-a";
const INITIAL_B = "session-initial-b";
const ELIGIBLE = "session-eligible";
const CHECKPOINTED = "session-checkpointed";
const OTHER_VERSION = "session-other-version";
const OCCURRENCE_ONLY = "session-occurrence-only";
const CANDIDATE_ZERO = "session-candidate-zero";
const HUMAN_ID = "concept-human-relations";
const USER =
  "これまでの人間関係でなぜ上手くいかないのか理解できないと思った。";
const OTHER_PROCESSING_VERSION = "concept-incremental-processing-v0";

function openMemoryDb() {
  const sqlite = new Database(":memory:");
  applySqlMigrations(sqlite);
  sqlite.pragma("foreign_keys = ON");
  return drizzle(sqlite, { schema });
}

function seedSession(db: ReturnType<typeof openMemoryDb>, id: string) {
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
      content: USER,
      charStart: 0,
      charEnd: USER.length,
      sourceMessageId: null,
      sourceCreatedAt: "2026-07-15T12:00:00.000Z",
      contentType: "text",
      attachmentsJson: null,
    })
    .run();
}

function counts(db: ReturnType<typeof openMemoryDb>) {
  return {
    concepts: countConcepts(db),
    aliases: countConceptAliases(db),
    occurrences: countConceptOccurrences(db),
    sessions: db.select().from(schema.sessions).all().length,
    messages: db.select().from(schema.messages).all().length,
    checkpoints: db.select().from(schema.conceptProcessingCheckpoints).all()
      .length,
  };
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

function loadCoverage(selectedSessionIds: string[]) {
  const candidateReportText = JSON.stringify(candidateReport(selectedSessionIds));
  return loadInitialConceptProcessingCoverage({
    candidateReportText,
    expectedSourceHash: hashSourceArtifactText(candidateReportText),
  });
}

function proof(
  sessionId: string,
  planning: IncrementalConceptCompletionProof["planning"],
  completed?: { existing?: number; newCandidates?: number },
): IncrementalConceptCompletionProof {
  return {
    sessionId,
    processingVersion: CONCEPT_INCREMENTAL_PROCESSING_VERSION,
    planning,
    existing: {
      completedCount: completed?.existing ?? planning.existingMatchCount,
    },
    newCandidates: {
      completedCount: completed?.newCandidates ?? planning.newCandidateCount,
    },
  };
}

function seedBase(db: ReturnType<typeof openMemoryDb>) {
  seedSession(db, INITIAL_A);
  seedSession(db, INITIAL_B);
  seedSession(db, ELIGIBLE);
  seedSession(db, CHECKPOINTED);
  seedSession(db, OTHER_VERSION);
  seedSession(db, OCCURRENCE_ONLY);
  seedSession(db, CANDIDATE_ZERO);
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
      id: "occ-occurrence-only",
      conceptId: HUMAN_ID,
      sessionId: OCCURRENCE_ONLY,
      messageId: `${OCCURRENCE_ONLY}-u`,
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

function defaultCoverage() {
  return loadCoverage([INITIAL_A, INITIAL_B]);
}

function eligibilityOf(
  db: ReturnType<typeof openMemoryDb>,
  sessionId: string,
) {
  return evaluateIncrementalSessionEligibility({
    sessionId,
    db,
    coverage: defaultCoverage(),
  });
}

test("A. eligible without checkpoint", () => {
  const db = openMemoryDb();
  seedBase(db);
  const result = eligibilityOf(db, ELIGIBLE);
  assert.equal(result.status, "eligible");
  assert.equal(
    hasIncrementalConceptProcessingCheckpoint({
      sessionId: ELIGIBLE,
      processingVersion: CONCEPT_INCREMENTAL_PROCESSING_VERSION,
      db,
    }),
    false,
  );
});

test("B. Initial covered → already_covered / initial_processing_coverage", () => {
  const db = openMemoryDb();
  seedBase(db);
  const result = eligibilityOf(db, INITIAL_A);
  assert.equal(result.status, "already_covered");
  if (result.status === "already_covered") {
    assert.equal(result.reason, "initial_processing_coverage");
  }
});

test("C. incremental checkpoint exists → already_covered / incremental_processing_checkpoint", () => {
  const db = openMemoryDb();
  seedBase(db);
  const written = markIncrementalConceptSessionCompleted(
    proof(CHECKPOINTED, {
      status: "planned",
      existingMatchCount: 1,
      newCandidateCount: 0,
      provisionalNewCount: 0,
      groundingRejectedCount: 0,
    }),
    { db },
  );
  assert.equal(written.ok, true);
  const result = eligibilityOf(db, CHECKPOINTED);
  assert.equal(result.status, "already_covered");
  if (result.status === "already_covered") {
    assert.equal(result.reason, "incremental_processing_checkpoint");
  }
});

test("D. different processingVersion checkpoint → current version remains eligible", () => {
  const db = openMemoryDb();
  seedBase(db);
  db.insert(schema.conceptProcessingCheckpoints)
    .values({
      sessionId: OTHER_VERSION,
      processingVersion: OTHER_PROCESSING_VERSION,
      completedAt: "2026-08-23T00:00:00.000Z",
      existingMatchCount: 0,
      newCandidateCount: 0,
      provisionalNewCount: 0,
      groundingRejectedCount: 0,
    })
    .run();
  assert.equal(
    hasIncrementalConceptProcessingCheckpoint({
      sessionId: OTHER_VERSION,
      processingVersion: OTHER_PROCESSING_VERSION,
      db,
    }),
    true,
  );
  assert.equal(
    hasIncrementalConceptProcessingCheckpoint({
      sessionId: OTHER_VERSION,
      processingVersion: CONCEPT_INCREMENTAL_PROCESSING_VERSION,
      db,
    }),
    false,
  );
  const result = eligibilityOf(db, OTHER_VERSION);
  assert.equal(result.status, "eligible");
});

test("E. missing Session → blocked", () => {
  const db = openMemoryDb();
  seedBase(db);
  const result = eligibilityOf(db, "missing-session");
  assert.equal(result.status, "blocked");
  if (result.status === "blocked") {
    assert.equal(result.reason, "missing_session");
  }
  const written = markIncrementalConceptSessionCompleted(
    proof("missing-session", {
      status: "no_actions",
      existingMatchCount: 0,
      newCandidateCount: 0,
      provisionalNewCount: 0,
      groundingRejectedCount: 0,
    }),
    { db },
  );
  assert.equal(written.ok, false);
  if (!written.ok) {
    assert.equal(written.code, "missing_session");
  }
});

test("F. true Candidate 0 completion → checkpoint可能", () => {
  const db = openMemoryDb();
  seedBase(db);
  const written = markIncrementalConceptSessionCompleted(
    proof(CANDIDATE_ZERO, {
      status: "no_actions",
      existingMatchCount: 0,
      newCandidateCount: 0,
      provisionalNewCount: 0,
      groundingRejectedCount: 0,
    }),
    { db },
  );
  assert.equal(written.ok, true);
  if (written.ok) {
    assert.equal(written.status, "completed");
  }
  assert.equal(eligibilityOf(db, CANDIDATE_ZERO).status, "already_covered");
});

test("G. existing fully completed (2/2) → checkpoint可能", () => {
  const db = openMemoryDb();
  seedBase(db);
  const written = markIncrementalConceptSessionCompleted(
    proof(ELIGIBLE, {
      status: "planned",
      existingMatchCount: 2,
      newCandidateCount: 0,
      provisionalNewCount: 0,
      groundingRejectedCount: 0,
    }),
    { db },
  );
  assert.equal(written.ok, true);
});

test("H. existing incomplete (2/1) → checkpoint reject", () => {
  const db = openMemoryDb();
  seedBase(db);
  const written = markIncrementalConceptSessionCompleted(
    proof(
      ELIGIBLE,
      {
        status: "planned",
        existingMatchCount: 2,
        newCandidateCount: 0,
        provisionalNewCount: 0,
        groundingRejectedCount: 0,
      },
      { existing: 1 },
    ),
    { db },
  );
  assert.equal(written.ok, false);
  if (!written.ok) {
    assert.equal(written.code, "existing_incomplete");
  }
  assert.equal(counts(db).checkpoints, 0);
});

test("I. NEW fully completed (2/2) → checkpoint可能", () => {
  const db = openMemoryDb();
  seedBase(db);
  const written = markIncrementalConceptSessionCompleted(
    proof(ELIGIBLE, {
      status: "planned",
      existingMatchCount: 0,
      newCandidateCount: 2,
      provisionalNewCount: 0,
      groundingRejectedCount: 0,
    }),
    { db },
  );
  assert.equal(written.ok, true);
});

test("J. NEW incomplete → reject", () => {
  const db = openMemoryDb();
  seedBase(db);
  const written = markIncrementalConceptSessionCompleted(
    proof(
      ELIGIBLE,
      {
        status: "planned",
        existingMatchCount: 0,
        newCandidateCount: 2,
        provisionalNewCount: 0,
        groundingRejectedCount: 0,
      },
      { newCandidates: 1 },
    ),
    { db },
  );
  assert.equal(written.ok, false);
  if (!written.ok) {
    assert.equal(written.code, "new_incomplete");
  }
  assert.equal(counts(db).checkpoints, 0);
});

test("K. provisional only → checkpoint可能 (deferred)", () => {
  const db = openMemoryDb();
  seedBase(db);
  const written = markIncrementalConceptSessionCompleted(
    proof(ELIGIBLE, {
      status: "planned",
      existingMatchCount: 0,
      newCandidateCount: 0,
      provisionalNewCount: 3,
      groundingRejectedCount: 0,
    }),
    { db },
  );
  assert.equal(written.ok, true);
  if (written.ok) {
    assert.equal(written.provisionalNewCount, 3);
  }
});

test("L. selective Grounding rejection → checkpoint可能", () => {
  const db = openMemoryDb();
  seedBase(db);
  const written = markIncrementalConceptSessionCompleted(
    proof(ELIGIBLE, {
      status: "planned",
      existingMatchCount: 1,
      newCandidateCount: 0,
      provisionalNewCount: 0,
      groundingRejectedCount: 2,
    }),
    { db },
  );
  assert.equal(written.ok, true);
  if (written.ok) {
    assert.equal(written.groundingRejectedCount, 2);
  }
});

test("M. Planning blocked → checkpoint不可", () => {
  const db = openMemoryDb();
  seedBase(db);
  const validated = validateIncrementalConceptCompletionProof({
    sessionId: ELIGIBLE,
    processingVersion: CONCEPT_INCREMENTAL_PROCESSING_VERSION,
    planning: {
      status: "blocked",
      existingMatchCount: 0,
      newCandidateCount: 0,
      provisionalNewCount: 0,
      groundingRejectedCount: 0,
    },
    existing: { completedCount: 0 },
    newCandidates: { completedCount: 0 },
  });
  assert.equal(validated.ok, false);
  if (!validated.ok) {
    assert.equal(validated.code, "blocked_planning");
  }
  const written = markIncrementalConceptSessionCompleted(
    {
      sessionId: ELIGIBLE,
      processingVersion: CONCEPT_INCREMENTAL_PROCESSING_VERSION,
      planning: {
        status: "extractor_failed",
        existingMatchCount: 0,
        newCandidateCount: 0,
        provisionalNewCount: 0,
        groundingRejectedCount: 0,
      },
      existing: { completedCount: 0 },
      newCandidates: { completedCount: 0 },
    },
    { db },
  );
  assert.equal(written.ok, false);
  if (!written.ok) {
    assert.equal(written.code, "blocked_planning");
  }
  assert.equal(counts(db).checkpoints, 0);
});

test("N. all_actions_grounding_rejected → checkpoint不可", () => {
  const db = openMemoryDb();
  seedBase(db);
  const written = markIncrementalConceptSessionCompleted(
    {
      sessionId: ELIGIBLE,
      processingVersion: CONCEPT_INCREMENTAL_PROCESSING_VERSION,
      planning: {
        status: "all_actions_grounding_rejected",
        existingMatchCount: 0,
        newCandidateCount: 0,
        provisionalNewCount: 0,
        groundingRejectedCount: 4,
      },
      existing: { completedCount: 0 },
      newCandidates: { completedCount: 0 },
    },
    { db },
  );
  assert.equal(written.ok, false);
  if (!written.ok) {
    assert.equal(written.code, "blocked_planning");
  }
  assert.equal(counts(db).checkpoints, 0);
});

test("O. duplicate completion → already_completed, row増えない", () => {
  const db = openMemoryDb();
  seedBase(db);
  const first = markIncrementalConceptSessionCompleted(
    proof(ELIGIBLE, {
      status: "planned",
      existingMatchCount: 1,
      newCandidateCount: 0,
      provisionalNewCount: 0,
      groundingRejectedCount: 0,
    }),
    { db, now: "2026-08-23T01:00:00.000Z" },
  );
  const second = markIncrementalConceptSessionCompleted(
    proof(ELIGIBLE, {
      status: "planned",
      existingMatchCount: 1,
      newCandidateCount: 0,
      provisionalNewCount: 0,
      groundingRejectedCount: 0,
    }),
    { db, now: "2026-08-23T02:00:00.000Z" },
  );
  assert.equal(first.ok, true);
  if (first.ok) {
    assert.equal(first.status, "completed");
  }
  assert.equal(second.ok, true);
  if (second.ok) {
    assert.equal(second.status, "already_completed");
    assert.equal(second.completedAt, "2026-08-23T01:00:00.000Z");
  }
  assert.equal(counts(db).checkpoints, 1);
});

test("P. no USER content in checkpoint row / result", () => {
  const db = openMemoryDb();
  seedBase(db);
  const written = markIncrementalConceptSessionCompleted(
    proof(ELIGIBLE, {
      status: "no_actions",
      existingMatchCount: 0,
      newCandidateCount: 0,
      provisionalNewCount: 0,
      groundingRejectedCount: 0,
    }),
    { db },
  );
  assert.equal(written.ok, true);
  const row = db.select().from(schema.conceptProcessingCheckpoints).all()[0];
  assert.ok(row);
  const serialized = `${JSON.stringify(written)}\n${JSON.stringify(row)}`;
  assert.equal(serialized.includes(USER), false);
  assert.equal(serialized.includes("人間関係"), false);
  assert.equal("surfaceForm" in (written as object), false);
  assert.equal("canonicalLabel" in (row as object), false);
  const leaked = validateIncrementalConceptCompletionProof({
    ...proof(ELIGIBLE, {
      status: "no_actions",
      existingMatchCount: 0,
      newCandidateCount: 0,
      provisionalNewCount: 0,
      groundingRejectedCount: 0,
    }),
    surfaceForm: "人間関係",
  });
  assert.equal(leaked.ok, false);
  if (!leaked.ok) {
    assert.equal(leaked.code, "user_content_forbidden");
  }
});

test("Q. occurrence 0 でも complete できる", () => {
  const db = openMemoryDb();
  seedBase(db);
  const before = countConceptOccurrences(db);
  const written = markIncrementalConceptSessionCompleted(
    proof(ELIGIBLE, {
      status: "planned",
      existingMatchCount: 0,
      newCandidateCount: 2,
      provisionalNewCount: 0,
      groundingRejectedCount: 0,
    }),
    { db },
  );
  assert.equal(written.ok, true);
  assert.equal(countConceptOccurrences(db), before);
  assert.equal(
    db
      .select()
      .from(schema.conceptOccurrences)
      .all()
      .some((row) => row.sessionId === ELIGIBLE),
    false,
  );
  assert.equal(eligibilityOf(db, ELIGIBLE).status, "already_covered");
});

test("R. occurrence 存在だけでは covered にならない", () => {
  const db = openMemoryDb();
  seedBase(db);
  assert.equal(
    db
      .select()
      .from(schema.conceptOccurrences)
      .all()
      .some((row) => row.sessionId === OCCURRENCE_ONLY),
    true,
  );
  const result = eligibilityOf(db, OCCURRENCE_ONLY);
  assert.equal(result.status, "eligible");
});

test("S. Initial Coverage regressionなし (count を hardcode しない)", () => {
  const db = openMemoryDb();
  seedBase(db);
  const selected = [INITIAL_A, INITIAL_B];
  const coverage = loadCoverage(selected);
  assert.equal(coverage.ok, true);
  if (!coverage.ok) {
    return;
  }
  for (const sessionId of coverage.coverage.sessionIds) {
    const result = evaluateIncrementalSessionEligibility({
      sessionId,
      db,
      coverage,
    });
    assert.equal(result.status, "already_covered");
    if (result.status === "already_covered") {
      assert.equal(result.reason, "initial_processing_coverage");
    }
  }
  const checkpointOnInitial = markIncrementalConceptSessionCompleted(
    proof(INITIAL_A, {
      status: "no_actions",
      existingMatchCount: 0,
      newCandidateCount: 0,
      provisionalNewCount: 0,
      groundingRejectedCount: 0,
    }),
    { db },
  );
  assert.equal(checkpointOnInitial.ok, true);
  const stillInitial = evaluateIncrementalSessionEligibility({
    sessionId: INITIAL_A,
    db,
    coverage,
  });
  assert.equal(stillInitial.status, "already_covered");
  if (stillInitial.status === "already_covered") {
    assert.equal(stillInitial.reason, "initial_processing_coverage");
  }
  const eligible = evaluateIncrementalSessionEligibility({
    sessionId: ELIGIBLE,
    db,
    coverage,
  });
  assert.equal(eligible.status, "eligible");
});

test("checkpoint write は Concept / Alias / Occurrence を変えない", () => {
  const db = openMemoryDb();
  seedBase(db);
  const before = counts(db);
  markIncrementalConceptSessionCompleted(
    proof(ELIGIBLE, {
      status: "planned",
      existingMatchCount: 1,
      newCandidateCount: 1,
      provisionalNewCount: 1,
      groundingRejectedCount: 1,
    }),
    { db },
  );
  const after = counts(db);
  assert.equal(after.concepts, before.concepts);
  assert.equal(after.aliases, before.aliases);
  assert.equal(after.occurrences, before.occurrences);
  assert.equal(after.checkpoints, before.checkpoints + 1);
});

test("no_actions で nonzero planning counts は reject", () => {
  const db = openMemoryDb();
  seedBase(db);
  const written = markIncrementalConceptSessionCompleted(
    proof(ELIGIBLE, {
      status: "no_actions",
      existingMatchCount: 1,
      newCandidateCount: 0,
      provisionalNewCount: 0,
      groundingRejectedCount: 0,
    }),
    { db },
  );
  assert.equal(written.ok, false);
  if (!written.ok) {
    assert.equal(written.code, "no_actions_mismatch");
  }
});

test("checkpoint / eligibility は Occurrence・LLM・getDb に依存しない", () => {
  const checkpointSource = readFileSync(
    resolve(process.cwd(), "lib/concepts/incremental/checkpoint.ts"),
    "utf8",
  );
  const eligibilitySource = readFileSync(
    resolve(process.cwd(), "lib/concepts/incremental/eligibility.ts"),
    "utf8",
  );
  assert.match(checkpointSource, /concept-incremental-processing-v1/);
  assert.doesNotMatch(checkpointSource, /getDb\(/);
  assert.doesNotMatch(checkpointSource, /openai/);
  assert.doesNotMatch(checkpointSource, /app\.db/);
  assert.doesNotMatch(checkpointSource, /evaluatePolicyCalibration/);
  assert.doesNotMatch(checkpointSource, /named_or_high/);
  assert.doesNotMatch(checkpointSource, /concept-extract-prompt-v5/);
  assert.doesNotMatch(
    checkpointSource,
    /102a1678-dbe6-47a3-a064-a8b898425b06/,
  );
  assert.doesNotMatch(
    checkpointSource,
    /f8e1629b-2726-4b19-8b89-ecd1176e2b43/,
  );
  assert.match(eligibilitySource, /hasIncrementalConceptProcessingCheckpoint/);
  assert.match(eligibilitySource, /incremental_processing_checkpoint/);
  assert.doesNotMatch(eligibilitySource, /conceptOccurrences/);
  assert.doesNotMatch(eligibilitySource, /countConceptOccurrences/);
  assert.doesNotMatch(eligibilitySource, /getDb\(/);
});
