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
  CONCEPT_APPLY_APPLY_ERROR,
  buildIncrementalPilotPreflightReport,
  parseConceptIncrementalPilotPreflightArgs,
  runConceptIncrementalPilotPreflight,
} from "./pilot-preflight";

const COVERED = "session-covered";
const COVERED_ZERO_OCC = "session-covered-zero";
const ELIGIBLE_EVIDENCE = "session-eligible-evidence";
const ELIGIBLE_ZERO = "session-eligible-zero";
const MISSING_COVERED = "session-missing-covered";
const HUMAN_ID = "concept-human-relations";
const USER_BODY =
  "SECRET_USER_BODY_DO_NOT_COPY_INTO_REPORT_これまでの人間関係でなぜ上手くいかないのか理解できないと思った。";
const ASSISTANT_BODY = "SECRET_ASSISTANT_BODY_了解しました。整理します。";

function openMemoryDb() {
  const sqlite = new Database(":memory:");
  applySqlMigrations(sqlite);
  sqlite.pragma("foreign_keys = ON");
  return drizzle(sqlite, { schema });
}

function seedSession(
  db: ReturnType<typeof openMemoryDb>,
  input: {
    id: string;
    occurredAt: string;
    conversationId?: string | null;
    messages: Array<{
      id: string;
      index: number;
      role: string;
      content: string;
    }>;
  },
) {
  db.insert(schema.sessions)
    .values({
      id: input.id,
      title: input.id,
      occurredAt: input.occurredAt,
      source: "chatgpt",
      category: "制作",
      rawContent: USER_BODY,
      status: "parsed",
      sourceConversationId: input.conversationId ?? null,
      importSource: "manual",
      sourceStartAt: null,
      sourceEndAt: null,
      createdAt: "2026-08-18T00:00:00.000Z",
      updatedAt: "2026-08-18T00:00:00.000Z",
    })
    .run();
  for (const message of input.messages) {
    db.insert(schema.messages)
      .values({
        id: message.id,
        sessionId: input.id,
        index: message.index,
        role: message.role,
        content: message.content,
        charStart: 0,
        charEnd: message.content.length,
        sourceMessageId: null,
        sourceCreatedAt: "2026-07-15T12:00:00.000Z",
        contentType: "text",
        attachmentsJson: null,
      })
      .run();
  }
}

function seedUserSession(
  db: ReturnType<typeof openMemoryDb>,
  id: string,
  occurredAt: string,
) {
  seedSession(db, {
    id,
    occurredAt,
    messages: [
      {
        id: `${id}-u`,
        index: 0,
        role: "user",
        content: USER_BODY,
      },
      {
        id: `${id}-a`,
        index: 1,
        role: "assistant",
        content: ASSISTANT_BODY,
      },
    ],
  });
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
    actions: input.actions ??
      input.selectedSessionIds.map((sessionId) => ({
        sessionId,
        evidenceRef: "M001:E01",
        originalAction: "skip",
      })),
    failedSessions: [],
  };
}

function manifestText(candidateText: string) {
  return JSON.stringify({
    metadata: {
      sourceCandidateReportHash: hashSourceArtifactText(candidateText),
    },
  });
}

function mixedDb() {
  const db = openMemoryDb();
  seedUserSession(db, COVERED, "2099-01-03");
  seedUserSession(db, COVERED_ZERO_OCC, "2099-01-01");
  seedUserSession(db, ELIGIBLE_EVIDENCE, "2099-01-04");
  seedSession(db, {
    id: ELIGIBLE_ZERO,
    occurredAt: "2099-01-02",
    messages: [
      {
        id: `${ELIGIBLE_ZERO}-a`,
        index: 0,
        role: "assistant",
        content: ASSISTANT_BODY,
      },
    ],
  });
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
      sessionId: COVERED,
      messageId: `${COVERED}-u`,
      evidenceRef: "M001:E01",
      occurredAt: "2026-07-15T12:00:00.000Z",
      sourceRole: "user",
      sourceType: "evidence_unit",
      extractionVersion: CONCEPT_EXTRACTION_VERSION,
    },
    db,
  );
  assert.equal(inserted.status, "inserted");
  return db;
}

function mixedCoverageText() {
  return JSON.stringify(
    candidateReport({
      selectedSessionIds: [COVERED, COVERED_ZERO_OCC, MISSING_COVERED],
    }),
  );
}

function mixedReport(db: ReturnType<typeof openMemoryDb>) {
  const candidateText = mixedCoverageText();
  return buildIncrementalPilotPreflightReport({
    db,
    candidateReportText: candidateText,
    expectedSourceHash: hashSourceArtifactText(candidateText),
    now: () => "2026-08-22T00:00:00.000Z",
  });
}

