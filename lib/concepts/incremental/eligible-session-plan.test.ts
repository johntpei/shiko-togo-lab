import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { CONCEPT_EXTRACT_PROMPT_VERSION } from "@/lib/ai/prompts/concept-extract";
import type { ConceptExtractOutput } from "@/lib/ai/concept-extract-schema";
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
import { planEligibleIncrementalSession } from "./eligible-session-plan";
import {
  CONCEPT_INCREMENTAL_PROCESSING_VERSION,
  markIncrementalConceptSessionCompleted,
} from "./checkpoint";
import {
  loadInitialConceptProcessingCoverage,
  type InitialConceptProcessingCoverageLoad,
} from "./eligibility";
import { createProductionIncrementalCandidateExtractor } from "./extract";
import {
  ALL_ACTIONS_GROUNDING_REJECTED,
  type IncrementalCandidateExtractor,
} from "./session-plan";

const COVERED_WITH_OCC = "session-covered-occ";
const COVERED_ZERO_OCC = "session-covered-zero";
const ELIGIBLE = "session-eligible";
const HUMAN_ID = "concept-human-relations";
const USER_A =
  "これまでの人間関係でなぜ上手くいかないのか理解できないと思った。";
const USER_MIXED =
  "人間関係と寂しさと統合支援ツールについて同じ文で考えています。";

