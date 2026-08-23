import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
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
  existingMatchAppendIntentContentHashPayload,
} from "./append-intent";
import { hashJsonContent } from "@/lib/concepts/admission/canonical-json";
import {
  CONCEPT_INCREMENTAL_EXISTING_PREFLIGHT_APPLY_ERROR,
  parseConceptIncrementalExistingPreflightArgs,
  REAL_EXISTING_MATCH_PREFLIGHT_BLOCKED,
  REAL_EXISTING_MATCH_PREFLIGHT_NO_OP,
  REAL_EXISTING_MATCH_PREFLIGHT_READY,
  runConceptIncrementalExistingPreflight,
} from "./existing-preflight";
import type { ExistingMatchPlan } from "./plan";

const COVERED = "session-covered";
const ELIGIBLE = "session-eligible";
const OTHER = "session-other";
const HUMAN_ID = "concept-human-relations";
const USER_A =
  "SECRET_USER_BODY_EXISTING_PREFLIGHT_これまでの人間関係でなぜ上手くいかないのか理解できないと思った。";
const ASSISTANT = "SECRET_ASSISTANT_BODY_EXISTING_PREFLIGHT_了解しました。";
const SURFACE = "人間関係";
const OCCURRED_AT = "2026-07-15T12:00:00.000Z";

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
      occurredAt: "2099-01-01",
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
};

async function runPreflight(overrides: RunOverrides = {}) {
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
          intent: null,
          candidateText,
        }
      : intentJson([overrides.plan ?? exactPlan()], {
          coverageSourceHash: hashSourceArtifactText(candidateText),
        });
  const before = counts(db);
  let opened = false;
  let diagnostic: unknown = null;
  const result = await runConceptIncrementalExistingPreflight(
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
      writeDiagnostic: (_path, payload) => {
        diagnostic = payload;
      },
      now: () => "2026-08-22T00:00:00.000Z",
    },
  );
  return { result, db, before, opened, diagnostic, candidateText };
}

test("parse requires --intent and rejects --apply", () => {
  assert.equal(parseConceptIncrementalExistingPreflightArgs([]).malformed, true);
  assert.equal(
    parseConceptIncrementalExistingPreflightArgs([
      "--intent",
      "data/concept-incremental-existing-append-intent-v1.json",
    ]).intentPath,
    "data/concept-incremental-existing-append-intent-v1.json",
  );
  assert.equal(
    parseConceptIncrementalExistingPreflightArgs([
      "--apply",
      "--intent",
      "x.json",
    ]).apply,
    true,
  );
  assert.equal(
    parseConceptIncrementalExistingPreflightArgs([
      "--intent",
      "a.json",
      "--intent",
      "b.json",
    ]).malformed,
    true,
  );
});

test("A. valid Intent → ready", async () => {
  const { result, before, db } = await runPreflight();
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(result.report.classification, REAL_EXISTING_MATCH_PREFLIGHT_READY);
  assert.equal(result.report.status, "ready");
  assert.equal(result.report.eligibility, "eligible");
  assert.equal(result.report.preflightExecuted, true);
  assert.equal(result.report.plansChecked, 1);
  assert.equal(result.report.predictedCreates >= 1, true);
  assert.equal(result.report.alreadyPresent, 0);
  assert.equal(result.report.conflicts, 0);
  assert.equal(result.report.generateStructuredCalls, 0);
  assert.deepEqual(counts(db), before);
});

