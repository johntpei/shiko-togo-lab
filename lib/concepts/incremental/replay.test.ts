import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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
import {
  CONCEPT_INCREMENTAL_REPLAY_APPLY_ERROR,
  EXISTING_MATCH_REPLAYABLE,
  EXISTING_MATCH_REPLAYABILITY_GAP,
  auditExistingMatchReplayability,
  parseConceptIncrementalReplayAuditArgs,
  runConceptIncrementalReplayAudit,
} from "./replay";

const SESSION_ID = "session-replay";
const MESSAGE_ID = `${SESSION_ID}-u`;
const HUMAN_ID = "concept-parents";
const USER =
  "SECRET_USER_BODY_REPLAY_両親のことを何度も思い出してしまった。";
const ASSISTANT = "SECRET_ASSISTANT_BODY_REPLAY_了解しました。";
const SURFACE = "両親";

function openMemoryDb() {
  const sqlite = new Database(":memory:");
  applySqlMigrations(sqlite);
  sqlite.pragma("foreign_keys = ON");
  return drizzle(sqlite, { schema });
}

function seed(db: ReturnType<typeof openMemoryDb>) {
  db.insert(schema.sessions)
    .values({
      id: SESSION_ID,
      title: SESSION_ID,
      occurredAt: "2099-01-01",
      source: "chatgpt",
      category: "制作",
      rawContent: USER,
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
      id: MESSAGE_ID,
      sessionId: SESSION_ID,
      index: 0,
      role: "user",
      content: USER,
      charStart: 0,
      charEnd: USER.length,
      sourceMessageId: null,
      sourceCreatedAt: "2026-07-13T00:00:00.000Z",
      contentType: "text",
      attachmentsJson: null,
    })
    .run();
  db.insert(schema.messages)
    .values({
      id: `${SESSION_ID}-a`,
      sessionId: SESSION_ID,
      index: 1,
      role: "assistant",
      content: ASSISTANT,
      charStart: 0,
      charEnd: ASSISTANT.length,
      sourceMessageId: null,
      sourceCreatedAt: "2026-07-13T00:00:01.000Z",
      contentType: "text",
      attachmentsJson: null,
    })
    .run();
  insertConcept(
    {
      id: HUMAN_ID,
      canonicalLabel: SURFACE,
      createdAt: "2026-08-18T00:00:00.000Z",
    },
    db,
  );
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

function existingPlan(overrides: Record<string, unknown> = {}) {
  return {
    kind: "existing_match",
    candidateRef: `${HUMAN_ID}:M001:E01:0`,
    evidenceRef: "M001:E01",
    messageId: MESSAGE_ID,
    occurredAt: "2026-07-13T00:00:00.000Z",
    sourceRole: "user",
    sourceType: "evidence_unit",
    extractionVersion: CONCEPT_EXTRACTION_VERSION,
    conceptId: HUMAN_ID,
    matchReason: "exact_canonical",
    provisionalConceptId: null,
    provisionalReason: null,
    ...overrides,
  };
}

function pilotResult(plans: unknown[], extras: Record<string, unknown> = {}) {
  return {
    classification: "REAL_INCREMENTAL_LLM_PILOT_PLANNED",
    status: "planned",
    sessionId: SESSION_ID,
    executedAt: "2026-08-22T00:00:00.000Z",
    model: "test-model",
    promptVersion: CONCEPT_EXTRACT_PROMPT_VERSION,
    extractionVersion: CONCEPT_EXTRACTION_VERSION,
    eligibility: "eligible",
    plans,
    ...extras,
  };
}

function audit(
  db: ReturnType<typeof openMemoryDb>,
  plans: unknown[],
  extras: Record<string, unknown> = {},
) {
  return auditExistingMatchReplayability({
    db,
    pilotResultText: JSON.stringify(pilotResult(plans, extras)),
    sourcePilotResult: "memory://pilot.json",
    now: () => "2026-08-22T00:00:00.000Z",
  });
}

test("A. complete replayable input", () => {
  const db = openMemoryDb();
  seed(db);
  const before = counts(db);
  const result = audit(db, [
    existingPlan({ surfaceForm: SURFACE }),
    {
      kind: "provisional_new",
      candidateRef: "virtual:adhd:M001:E02:1",
      evidenceRef: "M001:E02",
      conceptId: null,
    },
  ]);
  assert.equal(result.status, EXISTING_MATCH_REPLAYABLE);
  assert.equal(result.intent?.plans.length, 1);
  assert.equal(result.intent?.plans[0]?.kind, "existing_match");
  assert.equal(result.intent?.plans[0]?.provenance.surfaceForm, SURFACE);
  assert.equal(result.intent?.plans[0]?.canonicalLabel, SURFACE);
  assert.equal(result.intent?.plans[0]?.conceptId, HUMAN_ID);
  assert.deepEqual(counts(db), before);
});

test("B. missing surfaceForm is a gap and is not guessed", () => {
  const db = openMemoryDb();
  seed(db);
  const result = audit(db, [existingPlan()]);
  assert.equal(result.status, EXISTING_MATCH_REPLAYABILITY_GAP);
  assert.equal(result.intent, null);
  assert.equal(
    result.gaps.some((gap) => gap.code === "missing_surface_form"),
    true,
  );
  const source = readFileSync(
    resolve(process.cwd(), "lib/concepts/incremental/replay.ts"),
    "utf8",
  );
  assert.doesNotMatch(source, /canonicalLabel.*surfaceForm/);
  assert.doesNotMatch(source, /unit\.text/);
  assert.doesNotMatch(source, /normalizeConceptKey\(.*canonicalLabel/);
});

test("C. missing concept is a gap", () => {
  const db = openMemoryDb();
  seed(db);
  const result = audit(db, [
    existingPlan({
      surfaceForm: SURFACE,
      conceptId: "missing-concept",
    }),
  ]);
  assert.equal(result.status, EXISTING_MATCH_REPLAYABILITY_GAP);
  assert.equal(result.intent, null);
  assert.equal(result.gaps.some((gap) => gap.code === "missing_concept"), true);
});

test("D. unresolved provenance is a gap", () => {
  const db = openMemoryDb();
  seed(db);
  const result = audit(db, [
    existingPlan({
      surfaceForm: SURFACE,
      evidenceRef: "M099:E99",
    }),
  ]);
  assert.equal(result.status, EXISTING_MATCH_REPLAYABILITY_GAP);
  assert.equal(result.intent, null);
  assert.equal(
    result.gaps.some((gap) => gap.code === "evidence_ref_unresolved"),
    true,
  );
});

test("E. provisional_new is excluded from Frozen Intent", () => {
  const db = openMemoryDb();
  seed(db);
  const result = audit(db, [
    existingPlan({ surfaceForm: SURFACE }),
    {
      kind: "provisional_new",
      candidateRef: "virtual:adhd:M001:E02:1",
      evidenceRef: "M001:E02",
      provisionalConceptId: "other",
    },
  ]);
  assert.equal(result.status, EXISTING_MATCH_REPLAYABLE);
  assert.equal(result.provisionalNewExcluded, 1);
  assert.equal(result.intent?.plans.length, 1);
  assert.equal(
    result.intent?.plans.some((plan) => plan.kind !== "existing_match"),
    false,
  );
});

test("F. intent has no USER / Evidence full content", () => {
  const db = openMemoryDb();
  seed(db);
  const result = audit(db, [existingPlan({ surfaceForm: SURFACE })]);
  const serialized = JSON.stringify(result.intent);
  assert.equal(serialized.includes(USER), false);
  assert.equal(serialized.includes(ASSISTANT), false);
  assert.equal(serialized.includes("SECRET_USER_BODY"), false);
  assert.doesNotMatch(serialized, /"content":/);
  assert.doesNotMatch(serialized, /"rawContent":/);
  assert.match(serialized, /"surfaceForm":"両親"/);
});

test("G. deterministic replayability and intent", () => {
  const firstDb = openMemoryDb();
  seed(firstDb);
  const secondDb = openMemoryDb();
  seed(secondDb);
  const plans = [existingPlan({ surfaceForm: SURFACE })];
  const first = audit(firstDb, plans);
  const second = audit(secondDb, plans);
  assert.equal(first.status, second.status);
  assert.equal(first.sourcePilotResultHash, second.sourcePilotResultHash);
  assert.deepEqual(first.intent?.plans, second.intent?.plans);
  assert.deepEqual(first.gaps, second.gaps);
});

test("H. zero DB write", () => {
  const db = openMemoryDb();
  seed(db);
  const before = counts(db);
  audit(db, [existingPlan()]);
  audit(db, [existingPlan({ surfaceForm: SURFACE })]);
  audit(db, [
    existingPlan({
      surfaceForm: SURFACE,
      evidenceRef: "M099:E99",
    }),
  ]);
  assert.deepEqual(counts(db), before);
  assert.deepEqual(counts(db).occurrences, 0);
});

test("--apply is rejected with LLM-equivalent side effects 0", async () => {
  const parsed = parseConceptIncrementalReplayAuditArgs(["--apply"]);
  assert.equal(parsed.apply, true);
  const db = openMemoryDb();
  seed(db);
  const before = counts(db);
  let opened = false;
  const result = await Promise.resolve(
    runConceptIncrementalReplayAudit(["--apply"], {
      openDb: () => {
        opened = true;
        return db;
      },
    }),
  );
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "apply");
    assert.equal(result.error, CONCEPT_INCREMENTAL_REPLAY_APPLY_ERROR);
  }
  assert.equal(opened, false);
  assert.deepEqual(counts(db), before);
});

test("audit does not execute preflight / append / extractor", () => {
  const sources = [
    "lib/concepts/incremental/replay.ts",
    "scripts/concept-incremental-replay-audit.ts",
  ].map((path) => readFileSync(resolve(process.cwd(), path), "utf8"));
  for (const source of sources) {
    assert.doesNotMatch(source, /runExistingMatchOccurrencePreflight/);
    assert.doesNotMatch(source, /runExistingMatchOccurrenceAppend/);
    assert.doesNotMatch(source, /applyExistingMatchOccurrences/);
    assert.doesNotMatch(source, /planEligibleIncrementalSession/);
    assert.doesNotMatch(source, /createProductionIncrementalCandidateExtractor/);
    assert.doesNotMatch(source, /getAiProvider/);
    assert.doesNotMatch(source, /from "openai"/);
  }
});
