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
  evaluateIncrementalSessionEligibility,
  loadInitialConceptProcessingCoverage,
} from "./eligibility";

const COVERED_WITH_OCC = "session-covered-occ";
const COVERED_ZERO_OCC = "session-covered-zero";
const ELIGIBLE_NEW = "session-eligible-new";
const HUMAN_ID = "concept-human-relations";
const USER =
  "これまでの人間関係でなぜ上手くいかないのか理解できないと思った。";

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
  };
}

function candidateReport(input: {
  selectedSessionIds: string[];
  actions?: Array<{ sessionId: string; originalAction?: string }>;
  failedSessions?: Array<{ sessionId: string }>;
  extraMetadata?: Record<string, unknown>;
  promptVersion?: string;
  extractionVersion?: string;
}) {
  return {
    metadata: {
      promptVersion: input.promptVersion ?? CONCEPT_EXTRACT_PROMPT_VERSION,
      extractionVersion: input.extractionVersion ?? CONCEPT_EXTRACTION_VERSION,
      selectedSessionIds: input.selectedSessionIds,
      ...(input.extraMetadata ?? {}),
    },
    concepts: [],
    actions: input.actions ??
      input.selectedSessionIds.map((sessionId) => ({
        sessionId,
        evidenceRef: "M001:E01",
        originalAction: "skip",
      })),
    failedSessions: input.failedSessions ?? [],
  };
}

function loadReport(report: unknown, expectedSourceHash?: string) {
  const candidateReportText = JSON.stringify(report);
  return loadInitialConceptProcessingCoverage({
    candidateReportText,
    expectedSourceHash:
      expectedSourceHash ?? hashSourceArtifactText(candidateReportText),
  });
}

function seedBase(db: ReturnType<typeof openMemoryDb>) {
  seedSession(db, COVERED_WITH_OCC);
  seedSession(db, COVERED_ZERO_OCC);
  seedSession(db, ELIGIBLE_NEW);
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
  return loadReport(
    candidateReport({
      selectedSessionIds: [COVERED_WITH_OCC, COVERED_ZERO_OCC],
      actions: [
        {
          sessionId: COVERED_WITH_OCC,
          originalAction: "new",
        },
        {
          sessionId: COVERED_ZERO_OCC,
          originalAction: "skip",
        },
      ],
    }),
  );
}

test("A. covered Session with admitted occurrence → already_covered", () => {
  const db = openMemoryDb();
  seedBase(db);
  const result = evaluateIncrementalSessionEligibility({
    sessionId: COVERED_WITH_OCC,
    db,
    coverage: defaultCoverage(),
  });
  assert.equal(result.status, "already_covered");
  if (result.status === "already_covered") {
    assert.equal(result.reason, "initial_processing_coverage");
  }
  assert.equal(countConceptOccurrences(db) > 0, true);
});

test("B. covered Session with zero ConceptOccurrence → already_covered", () => {
  const db = openMemoryDb();
  seedBase(db);
  assert.equal(
    db
      .select()
      .from(schema.conceptOccurrences)
      .all()
      .some((row) => row.sessionId === COVERED_ZERO_OCC),
    false,
  );
  const result = evaluateIncrementalSessionEligibility({
    sessionId: COVERED_ZERO_OCC,
    db,
    coverage: defaultCoverage(),
  });
  assert.equal(result.status, "already_covered");
});

test("C. genuinely new Session → eligible", () => {
  const db = openMemoryDb();
  seedBase(db);
  const result = evaluateIncrementalSessionEligibility({
    sessionId: ELIGIBLE_NEW,
    db,
    coverage: defaultCoverage(),
  });
  assert.equal(result.status, "eligible");
});

test("D. missing Session → blocked", () => {
  const db = openMemoryDb();
  seedBase(db);
  const result = evaluateIncrementalSessionEligibility({
    sessionId: "missing-session",
    db,
    coverage: defaultCoverage(),
  });
  assert.equal(result.status, "blocked");
  if (result.status === "blocked") {
    assert.equal(result.reason, "missing_session");
  }
});

test("E. malformed coverage → blocked", () => {
  const db = openMemoryDb();
  seedBase(db);
  const notJson = loadInitialConceptProcessingCoverage({
    candidateReportText: "{not-json",
    expectedSourceHash: "x",
  });
  assert.equal(notJson.ok, false);
  const missingSelected = loadReport({
    metadata: {
      promptVersion: CONCEPT_EXTRACT_PROMPT_VERSION,
      extractionVersion: CONCEPT_EXTRACTION_VERSION,
    },
    concepts: [],
    actions: [],
  });
  assert.equal(missingSelected.ok, false);
  const leaked = loadReport(
    candidateReport({
      selectedSessionIds: [COVERED_WITH_OCC],
      actions: [{ sessionId: ELIGIBLE_NEW, originalAction: "skip" }],
    }),
  );
  assert.equal(leaked.ok, false);
  const result = evaluateIncrementalSessionEligibility({
    sessionId: ELIGIBLE_NEW,
    db,
    coverage: leaked,
  });
  assert.equal(result.status, "blocked");
  if (result.status === "blocked") {
    assert.equal(result.reason, "malformed_coverage");
  }
});