function restore(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

async function withExtractEnv(run: () => Promise<void>) {
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

function counts(db: ReturnType<typeof openMemoryDb>) {
  return {
    concepts: countConcepts(db),
    aliases: countConceptAliases(db),
    occurrences: countConceptOccurrences(db),
    sessions: db.select().from(schema.sessions).all().length,
    messages: db.select().from(schema.messages).all().length,
  };
}

function candidateReport(input: {
  selectedSessionIds: string[];
  actions?: Array<{ sessionId: string; originalAction?: string }>;
}) {
  return {
    metadata: {
      promptVersion: CONCEPT_EXTRACT_PROMPT_VERSION,
      extractionVersion: CONCEPT_EXTRACTION_VERSION,
      selectedSessionIds: input.selectedSessionIds,
    },
    concepts: [],
    actions:
      input.actions ??
      input.selectedSessionIds.map((sessionId) => ({
        sessionId,
        evidenceRef: "M001:E01",
        originalAction: "skip",
      })),
    failedSessions: [],
  };
}

function loadReport(
  report: unknown,
  expectedSourceHash?: string,
): InitialConceptProcessingCoverageLoad {
  const candidateReportText = JSON.stringify(report);
  return loadInitialConceptProcessingCoverage({
    candidateReportText,
    expectedSourceHash:
      expectedSourceHash ?? hashSourceArtifactText(candidateReportText),
  });
}

function coverageFor(selectedSessionIds: string[], actions?: Array<{ sessionId: string; originalAction?: string }>) {
  return loadReport(candidateReport({ selectedSessionIds, actions }));
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

function defaultCoverage() {
  return coverageFor([COVERED_WITH_OCC, COVERED_ZERO_OCC], [
    { sessionId: COVERED_WITH_OCC, originalAction: "new" },
  ]);
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
  return {
    extractCandidates,
    calls: () => calls,
  };
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

test("A. already covered + admitted occurrence → extractor call = 0", async () => {
  const db = openMemoryDb();
  seedCoveredAndEligible(db);
  const extractor = countingExtractor();
  const result = await planEligibleIncrementalSession({
    sessionId: COVERED_WITH_OCC,
    db,
    coverage: defaultCoverage(),
    extractCandidates: extractor.extractCandidates,
  });
  assert.equal(result.status, "already_covered");
  if (result.status === "already_covered") {
    assert.equal(result.reason, "initial_processing_coverage");
  }
  assert.equal(extractor.calls(), 0);
});

test("B. already covered + zero occurrence → extractor call = 0", async () => {
  const db = openMemoryDb();
  seedCoveredAndEligible(db);
  const extractor = countingExtractor();
  const result = await planEligibleIncrementalSession({
    sessionId: COVERED_ZERO_OCC,
    db,
    coverage: defaultCoverage(),
    extractCandidates: extractor.extractCandidates,
  });
  assert.equal(result.status, "already_covered");
  assert.equal(extractor.calls(), 0);
  assert.equal(
    db
      .select()
      .from(schema.conceptOccurrences)
      .all()
      .some((row) => row.sessionId === COVERED_ZERO_OCC),
    false,
  );
});

test("C. eligible → extractor call = 1 で Planning へ進む", async () => {
  const db = openMemoryDb();
  seedCoveredAndEligible(db);
  const extractor = countingExtractor(async () => []);
  const result = await planEligibleIncrementalSession({
    sessionId: ELIGIBLE,
    db,
    coverage: defaultCoverage(),
    extractCandidates: extractor.extractCandidates,
  });
  assert.equal(extractor.calls(), 1);
  assert.equal(result.status, "no_op");
  if (result.status === "no_op") {
    assert.equal(result.planResult.status, "no_op");
  }
});

test("D. missing Session → eligibility blocked, extractor call = 0", async () => {
  const db = openMemoryDb();
  seedCoveredAndEligible(db);
  const extractor = countingExtractor();
  const result = await planEligibleIncrementalSession({
    sessionId: "missing-session",
    db,
    coverage: defaultCoverage(),
    extractCandidates: extractor.extractCandidates,
  });
  assert.equal(result.status, "blocked");
  if (result.status === "blocked") {
    assert.equal(result.stage, "eligibility");
    assert.equal(result.reason, "missing_session");
  }
  assert.equal(extractor.calls(), 0);
});

test("E. malformed / unresolved coverage → eligibility blocked, extractor call = 0", async () => {
  const db = openMemoryDb();
  seedCoveredAndEligible(db);
  const extractor = countingExtractor();
  const malformed = loadReport({
    metadata: {
      promptVersion: CONCEPT_EXTRACT_PROMPT_VERSION,
      extractionVersion: CONCEPT_EXTRACTION_VERSION,
    },
    concepts: [],
    actions: [],
  });
  const result = await planEligibleIncrementalSession({
    sessionId: ELIGIBLE,
    db,
    coverage: malformed,
    extractCandidates: extractor.extractCandidates,
  });
  assert.equal(malformed.ok, false);
  assert.equal(result.status, "blocked");
  if (result.status === "blocked") {
    assert.equal(result.stage, "eligibility");
    assert.equal(result.reason, "malformed_coverage");
  }
  assert.equal(extractor.calls(), 0);
});

test("F. eligible → existing_match, write 0", async () => {
  const db = openMemoryDb();
  seedCoveredAndEligible(db);
  const before = counts(db);
  const extractor = countingExtractor(newFromUnits("人間関係"));
  const result = await planEligibleIncrementalSession({
    sessionId: ELIGIBLE,
    db,
    coverage: defaultCoverage(),
    extractCandidates: extractor.extractCandidates,
  });
  assert.equal(extractor.calls(), 1);
  assert.equal(result.status, "planned");
  if (result.status === "planned") {
    assert.equal(result.planResult.status, "planned");
    assert.equal(result.planResult.existingMatches, 1);
    assert.equal(result.planResult.plans[0]?.kind, "existing_match");
  }
  assert.deepEqual(counts(db), before);
});

test("G. eligible → new は blocked にしない", async () => {
  const db = openMemoryDb();
  seedCoveredAndEligible(db);
  const extractor = countingExtractor(newFromUnits("理解できない"));
  const result = await planEligibleIncrementalSession({
    sessionId: ELIGIBLE,
    db,
    coverage: defaultCoverage(),
    extractCandidates: extractor.extractCandidates,
  });
  assert.equal(result.status, "planned");
  if (result.status === "planned") {
    assert.equal(result.planResult.newCandidates, 1);
    assert.equal(result.planResult.plans[0]?.kind, "new");
  }
});

test("H. eligible → provisional_new は existing_match へ昇格しない", async () => {
  const db = openMemoryDb();
  seedCoveredAndEligible(db, USER_MIXED);
  const extractor = countingExtractor(async (units) => [
    {
      action: "match",
      evidenceRef: units[0]!.evidenceRef,
      surfaceForm: "寂しさ",
      existingConceptRef: HUMAN_ID,
    },
  ]);
  const result = await planEligibleIncrementalSession({
    sessionId: ELIGIBLE,
    db,
    coverage: defaultCoverage(),
    extractCandidates: extractor.extractCandidates,
  });
  assert.equal(result.status, "planned");
  if (result.status === "planned") {
    assert.equal(result.planResult.provisionalNewCandidates, 1);
    assert.equal(result.planResult.existingMatches, 0);
    assert.equal(result.planResult.plans[0]?.kind, "provisional_new");
  }
});

test("I. eligible → zero Candidates は no_op", async () => {
  const db = openMemoryDb();
  seedCoveredAndEligible(db);
  const extractor = countingExtractor(async () => []);
  const result = await planEligibleIncrementalSession({
    sessionId: ELIGIBLE,
    db,
    coverage: defaultCoverage(),
    extractCandidates: extractor.extractCandidates,
  });
  assert.equal(result.status, "no_op");
  assert.equal(extractor.calls(), 1);
});

test("J. eligible → invalid grounding は planning blocked", async () => {
  const db = openMemoryDb();
  seedCoveredAndEligible(db);
  const extractor = countingExtractor(newFromUnits("存在しない表層"));
  const result = await planEligibleIncrementalSession({
    sessionId: ELIGIBLE,
    db,
    coverage: defaultCoverage(),
    extractCandidates: extractor.extractCandidates,
  });
  assert.equal(result.status, "blocked");
  if (result.status === "blocked") {
    assert.equal(result.stage, "planning");
    assert.equal(result.reason, ALL_ACTIONS_GROUNDING_REJECTED);
    assert.equal(result.groundingFailure?.code, "surface_not_in_unit");
    assert.equal(result.adapterActions, 1);
  }
  assert.equal(extractor.calls(), 1);
});

test("K. eligible → extractor failure は planning blocked / extractor_failed", async () => {
  const db = openMemoryDb();
  seedCoveredAndEligible(db);
  const extractor = countingExtractor(async () => {
    throw new Error("boom");
  });
  const result = await planEligibleIncrementalSession({
    sessionId: ELIGIBLE,
    db,
    coverage: defaultCoverage(),
    extractCandidates: extractor.extractCandidates,
  });
  assert.equal(result.status, "blocked");
  if (result.status === "blocked") {
    assert.equal(result.stage, "planning");
    assert.equal(result.reason, "extractor_failed");
  }
  assert.equal(extractor.calls(), 1);
});

test("L. repeated call は同じ eligibility result", async () => {
  const db = openMemoryDb();
  seedCoveredAndEligible(db);
  const coverage = defaultCoverage();
  const first = await planEligibleIncrementalSession({
    sessionId: COVERED_ZERO_OCC,
    db,
    coverage,
    extractCandidates: countingExtractor().extractCandidates,
  });
  const second = await planEligibleIncrementalSession({
    sessionId: COVERED_ZERO_OCC,
    db,
    coverage,
    extractCandidates: countingExtractor().extractCandidates,
  });
  assert.deepEqual(first, second);
  assert.equal(first.status, "already_covered");
});

test("M. zero write", async () => {
  const db = openMemoryDb();
  seedCoveredAndEligible(db, USER_MIXED);
  const before = counts(db);
  const coverage = defaultCoverage();
  await planEligibleIncrementalSession({
    sessionId: COVERED_ZERO_OCC,
    db,
    coverage,
    extractCandidates: countingExtractor().extractCandidates,
  });
  await planEligibleIncrementalSession({
    sessionId: ELIGIBLE,
    db,
    coverage,
    extractCandidates: countingExtractor(newFromUnits("人間関係")).extractCandidates,
  });
  assert.deepEqual(counts(db), before);
});

test("N. Production adapter integration は Eligibility 通過後に Planner まで到達する", async () => {
  await withExtractEnv(async () => {
    const db = openMemoryDb();
    seedCoveredAndEligible(db);
    const parsed: ConceptExtractOutput = {
      units: [
        {
          evidenceRef: "M001:E01",
          disposition: "extracted",
          concepts: [{ action: "new", surfaceForm: "人間関係" }],
        },
      ],
    };
    let extractorCalls = 0;
    const production = createProductionIncrementalCandidateExtractor({
      generateStructured: async (request) => ({
        parsed,
        model: request.model,
      }),
    });
    const extractCandidates: IncrementalCandidateExtractor = async (
      units,
      context,
    ) => {
      extractorCalls += 1;
      return production(units, context);
    };
    const result = await planEligibleIncrementalSession({
      sessionId: ELIGIBLE,
      db,
      coverage: defaultCoverage(),
      extractCandidates,
    });
    assert.equal(extractorCalls, 1);
    assert.equal(result.status, "planned");
    if (result.status === "planned") {
      assert.equal(result.planResult.existingMatches, 1);
      assert.equal(result.planResult.plans[0]?.kind, "existing_match");
    }
  });
});

test("O. Coverage 判定は ConceptOccurrence 追加・削除で変わらない", async () => {
  const db = openMemoryDb();
  seedCoveredAndEligible(db);
  const coverage = defaultCoverage();
  const before = await planEligibleIncrementalSession({
    sessionId: COVERED_ZERO_OCC,
    db,
    coverage,
    extractCandidates: countingExtractor().extractCandidates,
  });
  insertConceptOccurrence(
    {
      id: "occ-later",
      conceptId: HUMAN_ID,
      sessionId: COVERED_ZERO_OCC,
      messageId: `${COVERED_ZERO_OCC}-u`,
      evidenceRef: "M001:E01",
      occurredAt: "2026-07-15T12:00:00.000Z",
      sourceRole: "user",
      sourceType: "evidence_unit",
      extractionVersion: CONCEPT_EXTRACTION_VERSION,
    },
    db,
  );
  const extractor = countingExtractor();
  const after = await planEligibleIncrementalSession({
    sessionId: COVERED_ZERO_OCC,
    db,
    coverage,
    extractCandidates: extractor.extractCandidates,
  });
  assert.equal(before.status, "already_covered");
  assert.equal(after.status, "already_covered");
  assert.equal(extractor.calls(), 0);
});

test("Initial selected + actions=[] でも already_covered", async () => {
  const db = openMemoryDb();
  seedCoveredAndEligible(db);
  const extractor = countingExtractor();
  const result = await planEligibleIncrementalSession({
    sessionId: COVERED_ZERO_OCC,
    db,
    coverage: coverageFor([COVERED_ZERO_OCC], []),
    extractCandidates: extractor.extractCandidates,
  });
  assert.equal(result.status, "already_covered");
  assert.equal(extractor.calls(), 0);
});

test("incremental checkpoint → already_covered / incremental_processing_checkpoint, extractor=0", async () => {
  const db = openMemoryDb();
  seedCoveredAndEligible(db);
  const written = markIncrementalConceptSessionCompleted(
    {
      sessionId: ELIGIBLE,
      processingVersion: CONCEPT_INCREMENTAL_PROCESSING_VERSION,
      planning: {
        status: "no_actions",
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
  assert.equal(written.ok, true);
  const extractor = countingExtractor();
  const result = await planEligibleIncrementalSession({
    sessionId: ELIGIBLE,
    db,
    coverage: defaultCoverage(),
    extractCandidates: extractor.extractCandidates,
  });
  assert.equal(result.status, "already_covered");
  if (result.status === "already_covered") {
    assert.equal(result.reason, "incremental_processing_checkpoint");
  }
  assert.equal(extractor.calls(), 0);
});

test("boundary は Eligibility を先に通し Safety Engine をコピーしない", () => {
  const source = readFileSync(
    resolve(process.cwd(), "lib/concepts/incremental/eligible-session-plan.ts"),
    "utf8",
  );
  assert.match(source, /evaluateIncrementalSessionEligibility/);
  assert.match(source, /planIncrementalSession/);
  assert.match(source, /incremental_processing_checkpoint/);
  assert.doesNotMatch(source, /applyExistingMatchOccurrences/);
  assert.doesNotMatch(source, /runExistingMatchOccurrenceAppend/);
  assert.doesNotMatch(source, /getDb\(/);
  assert.doesNotMatch(source, /getAiProvider/);
  assert.doesNotMatch(source, /openai/);
  assert.doesNotMatch(source, /app\.db/);
  assert.doesNotMatch(source, /evaluatePolicyCalibration/);
  assert.doesNotMatch(source, /負の連鎖/);
});