test("B. valid Intent → no_op when occurrence already present", async () => {
  const { result, db, before } = await runPreflight({
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
  assert.equal(result.report.classification, REAL_EXISTING_MATCH_PREFLIGHT_NO_OP);
  assert.equal(result.report.status, "no_op");
  assert.equal(result.report.predictedCreates, 0);
  assert.equal(result.report.alreadyPresent, 1);
  assert.deepEqual(counts(db), before);
});

test("C. tampered Intent contentHash → blocked before preflight", async () => {
  const built = intentJson([exactPlan()]);
  const tampered = JSON.parse(built.text) as {
    metadata: { contentHash: string };
  };
  tampered.metadata.contentHash = "not-the-hash";
  const { result, opened } = await runPreflight({
    intentText: JSON.stringify(tampered),
    candidateText: built.candidateText,
  });
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(
    result.report.classification,
    REAL_EXISTING_MATCH_PREFLIGHT_BLOCKED,
  );
  assert.equal(result.report.blockers[0]?.code, "content_hash");
  assert.equal(result.report.preflightExecuted, false);
  assert.equal(opened, false);
});

test("D. source coverage hash mismatch → blocked", async () => {
  const candidateText = candidateReportText([COVERED]);
  const built = intentJson([exactPlan()], {
    coverageSourceHash: "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
  });
  const { result, opened } = await runPreflight({
    intentText: built.text,
    candidateText,
  });
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(
    result.report.classification,
    REAL_EXISTING_MATCH_PREFLIGHT_BLOCKED,
  );
  assert.equal(result.report.blockers[0]?.code, "coverage_source_mismatch");
  assert.equal(result.report.preflightExecuted, false);
  assert.equal(opened, false);
});

test("E. prompt / extraction version mismatch → blocked", async () => {
  const { result, opened } = await runPreflight({
    intentText: intentJson([exactPlan()], {
      promptVersion: CONCEPT_EXTRACT_PROMPT_V3,
    }).text,
  });
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(
    result.report.classification,
    REAL_EXISTING_MATCH_PREFLIGHT_BLOCKED,
  );
  assert.equal(result.report.blockers[0]?.code, "source_integrity");
  assert.equal(result.report.preflightExecuted, false);
  assert.equal(opened, false);
});

test("F. session invariant mismatch → blocked before preflight", async () => {
  const plan = exactPlan({
    provenance: {
      ...exactPlan().provenance,
      sessionId: OTHER,
    },
  });
  const payload = existingMatchAppendIntentContentHashPayload({
    sessionId: ELIGIBLE,
    source: {
      model: "gpt-4o",
      promptVersion: CONCEPT_EXTRACT_PROMPT_VERSION,
      extractionVersion: CONCEPT_EXTRACTION_VERSION,
      coverageSourceHash: hashSourceArtifactText(candidateReportText([COVERED])),
    },
    plans: [plan],
  });
  const text = JSON.stringify({
    metadata: {
      ...payload.metadata,
      generatedAt: "2026-08-22T00:00:00.000Z",
      contentHash: hashJsonContent(payload),
    },
    plans: payload.plans,
  });
  const { result, opened } = await runPreflight({ intentText: text });
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(
    result.report.classification,
    REAL_EXISTING_MATCH_PREFLIGHT_BLOCKED,
  );
  assert.equal(result.report.preflightExecuted, false);
  assert.equal(opened, false);
  assert.ok(
    result.report.blockers[0]?.code === "invalid_plan" ||
      result.report.blockers[0]?.code === "session_invariant",
  );
});

test("G. missing Concept → preflight blocked", async () => {
  const { result, opened, db, before } = await runPreflight({
    seed: (memory) => {
      seedSession(memory, COVERED, USER_A);
      seedSession(memory, ELIGIBLE, USER_A);
    },
  });
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(
    result.report.classification,
    REAL_EXISTING_MATCH_PREFLIGHT_BLOCKED,
  );
  assert.equal(result.report.preflightExecuted, true);
  assert.equal(opened, true);
  assert.equal(result.report.blockers[0]?.code, "missing_concept");
  assert.deepEqual(counts(db), before);
});

test("H. Concept identity changed → blocked", async () => {
  const { result } = await runPreflight({
    seed: (memory) => {
      seedSession(memory, COVERED, USER_A);
      seedSession(memory, ELIGIBLE, USER_A);
      insertConcept(
        {
          id: HUMAN_ID,
          canonicalLabel: "別ラベル",
          createdAt: "2026-08-18T00:00:00.000Z",
        },
        memory,
      );
    },
  });
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(
    result.report.classification,
    REAL_EXISTING_MATCH_PREFLIGHT_BLOCKED,
  );
  assert.equal(result.report.blockers[0]?.code, "identity_mismatch");
  assert.equal(result.report.preflightExecuted, true);
});

test("I. surfaceForm Identity mismatch → blocked", async () => {
  const { result } = await runPreflight({
    plan: exactPlan({
      provenance: {
        ...exactPlan().provenance,
        surfaceForm: "高性能AI",
      },
    }),
  });
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(
    result.report.classification,
    REAL_EXISTING_MATCH_PREFLIGHT_BLOCKED,
  );
  assert.equal(result.report.blockers[0]?.code, "identity_mismatch");
});

test("J. provenance mismatch → blocked", async () => {
  const { result } = await runPreflight({
    plan: exactPlan({
      provenance: {
        ...exactPlan().provenance,
        evidenceRef: "M099:E01",
      },
    }),
  });
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(
    result.report.classification,
    REAL_EXISTING_MATCH_PREFLIGHT_BLOCKED,
  );
  assert.ok(
    result.report.blockers[0]?.code === "evidence_ref_unresolved" ||
      result.report.blockers[0]?.code === "ref_not_in_batch",
  );
});

test("K. occurrence conflict → blocked", async () => {
  const { result } = await runPreflight({
    seed: (memory) => {
      seedBase(memory);
      const inserted = insertConceptOccurrence(
        {
          id: "occ-conflict",
          conceptId: HUMAN_ID,
          sessionId: ELIGIBLE,
          messageId: `${ELIGIBLE}-u`,
          evidenceRef: "M001:E01",
          occurredAt: "2019-01-01T00:00:00.000Z",
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
    result.report.classification,
    REAL_EXISTING_MATCH_PREFLIGHT_BLOCKED,
  );
  assert.equal(result.report.conflicts, 1);
  assert.equal(result.report.blockers[0]?.code, "occurrence_conflict");
});

test("L. no_op already present with immutable provenance", async () => {
  const { result } = await runPreflight({
    seed: (memory) => {
      seedBase(memory);
      insertConceptOccurrence(
        {
          id: "occ-present",
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
    },
  });
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(result.report.status, "no_op");
  assert.equal(result.report.plans[0]?.classification, "already_present");
});

test("M. --apply reject, write 0, LLM 0", async () => {
  const db = openMemoryDb();
  seedBase(db);
  const before = counts(db);
  let opened = false;
  const result = await runConceptIncrementalExistingPreflight(
    ["--apply", "--intent", "memory://intent.json"],
    {
      openDb: () => {
        opened = true;
        return db;
      },
      readFile: () => {
        throw new Error("should not read");
      },
    },
  );
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "apply");
    assert.equal(result.error, CONCEPT_INCREMENTAL_EXISTING_PREFLIGHT_APPLY_ERROR);
  }
  assert.equal(opened, false);
  assert.deepEqual(counts(db), before);
});

test("N. no LLM / planning / append dependency", () => {
  const sources = [
    "lib/concepts/incremental/existing-preflight.ts",
    "scripts/concept-incremental-existing-preflight.ts",
  ].map((path) => readFileSync(resolve(process.cwd(), path), "utf8"));
  const lib = sources[0]!;
  assert.match(lib, /loadExistingMatchAppendIntent/);
  assert.match(lib, /intentToExistingMatchPlans/);
  assert.match(lib, /runExistingMatchOccurrencePreflight/);
  assert.match(lib, /evaluateIncrementalSessionEligibility/);
  assert.match(lib, /loadInitialConceptProcessingCoverage/);
  for (const source of sources) {
    assert.doesNotMatch(source, /getAiProvider/);
    assert.doesNotMatch(source, /createProductionIncrementalCandidateExtractor/);
    assert.doesNotMatch(source, /planEligibleIncrementalSession/);
    assert.doesNotMatch(source, /planIncrementalSession/);
    assert.doesNotMatch(source, /runExistingMatchOccurrenceAppend/);
    assert.doesNotMatch(source, /applyExistingMatchOccurrences/);
    assert.doesNotMatch(source, /from "openai"/);
    assert.doesNotMatch(source, /named_or_high/);
    assert.doesNotMatch(source, /evaluatePolicyCalibration/);
    assert.doesNotMatch(source, /a3dadb34c513a9808466db6e575196c304c5ca7ea816cceb033422f9acc5d24e/);
    assert.doesNotMatch(source, /102a1678-dbe6-47a3-a064-a8b898425b06/);
  }
});

test("O. zero DB mutation", async () => {
  const { db, before, result } = await runPreflight();
  assert.equal(result.ok, true);
  assert.deepEqual(counts(db), before);
});

test("P. safe diagnostic report has no surfaceForm / USER / raw LLM", async () => {
  const { result, diagnostic } = await runPreflight();
  assert.equal(result.ok, true);
  const serialized = JSON.stringify(diagnostic);
  assert.doesNotMatch(serialized, /"surfaceForm":/);
  assert.equal(serialized.includes(USER_A), false);
  assert.equal(serialized.includes(ASSISTANT), false);
  assert.equal(serialized.includes("SECRET_USER_BODY"), false);
  assert.doesNotMatch(serialized, /"parsed":/);
  assert.doesNotMatch(serialized, /"rawContent":/);
});