test("F. unknown / unresolved coverage は eligible に倒さない", () => {
  const db = openMemoryDb();
  seedBase(db);
  const wrongHash = loadReport(candidateReport({
    selectedSessionIds: [COVERED_WITH_OCC],
  }), "not-the-hash");
  assert.equal(wrongHash.ok, false);
  if (wrongHash.ok === false) {
    assert.equal(wrongHash.code, "source_hash_mismatch");
  }
  const result = evaluateIncrementalSessionEligibility({
    sessionId: ELIGIBLE_NEW,
    db,
    coverage: { ok: false, code: "coverage_unresolved", detail: "unknown" },
  });
  assert.equal(result.status, "blocked");
  if (result.status === "blocked") {
    assert.equal(result.reason, "coverage_unresolved");
  }
  assert.notEqual(result.status, "eligible");
});

test("G. deterministic rerun", () => {
  const db = openMemoryDb();
  seedBase(db);
  const coverage = defaultCoverage();
  const first = evaluateIncrementalSessionEligibility({
    sessionId: COVERED_ZERO_OCC,
    db,
    coverage,
  });
  const second = evaluateIncrementalSessionEligibility({
    sessionId: COVERED_ZERO_OCC,
    db,
    coverage,
  });
  assert.deepEqual(first, second);
  const loadedTwice = [
    loadReport(
      candidateReport({
        selectedSessionIds: [COVERED_ZERO_OCC, COVERED_WITH_OCC],
      }),
    ),
    loadReport(
      candidateReport({
        selectedSessionIds: [COVERED_WITH_OCC, COVERED_ZERO_OCC],
      }),
    ),
  ];
  assert.equal(loadedTwice[0]?.ok, true);
  assert.equal(loadedTwice[1]?.ok, true);
  if (loadedTwice[0]?.ok && loadedTwice[1]?.ok) {
    assert.deepEqual(
      loadedTwice[0].coverage.sessionIds,
      loadedTwice[1].coverage.sessionIds,
    );
  }
});

test("H. zero write", () => {
  const db = openMemoryDb();
  seedBase(db);
  const before = counts(db);
  evaluateIncrementalSessionEligibility({
    sessionId: COVERED_ZERO_OCC,
    db,
    coverage: defaultCoverage(),
  });
  evaluateIncrementalSessionEligibility({
    sessionId: ELIGIBLE_NEW,
    db,
    coverage: defaultCoverage(),
  });
  assert.deepEqual(counts(db), before);
});

test("I. Calibration annotation は coverage 判定に使わない", () => {
  const db = openMemoryDb();
  seedBase(db);
  const plain = loadReport(
    candidateReport({
      selectedSessionIds: [COVERED_ZERO_OCC],
    }),
  );
  const annotated = loadReport(
    candidateReport({
      selectedSessionIds: [COVERED_ZERO_OCC],
      extraMetadata: {
        calibrationClass: "A",
        expectedDecision: "admit",
        falsePositive: true,
      },
    }),
  );
  assert.equal(plain.ok, true);
  assert.equal(annotated.ok, true);
  const first = evaluateIncrementalSessionEligibility({
    sessionId: COVERED_ZERO_OCC,
    db,
    coverage: plain,
  });
  const second = evaluateIncrementalSessionEligibility({
    sessionId: COVERED_ZERO_OCC,
    db,
    coverage: annotated,
  });
  assert.deepEqual(first, second);
  assert.equal(first.status, "already_covered");
});

test("J. ConceptOccurrence の有無だけで判定していない", () => {
  const db = openMemoryDb();
  seedBase(db);
  const coverage = defaultCoverage();
  const withOcc = evaluateIncrementalSessionEligibility({
    sessionId: COVERED_WITH_OCC,
    db,
    coverage,
  });
  const zeroOcc = evaluateIncrementalSessionEligibility({
    sessionId: COVERED_ZERO_OCC,
    db,
    coverage,
  });
  const eligible = evaluateIncrementalSessionEligibility({
    sessionId: ELIGIBLE_NEW,
    db,
    coverage,
  });
  assert.equal(withOcc.status, "already_covered");
  assert.equal(zeroOcc.status, "already_covered");
  assert.equal(eligible.status, "eligible");
  assert.equal(countConceptOccurrences(db), 1);
});

test("eligibility は Occurrence / Calibration / LLM / write path に依存しない", () => {
  const source = readFileSync(
    resolve(process.cwd(), "lib/concepts/incremental/eligibility.ts"),
    "utf8",
  );
  assert.match(source, /selectedSessionIds/);
  assert.match(source, /hashSourceArtifactText/);
  assert.match(source, /hasIncrementalConceptProcessingCheckpoint/);
  assert.match(source, /incremental_processing_checkpoint/);
  assert.doesNotMatch(source, /conceptOccurrences/);
  assert.doesNotMatch(source, /countConceptOccurrences/);
  assert.doesNotMatch(source, /evaluatePolicyCalibration/);
  assert.doesNotMatch(source, /calibrationClass/);
  assert.doesNotMatch(source, /planIncrementalSession/);
  assert.doesNotMatch(source, /createProductionIncrementalCandidateExtractor/);
  assert.doesNotMatch(source, /applyExistingMatchOccurrences/);
  assert.doesNotMatch(source, /getDb\(/);
  assert.doesNotMatch(source, /openai/);
  assert.doesNotMatch(source, /app\.db/);
  assert.doesNotMatch(source, /負の連鎖/);
});