test("A. mixed eligibility summary", () => {
  const db = openMemoryDb();
  seedUserSession(db, COVERED, "2099-01-01");
  seedUserSession(db, ELIGIBLE_EVIDENCE, "2099-01-02");
  seedSession(db, {
    id: ELIGIBLE_ZERO,
    occurredAt: "2099-01-03",
    messages: [
      {
        id: `${ELIGIBLE_ZERO}-a`,
        index: 0,
        role: "assistant",
        content: ASSISTANT_BODY,
      },
    ],
  });
  const candidateText = JSON.stringify(
    candidateReport({
      selectedSessionIds: [COVERED, MISSING_COVERED],
    }),
  );
  const report = buildIncrementalPilotPreflightReport({
    db,
    candidateReportText: candidateText,
    expectedSourceHash: hashSourceArtifactText(candidateText),
    now: () => "2026-08-22T00:00:00.000Z",
  });
  assert.equal(report.summary.totalSessions, 3);
  assert.equal(report.summary.alreadyCoveredSessions, 1);
  assert.equal(report.summary.eligibleSessions, 2);
  assert.equal(report.summary.blockedSessions, 1);
  assert.equal(report.blocked[0]?.sessionId, MISSING_COVERED);
  assert.equal(report.blocked[0]?.reason, "missing_session");
});

test("B. covered zero occurrence is already_covered and not a pilot candidate", () => {
  const db = mixedDb();
  const report = mixedReport(db);
  assert.equal(
    report.alreadyCovered.some((row) => row.sessionId === COVERED_ZERO_OCC),
    true,
  );
  assert.equal(
    report.coveredZeroOccurrenceSessionIds.includes(COVERED_ZERO_OCC),
    true,
  );
  assert.equal(
    report.preferredPilotCandidates.some(
      (row) => row.sessionId === COVERED_ZERO_OCC,
    ),
    false,
  );
  assert.equal(
    report.alreadyCovered.find((row) => row.sessionId === COVERED_ZERO_OCC)
      ?.eligibility,
    "already_covered",
  );
  assert.equal(
    report.alreadyCovered.find((row) => row.sessionId === COVERED_ZERO_OCC)
      ?.occurrenceCount,
    0,
  );
});

test("C. eligible with USER Evidence is a preferred pilot candidate", () => {
  const db = mixedDb();
  const report = mixedReport(db);
  const candidate = report.preferredPilotCandidates.find(
    (row) => row.sessionId === ELIGIBLE_EVIDENCE,
  );
  assert.ok(candidate);
  assert.equal(candidate?.userEvidenceUnitCount >= 1, true);
  assert.equal(candidate?.userMessageCount, 1);
});

test("D. eligible zero USER Evidence is counted separately", () => {
  const db = mixedDb();
  const report = mixedReport(db);
  assert.equal(report.summary.eligibleWithoutUserEvidence, 1);
  assert.equal(report.summary.eligibleWithUserEvidence, 1);
  assert.equal(
    report.eligibleWithoutUserEvidence.some(
      (row) => row.sessionId === ELIGIBLE_ZERO,
    ),
    true,
  );
  assert.equal(
    report.preferredPilotCandidates.some(
      (row) => row.sessionId === ELIGIBLE_ZERO,
    ),
    false,
  );
  assert.equal(
    report.eligibleWithoutUserEvidence[0]?.userEvidenceUnitCount,
    0,
  );
});

test("E. missing covered Session follows eligibility and blocks invariant", () => {
  const db = mixedDb();
  const report = mixedReport(db);
  assert.equal(report.blocked[0]?.reason, "missing_session");
  assert.deepEqual(report.initialCoveredInvariant.missingFromDb, [
    MISSING_COVERED,
  ]);
  assert.equal(report.status, "blocked");
  assert.equal(
    report.blockers.some((item) => item.code === "initial_covered_invariant"),
    true,
  );
});

test("F. deterministic candidate ordering", () => {
  const first = mixedReport(mixedDb());
  const second = mixedReport(mixedDb());
  assert.deepEqual(
    first.preferredPilotCandidates.map((row) => row.sessionId),
    second.preferredPilotCandidates.map((row) => row.sessionId),
  );
  assert.deepEqual(
    first.alreadyCovered.map((row) => row.sessionId),
    second.alreadyCovered.map((row) => row.sessionId),
  );
  assert.equal(first.ordering, "occurredAt_asc_then_sessionId_asc");
  assert.deepEqual(
    first.alreadyCovered.map((row) => row.sessionId),
    [COVERED_ZERO_OCC, COVERED],
  );
  assert.deepEqual(
    first.preferredPilotCandidates.map((row) => row.sessionId),
    [ELIGIBLE_EVIDENCE],
  );
  assert.deepEqual(
    first.eligibleWithoutUserEvidence.map((row) => row.sessionId),
    [ELIGIBLE_ZERO],
  );
});

