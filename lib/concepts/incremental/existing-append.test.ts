import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import {
  CONCEPT_EXTRACT_PROMPT_V3,
  CONCEPT_EXTRACT_PROMPT_VERSION,
} from "@/lib/ai/prompts/concept-extract";
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
  buildExistingMatchAppendIntent,
} from "./append-intent";
import {
  parseConceptIncrementalExistingAppendArgs,
  REAL_EXISTING_MATCH_ALREADY_PRESENT,
  REAL_EXISTING_MATCH_APPENDED,
  REAL_EXISTING_MATCH_APPENDED_REPORT_FAILED,
  REAL_EXISTING_MATCH_APPEND_FAILED_ROLLED_BACK,
  REAL_EXISTING_MATCH_APPEND_PREVIEW,
  runConceptIncrementalExistingAppend,
  type ExistingMatchAppendResult,
} from "./existing-append";
import type { ExistingMatchPlan } from "./plan";
import { findExistingMatchOccurrenceByIdentity } from "./validate";

const COVERED = "session-covered";
const ELIGIBLE = "session-eligible";
const HUMAN_ID = "concept-human-relations";
const USER_A =
  "SECRET_USER_BODY_EXISTING_APPEND_これまでの人間関係でなぜ上手くいかないのか理解できないと思った。";
const ASSISTANT = "SECRET_ASSISTANT_BODY_EXISTING_APPEND_了解しました。";
const SURFACE = "人間関係";
const OCCURRED_AT = "2026-07-15T12:00:00.000Z";
const SESSION_OCCURRED_AT = "2099-01-01";

function openMemoryDb() {
  const sqlite = new Database(":memory:");
  applySqlMigrations(sqlite);
  sqlite.pragma("foreign_keys = ON");
  return drizzle(sqlite, { schema });
}

function seedSession(
  db: ReturnType<typeof openMemoryDb>,
  id: string,
  content: string,
) {
  db.insert(schema.sessions)
    .values({
      id,
      title: id,
      occurredAt: SESSION_OCCURRED_AT,
      source: "chatgpt",
      category: "制作",
      rawContent: content,
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
      sourceCreatedAt: OCCURRED_AT,
      contentType: "text",
      attachmentsJson: null,
    })
    .run();
  db.insert(schema.messages)
    .values({
      id: `${id}-a`,
      sessionId: id,
      index: 1,
      role: "assistant",
      content: ASSISTANT,
      charStart: 0,
      charEnd: ASSISTANT.length,
      sourceMessageId: null,
      sourceCreatedAt: OCCURRED_AT,
      contentType: "text",
      attachmentsJson: null,
    })
    .run();
}

function seedBase(db: ReturnType<typeof openMemoryDb>) {
  seedSession(db, COVERED, USER_A);
  seedSession(db, ELIGIBLE, USER_A);
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

function candidateReportText(selectedSessionIds: string[]) {
  return JSON.stringify({
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
  });
}

function manifestText(candidateText: string) {
  return JSON.stringify({
    metadata: {
      sourceCandidateReportHash: hashSourceArtifactText(candidateText),
    },
  });
}

function exactPlan(
  overrides: Partial<ExistingMatchPlan> = {},
): ExistingMatchPlan {
  return {
    kind: "existing_match",
    candidateRef: `${HUMAN_ID}:M001:E01:0`,
    conceptId: HUMAN_ID,
    matchReason: "exact_canonical",
    canonicalLabel: SURFACE,
    normalizedKey: SURFACE,
    provenance: {
      sessionId: ELIGIBLE,
      messageId: `${ELIGIBLE}-u`,
      evidenceRef: "M001:E01",
      occurredAt: OCCURRED_AT,
      surfaceForm: SURFACE,
      sourceRole: "user",
      sourceType: "evidence_unit",
      extractionVersion: CONCEPT_EXTRACTION_VERSION,
    },
    ...overrides,
  };
}

function intentJson(
  plans: ExistingMatchPlan[],
  extras: {
    sessionId?: string;
    promptVersion?: string;
    extractionVersion?: string;
    coverageSourceHash?: string;
    model?: string | null;
  } = {},
) {
  const candidateText = candidateReportText([COVERED]);
  const built = buildExistingMatchAppendIntent({
    sessionId: extras.sessionId ?? ELIGIBLE,
    plans,
    source: {
      model: extras.model === undefined ? "gpt-4o" : extras.model,
      promptVersion: extras.promptVersion ?? CONCEPT_EXTRACT_PROMPT_VERSION,
      extractionVersion: extras.extractionVersion ?? CONCEPT_EXTRACTION_VERSION,
      coverageSourceHash:
        extras.coverageSourceHash ?? hashSourceArtifactText(candidateText),
    },
    now: () => "2026-08-22T00:00:00.000Z",
  });
  assert.equal(built.ok, true);
  if (!built.ok) {
    throw new Error(built.detail);
  }
  return { text: JSON.stringify(built.intent), intent: built.intent, candidateText };
}

type RunOverrides = {
  extraArgs?: string[];
  plan?: ExistingMatchPlan;
  intentText?: string;
  candidateText?: string;
  seed?: (db: ReturnType<typeof openMemoryDb>) => void;
  afterPreflight?: (db: ReturnType<typeof openMemoryDb>) => void;
  writeResult?: (path: string, payload: ExistingMatchAppendResult) => void;
};

async function runAppend(overrides: RunOverrides = {}) {
  const db = openMemoryDb();
  if (overrides.seed) {
    overrides.seed(db);
  } else {
    seedBase(db);
  }
  const candidateText =
    overrides.candidateText ?? candidateReportText([COVERED]);
  const built =
    overrides.intentText != null
      ? {
          text: overrides.intentText,
          intent: null as ReturnType<typeof intentJson>["intent"] | null,
          candidateText,
        }
      : intentJson([overrides.plan ?? exactPlan()], {
          coverageSourceHash: hashSourceArtifactText(candidateText),
        });
  const before = counts(db);
  let opened = false;
  let written: ExistingMatchAppendResult | null = null;
  const result = await runConceptIncrementalExistingAppend(
    ["--intent", "memory://intent.json", ...(overrides.extraArgs ?? [])],
    {
      openDb: () => {
        opened = true;
        return db;
      },
      readFile: (path) => {
        if (path.includes("intent")) {
          return built.text;
        }
        if (
          path.includes("concept-pilot-2b-v4") ||
          path.includes("candidates")
        ) {
          return candidateText;
        }
        if (path.includes("manifest")) {
          return manifestText(candidateText);
        }
        throw new Error(`unexpected path ${path}`);
      },
      writeResult: (path, payload) => {
        written = payload;
        overrides.writeResult?.(path, payload);
      },
      afterPreflight: overrides.afterPreflight,
      now: () => "2026-08-22T12:00:00.000Z",
    },
  );
  return { result, db, before, opened, written, candidateText, built };
}

test("parse requires --intent and accepts --apply", () => {
  assert.equal(parseConceptIncrementalExistingAppendArgs([]).malformed, true);
  assert.equal(
    parseConceptIncrementalExistingAppendArgs(["--apply"]).malformed,
    true,
  );
  assert.equal(
    parseConceptIncrementalExistingAppendArgs([
      "--intent",
      "data/concept-incremental-existing-append-intent-v1.json",
    ]).apply,
    false,
  );
  assert.equal(
    parseConceptIncrementalExistingAppendArgs([
      "--intent",
      "data/concept-incremental-existing-append-intent-v1.json",
      "--apply",
    ]).apply,
    true,
  );
  assert.equal(
    parseConceptIncrementalExistingAppendArgs([
      "--intent",
      "a.json",
      "--intent",
      "b.json",
    ]).malformed,
    true,
  );
});

test("A. preview without --apply does not write", async () => {
  const { result, db, before, written } = await runAppend();
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(result.result.classification, REAL_EXISTING_MATCH_APPEND_PREVIEW);
  assert.equal(result.result.applyRequested, false);
  assert.equal(result.result.transactionStarted, false);
  assert.equal(result.result.transactionCommitted, false);
  assert.equal(result.result.occurrencesCreated, 0);
  assert.equal(result.result.preflight.status, "ready");
  assert.equal(result.result.preflight.predictedCreates, 1);
  assert.deepEqual(counts(db), before);
  assert.equal(written?.classification, REAL_EXISTING_MATCH_APPEND_PREVIEW);
});

test("B. valid explicit apply inserts one Occurrence", async () => {
  const { result, db, before } = await runAppend({ extraArgs: ["--apply"] });
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(result.result.classification, REAL_EXISTING_MATCH_APPENDED);
  assert.equal(result.result.transactionStarted, true);
  assert.equal(result.result.transactionCommitted, true);
  assert.equal(result.result.occurrencesCreated, 1);
  assert.equal(result.result.alreadyPresent, 0);
  assert.equal(result.result.conflicts, 0);
  assert.equal(result.result.postWriteVerified, true);
  const after = counts(db);
  assert.equal(after.concepts, before.concepts);
  assert.equal(after.aliases, before.aliases);
  assert.equal(after.occurrences, before.occurrences + 1);
  const row = findExistingMatchOccurrenceByIdentity(db, exactPlan());
  assert.ok(row);
  assert.equal(
    db.select().from(schema.conceptOccurrences).all().length,
    after.occurrences,
  );
});

test("C. exact already present is a no-op", async () => {
  const { result, db, before } = await runAppend({
    extraArgs: ["--apply"],
    seed: (memory) => {
      seedBase(memory);
      const inserted = insertConceptOccurrence(
        {
          id: "occ-existing",
          conceptId: HUMAN_ID,
          sessionId: ELIGIBLE,
          messageId: `${ELIGIBLE}-u`,
          evidenceRef: "M001:E01",
          occurredAt: OCCURRED_AT,
          sourceRole: "user",
          sourceType: "evidence_unit",
          extractionVersion: CONCEPT_EXTRACTION_VERSION,
        },
        memory,
      );
      assert.equal(inserted.status, "inserted");
    },
  });
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(
    result.result.classification,
    REAL_EXISTING_MATCH_ALREADY_PRESENT,
  );
  assert.equal(result.result.transactionStarted, false);
  assert.equal(result.result.occurrencesCreated, 0);
  assert.equal(result.result.alreadyPresent, 1);
  assert.deepEqual(counts(db), before);
  assert.equal(db.select().from(schema.conceptOccurrences).all().length, 1);
});

test("D. fresh preflight blocked does not start a transaction", async () => {
  const { result, db, before, opened } = await runAppend({
    extraArgs: ["--apply"],
    seed: (memory) => {
      seedSession(memory, COVERED, USER_A);
      seedSession(memory, ELIGIBLE, USER_A);
    },
  });
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(opened, true);
  assert.equal(
    result.result.classification,
    REAL_EXISTING_MATCH_APPEND_FAILED_ROLLED_BACK,
  );
  assert.equal(result.result.preflight.status, "blocked");
  assert.equal(result.result.transactionStarted, false);
  assert.equal(result.result.transactionCommitted, false);
  assert.deepEqual(counts(db), before);
});

test("E. TOCTOU after preflight rolls back inside the transaction", async () => {
  const { result, db, before } = await runAppend({
    extraArgs: ["--apply"],
    afterPreflight: (memory) => {
      memory
        .update(schema.concepts)
        .set({ canonicalLabel: "別ラベル" })
        .where(eq(schema.concepts.id, HUMAN_ID))
        .run();
    },
  });
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(
    result.result.classification,
    REAL_EXISTING_MATCH_APPEND_FAILED_ROLLED_BACK,
  );
  assert.equal(result.result.transactionStarted, true);
  assert.equal(result.result.transactionCommitted, false);
  assert.equal(result.result.occurrencesCreated, 0);
  assert.equal(counts(db).occurrences, before.occurrences);
  assert.equal(counts(db).concepts, before.concepts);
  assert.equal(counts(db).aliases, before.aliases);
});

test("F. tampered Intent writes nothing", async () => {
  const built = intentJson([exactPlan()]);
  const tampered = JSON.parse(built.text) as {
    metadata: { contentHash: string };
  };
  tampered.metadata.contentHash = "not-the-hash";
  const { result, opened, db, before } = await runAppend({
    extraArgs: ["--apply"],
    intentText: JSON.stringify(tampered),
    candidateText: built.candidateText,
  });
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(opened, false);
  assert.equal(result.result.transactionStarted, false);
  assert.equal(result.result.occurrencesCreated, 0);
  assert.equal(result.result.preflight.blockers[0]?.code, "content_hash");
  assert.deepEqual(counts(db), before);
});

test("G. coverage mismatch writes nothing", async () => {
  const candidateText = candidateReportText([COVERED]);
  const built = intentJson([exactPlan()], {
    coverageSourceHash:
      "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
  });
  const { result, opened, db, before } = await runAppend({
    extraArgs: ["--apply"],
    intentText: built.text,
    candidateText,
  });
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(opened, false);
  assert.equal(result.result.transactionStarted, false);
  assert.equal(
    result.result.preflight.blockers[0]?.code,
    "coverage_source_mismatch",
  );
  assert.deepEqual(counts(db), before);
});

test("H. eligibility change writes nothing", async () => {
  const plan = exactPlan({
    provenance: {
      ...exactPlan().provenance,
      sessionId: COVERED,
      messageId: `${COVERED}-u`,
    },
  });
  const built = intentJson([plan], { sessionId: COVERED });
  const { result, db, before } = await runAppend({
    extraArgs: ["--apply"],
    intentText: built.text,
    candidateText: built.candidateText,
  });
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(result.result.transactionStarted, false);
  assert.equal(
    result.result.preflight.blockers[0]?.code,
    "initial_processing_coverage",
  );
  assert.deepEqual(counts(db), before);
});

test("I. Concept identity mismatch rolls back", async () => {
  const { result, db, before } = await runAppend({
    extraArgs: ["--apply"],
    afterPreflight: (memory) => {
      memory
        .update(schema.concepts)
        .set({ canonicalLabel: "別ラベル" })
        .where(eq(schema.concepts.id, HUMAN_ID))
        .run();
    },
  });
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(
    result.result.classification,
    REAL_EXISTING_MATCH_APPEND_FAILED_ROLLED_BACK,
  );
  assert.equal(result.result.transactionCommitted, false);
  assert.equal(counts(db).occurrences, before.occurrences);
});

test("J. provenance mismatch rolls back", async () => {
  const { result, db, before } = await runAppend({
    extraArgs: ["--apply"],
    afterPreflight: (memory) => {
      memory
        .update(schema.messages)
        .set({ role: "assistant" })
        .where(eq(schema.messages.id, `${ELIGIBLE}-u`))
        .run();
    },
  });
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(
    result.result.classification,
    REAL_EXISTING_MATCH_APPEND_FAILED_ROLLED_BACK,
  );
  assert.equal(result.result.transactionCommitted, false);
  assert.equal(counts(db).occurrences, before.occurrences);
});

test("K. occurrence conflict rolls back", async () => {
  const { result, db, before } = await runAppend({
    extraArgs: ["--apply"],
    afterPreflight: (memory) => {
      const inserted = insertConceptOccurrence(
        {
          id: "occ-conflict",
          conceptId: HUMAN_ID,
          sessionId: ELIGIBLE,
          messageId: `${ELIGIBLE}-u`,
          evidenceRef: "M001:E01",
          occurredAt: "1999-01-01T00:00:00.000Z",
          sourceRole: "user",
          sourceType: "evidence_unit",
          extractionVersion: CONCEPT_EXTRACTION_VERSION,
        },
        memory,
      );
      assert.equal(inserted.status, "inserted");
    },
  });
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(
    result.result.classification,
    REAL_EXISTING_MATCH_APPEND_FAILED_ROLLED_BACK,
  );
  assert.equal(result.result.transactionCommitted, false);
  assert.equal(result.result.conflicts, 1);
  assert.equal(counts(db).occurrences, before.occurrences + 1);
});

test("L. occurredAt is preserved from Frozen Intent", async () => {
  const { result, db } = await runAppend({ extraArgs: ["--apply"] });
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  const row = findExistingMatchOccurrenceByIdentity(db, exactPlan());
  assert.ok(row);
  assert.equal(row.occurredAt, OCCURRED_AT);
  assert.notEqual(row.occurredAt, SESSION_OCCURRED_AT);
  assert.deepEqual(result.result.occurredAtValues, [OCCURRED_AT]);
});

test("M. Concept and Alias counts stay unchanged", async () => {
  const { result, db, before } = await runAppend({ extraArgs: ["--apply"] });
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(countConcepts(db), before.concepts);
  assert.equal(countConceptAliases(db), before.aliases);
  assert.equal(result.result.db.before.concepts, result.result.db.after.concepts);
  assert.equal(
    result.result.db.before.conceptAliases,
    result.result.db.after.conceptAliases,
  );
});

test("N. post-write verification matches Intent provenance", async () => {
  const { result, db } = await runAppend({ extraArgs: ["--apply"] });
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(result.result.postWriteVerified, true);
  const row = findExistingMatchOccurrenceByIdentity(db, exactPlan());
  assert.ok(row);
  assert.equal(row.conceptId, HUMAN_ID);
  assert.equal(row.sessionId, ELIGIBLE);
  assert.equal(row.messageId, `${ELIGIBLE}-u`);
  assert.equal(row.evidenceRef, "M001:E01");
  assert.equal(row.occurredAt, OCCURRED_AT);
  assert.equal(row.sourceRole, "user");
  assert.equal(row.sourceType, "evidence_unit");
  assert.equal(row.extractionVersion, CONCEPT_EXTRACTION_VERSION);
  const concept = db
    .select()
    .from(schema.concepts)
    .where(eq(schema.concepts.id, HUMAN_ID))
    .get();
  assert.equal(concept?.canonicalLabel, SURFACE);
  assert.equal(concept?.normalizedKey, SURFACE);
});

test("O. Result serialization omits USER body / surfaceForm / raw LLM", async () => {
  const { result, written } = await runAppend({ extraArgs: ["--apply"] });
  assert.equal(result.ok, true);
  const serialized = JSON.stringify(written);
  assert.doesNotMatch(serialized, /"surfaceForm":/);
  assert.equal(serialized.includes(USER_A), false);
  assert.equal(serialized.includes(ASSISTANT), false);
  assert.equal(serialized.includes("SECRET_USER_BODY"), false);
  assert.doesNotMatch(serialized, /"parsed":/);
  assert.doesNotMatch(serialized, /"rawContent":/);
});

test("P. result write failure after commit does not re-apply", async () => {
  const { result, db, before } = await runAppend({
    extraArgs: ["--apply"],
    writeResult: () => {
      throw new Error("disk full");
    },
  });
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(
    result.result.classification,
    REAL_EXISTING_MATCH_APPENDED_REPORT_FAILED,
  );
  assert.equal(result.result.transactionCommitted, true);
  assert.equal(result.result.postWriteVerified, true);
  assert.equal(result.result.occurrencesCreated, 1);
  assert.equal(counts(db).occurrences, before.occurrences + 1);
  assert.match(result.summary, /Do not --apply again/);
});

test("prompt version mismatch writes nothing", async () => {
  const { result, opened, db, before } = await runAppend({
    extraArgs: ["--apply"],
    intentText: intentJson([exactPlan()], {
      promptVersion: CONCEPT_EXTRACT_PROMPT_V3,
    }).text,
  });
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(opened, false);
  assert.equal(result.result.transactionStarted, false);
  assert.equal(result.result.preflight.blockers[0]?.code, "source_integrity");
  assert.deepEqual(counts(db), before);
});

test("malformed options do not open DB", async () => {
  const db = openMemoryDb();
  seedBase(db);
  const before = counts(db);
  let opened = false;
  const result = await runConceptIncrementalExistingAppend(["--apply"], {
    openDb: () => {
      opened = true;
      return db;
    },
  });
  assert.equal(result.ok, false);
  assert.equal(opened, false);
  assert.deepEqual(counts(db), before);
});

test("source wiring: Frozen Intent plans + applyExistingMatchOccurrences; no LLM", () => {
  const sources = [
    "lib/concepts/incremental/existing-append.ts",
    "scripts/concept-incremental-existing-append.ts",
  ].map((path) => readFileSync(resolve(process.cwd(), path), "utf8"));
  const lib = sources[0]!;
  const cli = sources[1]!;
  assert.match(lib, /loadExistingMatchAppendIntent/);
  assert.match(lib, /intentToExistingMatchPlans/);
  assert.match(lib, /runExistingMatchOccurrencePreflight/);
  assert.match(lib, /applyExistingMatchOccurrences/);
  assert.match(lib, /evaluateIncrementalSessionEligibility/);
  assert.match(lib, /loadInitialConceptProcessingCoverage/);
  assert.match(cli, /openWritableApplyDb/);
  assert.match(cli, /--apply/);
  assert.match(cli, /defaultOpenReadonlyIncrementalPilotDb/);
  for (const source of sources) {
    assert.doesNotMatch(source, /getAiProvider/);
    assert.doesNotMatch(source, /createProductionIncrementalCandidateExtractor/);
    assert.doesNotMatch(source, /planEligibleIncrementalSession/);
    assert.doesNotMatch(source, /planIncrementalSession/);
    assert.doesNotMatch(source, /runExistingMatchOccurrenceAppend/);
    assert.doesNotMatch(source, /insertConcept\(/);
    assert.doesNotMatch(source, /insertConceptAlias/);
    assert.doesNotMatch(source, /from "openai"/);
    assert.doesNotMatch(source, /named_or_high/);
    assert.doesNotMatch(source, /evaluatePolicyCalibration/);
    assert.doesNotMatch(source, /a3dadb34c513a9808466db6e575196c304c5ca7ea816cceb033422f9acc5d24e/);
    assert.doesNotMatch(source, /102a1678-dbe6-47a3-a064-a8b898425b06/);
  }
});