test("G. report serialization contains no USER or Evidence body", () => {
  const db = mixedDb();
  const serialized = JSON.stringify(mixedReport(db));
  assert.equal(serialized.includes(USER_BODY), false);
  assert.equal(serialized.includes(ASSISTANT_BODY), false);
  assert.equal(serialized.includes("SECRET_USER_BODY"), false);
  assert.doesNotMatch(serialized, /"content":/);
  assert.doesNotMatch(serialized, /"rawContent":/);
  assert.doesNotMatch(serialized, /"text":/);
});

test("H. zero DB write", () => {
  const db = mixedDb();
  const before = counts(db);
  mixedReport(db);
  assert.deepEqual(counts(db), before);
});

test("I. LLM / planning / extractor boundary is not imported", () => {
  const sources = [
    "lib/concepts/incremental/pilot-preflight.ts",
    "scripts/concept-incremental-pilot-preflight.ts",
  ].map((path) => readFileSync(resolve(process.cwd(), path), "utf8"));
  for (const source of sources) {
    assert.doesNotMatch(source, /planEligibleIncrementalSession/);
    assert.doesNotMatch(source, /planIncrementalSession/);
    assert.doesNotMatch(source, /createProductionIncrementalCandidateExtractor/);
    assert.doesNotMatch(source, /generateStructured/);
    assert.doesNotMatch(source, /getAiProvider/);
    assert.doesNotMatch(source, /openai/);
    assert.doesNotMatch(source, /runExistingMatchOccurrenceAppend/);
    assert.doesNotMatch(source, /selectedSessionIds\.includes/);
  }
});

test("J. --apply is rejected with DB write 0", () => {
  assert.equal(
    parseConceptIncrementalPilotPreflightArgs(["--apply"]).apply,
    true,
  );
  const db = mixedDb();
  const before = counts(db);
  let opened = false;
  const result = runConceptIncrementalPilotPreflight(["--apply"], {
    openDb: () => {
      opened = true;
      return db;
    },
  });
  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }
  assert.equal(result.code, "apply");
  assert.equal(result.error, CONCEPT_APPLY_APPLY_ERROR);
  assert.equal(opened, false);
  assert.deepEqual(counts(db), before);
});

test("ready when every Initial selected Session is already_covered", () => {
  const db = mixedDb();
  const candidateText = JSON.stringify(
    candidateReport({
      selectedSessionIds: [COVERED, COVERED_ZERO_OCC],
    }),
  );
  const report = buildIncrementalPilotPreflightReport({
    db,
    candidateReportText: candidateText,
    expectedSourceHash: hashSourceArtifactText(candidateText),
    now: () => "2026-08-22T00:00:00.000Z",
  });
  assert.equal(report.status, "ready");
  assert.equal(report.coverage.ok, true);
  assert.equal(report.coverage.extractPromptVersion, CONCEPT_EXTRACT_PROMPT_VERSION);
  assert.equal(report.coverage.extractionVersion, CONCEPT_EXTRACTION_VERSION);
  assert.equal(report.initialCoveredInvariant.ok, true);
  assert.equal(report.initialCoveredInvariant.selectedSessionCount, 2);
  assert.equal(report.summary.blockedSessions, 0);
  assert.equal(report.db.before.sessions, report.db.after.sessions);
  assert.equal(report.db.before.messages, report.db.after.messages);
});

test("CLI reads expected hash from Manifest and does not hardcode it", () => {
  const db = mixedDb();
  const candidateText = JSON.stringify(
    candidateReport({
      selectedSessionIds: [COVERED, COVERED_ZERO_OCC],
    }),
  );
  const expected = hashSourceArtifactText(candidateText);
  const result = runConceptIncrementalPilotPreflight([], {
    openDb: () => db,
    readFile: (path) => {
      if (path.includes("concept-pilot-2b-v4") || path.includes("candidates")) {
        return candidateText;
      }
      if (path.includes("manifest")) {
        return manifestText(candidateText);
      }
      throw new Error(`unexpected path ${path}`);
    },
    writeReport: () => {},
    now: () => "2026-08-22T00:00:00.000Z",
  });
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(result.report.coverage.expectedSourceHash, expected);
  assert.equal(result.report.coverage.sourceHash, expected);
  const source = readFileSync(
    resolve(process.cwd(), "lib/concepts/incremental/pilot-preflight.ts"),
    "utf8",
  );
  assert.doesNotMatch(source, /f7f46ad8/);
});
