import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type { ConceptExtractOutput } from "@/lib/ai/concept-extract-schema";
import { CONCEPT_EXTRACT_PROMPT_VERSION } from "@/lib/ai/prompts/concept-extract";
import type { StructuredGenerateRequest } from "@/lib/ai/provider";
import { hashSourceArtifactText } from "@/lib/concepts/admission/apply-manifest";
import { CONCEPT_EXTRACTION_VERSION } from "@/lib/concepts/types";
import { applySqlMigrations } from "@/lib/db/client";
import {
  countConceptAliases,
  countConceptOccurrences,
  countConcepts,
  insertConcept,
  insertConceptAlias,
  insertConceptOccurrence,
} from "@/lib/db/concept-queries";
import * as schema from "@/lib/db/schema";
import type { ExistingMatchAppendIntent } from "./append-intent";
import {
  CONCEPT_INCREMENTAL_EXISTING_APPEND_INTENT_DEFAULT_PATH,
  intentToExistingMatchPlans,
  loadExistingMatchAppendIntent,
} from "./append-intent";
import {
  CONCEPT_INCREMENTAL_CAPTURE_APPLY_ERROR,
  CONCEPT_INCREMENTAL_CAPTURE_DEFAULT_DIAGNOSTIC,
  parseConceptIncrementalCaptureArgs,
  REAL_FROZEN_EXISTING_MATCH_GROUNDING_BLOCKED,
  REAL_FROZEN_EXISTING_MATCH_INTENT_BLOCKED,
  REAL_FROZEN_EXISTING_MATCH_INTENT_READY,
  REAL_FROZEN_EXISTING_MATCH_NO_MATCHES,
  runConceptIncrementalCaptureIntent,
} from "./capture-intent";
import { CONCEPT_INCREMENTAL_LLM_PILOT_DEFAULT_OUTPUT } from "./llm-pilot";

const COVERED = "session-covered";
const ELIGIBLE = "session-eligible";
const HUMAN_ID = "concept-human-relations";
const USER_A =
  "SECRET_USER_BODY_CAPTURE_これまでの人間関係でなぜ上手くいかないのか理解できないと思った。";
const USER_ALIAS =
  "SECRET_USER_BODY_CAPTURE_対人関係について同じ文で考えています。";
const USER_MIXED =
  "SECRET_USER_BODY_CAPTURE_人間関係と寂しさと統合支援ツールについて同じ文で考えています。";
const ASSISTANT = "SECRET_ASSISTANT_BODY_CAPTURE_了解しました。";

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
      sourceCreatedAt: "2026-07-15T12:00:00.000Z",
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
      sourceCreatedAt: "2026-07-15T12:00:00.000Z",
      contentType: "text",
      attachmentsJson: null,
    })
    .run();
}

function seedBase(
  db: ReturnType<typeof openMemoryDb>,
  eligibleContent = USER_A,
) {
  seedSession(db, COVERED, USER_A);
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

function skipAllFromPrompt(user: string): ConceptExtractOutput {
  const refs = [
    ...new Set([...user.matchAll(/M\d{3}:E\d{2}/g)].map((match) => match[0])),
  ];
  return {
    units: refs.map((evidenceRef) => ({
      evidenceRef,
      disposition: "skip" as const,
      concepts: [],
    })),
  };
}

function extractConcepts(
  user: string,
  concepts: ConceptExtractOutput["units"][number]["concepts"],
): ConceptExtractOutput {
  const output = skipAllFromPrompt(user);
  const first = output.units[0];
  if (first && concepts.length > 0) {
    first.disposition = "extracted";
    first.concepts = concepts;
  }
  return output;
}

type RunOverrides = {
  sessionId?: string;
  extraArgs?: string[];
  eligibleContent?: string;
  generateStructured?: (
    request: StructuredGenerateRequest,
  ) => Promise<{ parsed: unknown; model: string }>;
  intentTargetExists?: (path: string) => boolean;
  writeIntent?: (path: string, intent: ExistingMatchAppendIntent) => void;
  readIntentFile?: (path: string) => string;
  writeDiagnostic?: (path: string, payload: unknown) => void;
};

async function runCapture(
  db: ReturnType<typeof openMemoryDb>,
  overrides: RunOverrides = {},
) {
  const candidateText = candidateReportText([COVERED]);
  let generateStructuredCalls = 0;
  const inner =
    overrides.generateStructured ??
    (async (request: StructuredGenerateRequest) => ({
      parsed: skipAllFromPrompt(request.user),
      model: request.model,
    }));
  const generateStructured = async (request: StructuredGenerateRequest) => {
    generateStructuredCalls += 1;
    return inner(request);
  };
  let diagnostic: unknown = null;
  const intents = new Map<string, ExistingMatchAppendIntent>();
  const result = await runConceptIncrementalCaptureIntent(
    [
      "--session",
      overrides.sessionId ?? ELIGIBLE,
      ...(overrides.extraArgs ?? []),
    ],
    {
      openDb: () => db,
      generateStructured,
      readFile: (path) => {
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
      writeDiagnostic:
        overrides.writeDiagnostic ??
        ((_path, payload) => {
          diagnostic = payload;
        }),
      intentTargetExists: overrides.intentTargetExists ?? (() => false),
      writeIntent:
        "writeIntent" in overrides
          ? overrides.writeIntent
          : ((path, intent) => {
              intents.set(path, intent);
            }),
      readIntentFile:
        "readIntentFile" in overrides
          ? overrides.readIntentFile
          : ((path) => {
              const stored = intents.get(path);
              if (!stored) {
                throw new Error(`intent not written: ${path}`);
              }
              return JSON.stringify(stored);
            }),
      now: () => "2026-08-22T00:00:00.000Z",
      model: "test-model",
    },
  );
  return {
    result,
    generateStructuredCalls,
    candidateText,
    diagnostic,
    intents,
  };
}

test("parse requires one --session and rejects --apply / --replace", () => {
  assert.equal(parseConceptIncrementalCaptureArgs([]).malformed, true);
  assert.equal(
    parseConceptIncrementalCaptureArgs(["--session", ELIGIBLE]).sessionId,
    ELIGIBLE,
  );
  assert.equal(
    parseConceptIncrementalCaptureArgs(["--apply", "--session", ELIGIBLE])
      .apply,
    true,
  );
  assert.equal(
    parseConceptIncrementalCaptureArgs(["--replace", "--session", ELIGIBLE])
      .malformedReason,
    "replace_not_supported",
  );
  assert.equal(
    parseConceptIncrementalCaptureArgs([
      "--session",
      ELIGIBLE,
      "--session",
      COVERED,
    ]).malformed,
    true,
  );
  const parsed = parseConceptIncrementalCaptureArgs(["--session", ELIGIBLE]);
  assert.equal(
    parsed.intentPath,
    CONCEPT_INCREMENTAL_EXISTING_APPEND_INTENT_DEFAULT_PATH,
  );
  assert.equal(
    parsed.diagnosticPath,
    CONCEPT_INCREMENTAL_CAPTURE_DEFAULT_DIAGNOSTIC,
  );
  assert.notEqual(
    parsed.diagnosticPath,
    CONCEPT_INCREMENTAL_LLM_PILOT_DEFAULT_OUTPUT,
  );
});

test("A. planned + exact existing → Intent, surfaceForm freeze, replay", async () => {
  await withExtractEnv(async () => {
    const db = openMemoryDb();
    seedBase(db);
    const before = counts(db);
    const { result, generateStructuredCalls, candidateText, intents } =
      await runCapture(db, {
        generateStructured: async (request) => ({
          parsed: extractConcepts(request.user, [
            { action: "new", surfaceForm: "人間関係" },
          ]),
          model: request.model,
        }),
      });
    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }
    assert.equal(
      result.report.classification,
      REAL_FROZEN_EXISTING_MATCH_INTENT_READY,
    );
    assert.equal(result.report.eligibility, "eligible");
    assert.equal(result.report.existingMatchCount, 1);
    assert.equal(result.report.exactCanonicalCount, 1);
    assert.equal(result.report.intentWritten, true);
    assert.equal(result.report.intentVerified, true);
    assert.equal(result.report.providerStructuredActions, 1);
    assert.equal(result.report.adapterActions, 1);
    assert.equal(result.report.actionsEnteringGrounding, 1);
    assert.equal(result.report.groundedCandidates, 1);
    assert.equal(result.report.groundingFailure, null);
    assert.equal(generateStructuredCalls >= 1, true);
    const stored = [...intents.values()][0];
    assert.ok(stored);
    assert.equal(stored.plans[0]?.provenance.surfaceForm, "人間関係");
    assert.equal(stored.metadata.source.model, "test-model");
    assert.equal(
      stored.metadata.source.promptVersion,
      CONCEPT_EXTRACT_PROMPT_VERSION,
    );
    assert.equal(
      stored.metadata.source.extractionVersion,
      CONCEPT_EXTRACTION_VERSION,
    );
    assert.equal(
      stored.metadata.source.coverageSourceHash,
      hashSourceArtifactText(candidateText),
    );
    const loaded = loadExistingMatchAppendIntent(JSON.stringify(stored));
    assert.equal(loaded.ok, true);
    if (loaded.ok) {
      assert.deepEqual(
        intentToExistingMatchPlans(loaded.intent),
        stored.plans,
      );
    }
    assert.deepEqual(counts(db), before);
  });
});

test("B. planned + unique alias → Intent", async () => {
  await withExtractEnv(async () => {
    const db = openMemoryDb();
    seedBase(db, USER_ALIAS);
    insertConceptAlias({ conceptId: HUMAN_ID, aliasLabel: "対人関係" }, db);
    const before = counts(db);
    const { result, intents } = await runCapture(db, {
      generateStructured: async (request) => ({
        parsed: extractConcepts(request.user, [
          { action: "new", surfaceForm: "対人関係" },
        ]),
        model: request.model,
      }),
    });
    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }
    assert.equal(
      result.report.classification,
      REAL_FROZEN_EXISTING_MATCH_INTENT_READY,
    );
    assert.equal(result.report.uniqueObservedAliasCount, 1);
    assert.equal(
      [...intents.values()][0]?.plans[0]?.provenance.surfaceForm,
      "対人関係",
    );
    assert.equal([...intents.values()][0]?.plans[0]?.matchReason, "unique_observed_alias");
    assert.deepEqual(counts(db), before);
  });
});

test("C. mixed existing + provisional → existing only freeze", async () => {
  await withExtractEnv(async () => {
    const db = openMemoryDb();
    seedBase(db, USER_MIXED);
    const { result, intents } = await runCapture(db, {
      generateStructured: async (request) => ({
        parsed: extractConcepts(request.user, [
          { action: "new", surfaceForm: "人間関係" },
          {
            action: "match",
            surfaceForm: "寂しさ",
            existingConceptRef: HUMAN_ID,
          },
        ]),
        model: request.model,
      }),
    });
    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }
    assert.equal(
      result.report.classification,
      REAL_FROZEN_EXISTING_MATCH_INTENT_READY,
    );
    assert.equal(result.report.existingMatchCount, 1);
    assert.equal(result.report.provisionalNewCount, 1);
    const intent = [...intents.values()][0];
    assert.ok(intent);
    assert.equal(intent.plans.length, 1);
    assert.equal(intent.plans[0]?.kind, "existing_match");
    assert.equal(
      intent.plans.some((plan) => plan.kind !== "existing_match"),
      false,
    );
    assert.equal(
      JSON.stringify(intent).includes("provisional_new"),
      false,
    );
  });
});

test("D. planned + new is excluded from Intent", async () => {
  await withExtractEnv(async () => {
    const db = openMemoryDb();
    seedBase(db, USER_MIXED);
    const { result, intents } = await runCapture(db, {
      generateStructured: async (request) => ({
        parsed: extractConcepts(request.user, [
          { action: "new", surfaceForm: "人間関係" },
          { action: "new", surfaceForm: "統合支援ツール" },
        ]),
        model: request.model,
      }),
    });
    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }
    assert.equal(
      result.report.classification,
      REAL_FROZEN_EXISTING_MATCH_INTENT_READY,
    );
    assert.equal(result.report.newCount, 1);
    assert.equal(result.report.existingMatchCount, 1);
    const intent = [...intents.values()][0];
    assert.equal(intent?.plans.length, 1);
    assert.equal(intent?.plans[0]?.provenance.surfaceForm, "人間関係");
    assert.equal(JSON.stringify(intent).includes("統合支援ツール"), false);
  });
});

test("E. no existing matches → NO_MATCHES, Intent none", async () => {
  await withExtractEnv(async () => {
    const db = openMemoryDb();
    seedBase(db, USER_MIXED);
    const { result, generateStructuredCalls, intents } = await runCapture(db, {
      generateStructured: async (request) => ({
        parsed: extractConcepts(request.user, [
          {
            action: "match",
            surfaceForm: "寂しさ",
            existingConceptRef: HUMAN_ID,
          },
        ]),
        model: request.model,
      }),
    });
    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }
    assert.equal(
      result.report.classification,
      REAL_FROZEN_EXISTING_MATCH_NO_MATCHES,
    );
    assert.equal(result.report.reason, "no_existing_matches");
    assert.equal(result.report.intentWritten, false);
    assert.equal(result.report.provisionalNewCount, 1);
    assert.equal(generateStructuredCalls >= 1, true);
    assert.equal(intents.size, 0);
  });
});

test("F. planning blocked → Intent none", async () => {
  await withExtractEnv(async () => {
    const db = openMemoryDb();
    seedBase(db);
    const { result, intents } = await runCapture(db, {
      generateStructured: async (request) => ({
        parsed: extractConcepts(request.user, [
          { action: "new", surfaceForm: "存在しない表層" },
        ]),
        model: request.model,
      }),
    });
    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }
    assert.equal(
      result.report.classification,
      REAL_FROZEN_EXISTING_MATCH_GROUNDING_BLOCKED,
    );
    assert.equal(result.report.stage, "planning");
    assert.equal(result.report.reason, "all_actions_grounding_rejected");
    assert.equal(result.report.intentWritten, false);
    assert.equal(result.report.providerStructuredActions, 1);
    assert.equal(result.report.adapterActions, 1);
    assert.equal(result.report.actionsEnteringGrounding, 1);
    assert.equal(result.report.groundedCandidates, 0);
    assert.equal(result.report.plansTotal, 0);
    assert.equal(result.report.groundingFailure?.code, "surface_not_in_unit");
    assert.equal(result.report.groundingFailure?.exactMatch, false);
    const serialized = JSON.stringify(result.report);
    assert.equal(serialized.includes("存在しない表層"), false);
    assert.doesNotMatch(serialized, /"surfaceForm":/);
    assert.equal(intents.size, 0);
  });
});

test("G. already covered → LLM 0, Intent none", async () => {
  await withExtractEnv(async () => {
    const db = openMemoryDb();
    seedBase(db);
    const before = counts(db);
    const { result, generateStructuredCalls, intents } = await runCapture(db, {
      sessionId: COVERED,
    });
    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }
    assert.equal(
      result.report.classification,
      REAL_FROZEN_EXISTING_MATCH_INTENT_BLOCKED,
    );
    assert.equal(result.report.eligibility, "already_covered");
    assert.equal(result.report.generateStructuredCalls, 0);
    assert.equal(generateStructuredCalls, 0);
    assert.equal(intents.size, 0);
    assert.deepEqual(counts(db), before);
  });
});

test("H. missing Session → LLM 0", async () => {
  await withExtractEnv(async () => {
    const db = openMemoryDb();
    seedBase(db);
    const { result, generateStructuredCalls } = await runCapture(db, {
      sessionId: "missing-session",
    });
    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }
    assert.equal(
      result.report.classification,
      REAL_FROZEN_EXISTING_MATCH_INTENT_BLOCKED,
    );
    assert.equal(result.report.reason, "missing_session");
    assert.equal(generateStructuredCalls, 0);
  });
});

test("I. existing target file is not overwritten; LLM 0", async () => {
  await withExtractEnv(async () => {
    const db = openMemoryDb();
    seedBase(db);
    let opened = false;
    let llmCalls = 0;
    let wroteIntent = false;
    const original = '{"keep":"me"}';
    const dir = mkdtempSync(join(tmpdir(), "capture-intent-exists-"));
    const intentPath = join(dir, "intent.json");
    writeFileSync(intentPath, original, "utf8");
    const result = await runConceptIncrementalCaptureIntent(
      ["--session", ELIGIBLE, "--intent", intentPath],
      {
        openDb: () => {
          opened = true;
          return db;
        },
        generateStructured: async () => {
          llmCalls += 1;
          throw new Error("should not call LLM");
        },
        writeDiagnostic: () => {},
        writeIntent: () => {
          wroteIntent = true;
        },
      },
    );
    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }
    assert.equal(
      result.report.classification,
      REAL_FROZEN_EXISTING_MATCH_INTENT_BLOCKED,
    );
    assert.equal(result.report.reason, "intent_target_exists");
    assert.equal(result.report.generateStructuredCalls, 0);
    assert.equal(opened, false);
    assert.equal(llmCalls, 0);
    assert.equal(wroteIntent, false);
    assert.equal(readFileSync(intentPath, "utf8"), original);
  });
});

test("J. write failure → blocked", async () => {
  await withExtractEnv(async () => {
    const db = openMemoryDb();
    seedBase(db);
    const { result } = await runCapture(db, {
      generateStructured: async (request) => ({
        parsed: extractConcepts(request.user, [
          { action: "new", surfaceForm: "人間関係" },
        ]),
        model: request.model,
      }),
      writeIntent: () => {
        throw new Error("disk full");
      },
    });
    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }
    assert.equal(
      result.report.classification,
      REAL_FROZEN_EXISTING_MATCH_INTENT_BLOCKED,
    );
    assert.equal(result.report.reason, "write_failed");
    assert.equal(result.report.intentWritten, false);
    assert.equal(result.report.intentVerified, false);
  });
});

test("K. reload / hash failure → blocked", async () => {
  await withExtractEnv(async () => {
    const db = openMemoryDb();
    seedBase(db);
    const { result } = await runCapture(db, {
      generateStructured: async (request) => ({
        parsed: extractConcepts(request.user, [
          { action: "new", surfaceForm: "人間関係" },
        ]),
        model: request.model,
      }),
      readIntentFile: () =>
        JSON.stringify({
          metadata: {
            version: "concept-incremental-existing-append-intent-v1",
            mode: "existing_match_append",
            sessionId: ELIGIBLE,
            source: {
              model: "test-model",
              promptVersion: CONCEPT_EXTRACT_PROMPT_VERSION,
              extractionVersion: CONCEPT_EXTRACTION_VERSION,
              coverageSourceHash: "tampered",
            },
            generatedAt: "2026-08-22T00:00:00.000Z",
            contentHash: "not-the-hash",
          },
          plans: [],
        }),
    });
    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }
    assert.equal(
      result.report.classification,
      REAL_FROZEN_EXISTING_MATCH_INTENT_BLOCKED,
    );
    assert.equal(result.report.intentWritten, true);
    assert.equal(result.report.intentVerified, false);
    assert.ok(
      result.report.reason === "content_hash" ||
        result.report.reason === "no_existing_matches" ||
        result.report.reason === "invalid_plan",
    );
  });
});

test("L. lossless replay of original existing plans via atomic file", async () => {
  await withExtractEnv(async () => {
    const db = openMemoryDb();
    seedBase(db);
    const dir = mkdtempSync(join(tmpdir(), "capture-intent-replay-"));
    const intentPath = join(dir, "intent.json");
    const { result } = await runCapture(db, {
      extraArgs: ["--intent", intentPath],
      generateStructured: async (request) => ({
        parsed: extractConcepts(request.user, [
          { action: "new", surfaceForm: "人間関係" },
        ]),
        model: request.model,
      }),
      writeIntent: undefined,
      readIntentFile: undefined,
    });
    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }
    assert.equal(
      result.report.classification,
      REAL_FROZEN_EXISTING_MATCH_INTENT_READY,
    );
    const loaded = loadExistingMatchAppendIntent(
      readFileSync(intentPath, "utf8"),
    );
    assert.equal(loaded.ok, true);
    if (!loaded.ok) {
      return;
    }
    const replayed = intentToExistingMatchPlans(loaded.intent);
    assert.equal(replayed.length, 1);
    assert.equal(replayed[0]?.provenance.surfaceForm, "人間関係");
    assert.deepEqual(replayed, loaded.intent.plans);
  });
});

test("M. diagnostic has no surfaceForm / USER full / raw LLM", async () => {
  await withExtractEnv(async () => {
    const db = openMemoryDb();
    seedBase(db);
    let written: unknown = null;
    const { result } = await runCapture(db, {
      generateStructured: async (request) => ({
        parsed: extractConcepts(request.user, [
          { action: "new", surfaceForm: "人間関係" },
        ]),
        model: request.model,
      }),
      writeDiagnostic: (_path, payload) => {
        written = payload;
      },
    });
    assert.equal(result.ok, true);
    const serialized = JSON.stringify(written);
    assert.equal(serialized.includes(USER_A), false);
    assert.equal(serialized.includes(ASSISTANT), false);
    assert.equal(serialized.includes("SECRET_USER_BODY"), false);
    assert.doesNotMatch(serialized, /"surfaceForm":/);
    assert.doesNotMatch(serialized, /"canonicalLabel":/);
    assert.doesNotMatch(serialized, /"content":/);
    assert.doesNotMatch(serialized, /"rawContent":/);
    assert.doesNotMatch(serialized, /"parsed":/);
  });
});

test("N. DB mutation zero", async () => {
  await withExtractEnv(async () => {
    const db = openMemoryDb();
    seedBase(db, USER_MIXED);
    insertConceptAlias({ conceptId: HUMAN_ID, aliasLabel: "対人関係" }, db);
    const before = counts(db);
    await runCapture(db, {
      generateStructured: async (request) => ({
        parsed: extractConcepts(request.user, [
          { action: "new", surfaceForm: "人間関係" },
          { action: "new", surfaceForm: "統合支援ツール" },
          {
            action: "match",
            surfaceForm: "寂しさ",
            existingConceptRef: HUMAN_ID,
          },
        ]),
        model: request.model,
      }),
    });
    await runCapture(db, { sessionId: COVERED });
    await runCapture(db, { sessionId: "missing-session" });
    assert.deepEqual(counts(db), before);
  });
});

test("O. semantic / provisional never frozen; --apply LLM 0", async () => {
  await withExtractEnv(async () => {
    const db = openMemoryDb();
    seedBase(db);
    const before = counts(db);
    let opened = false;
    let llmCalls = 0;
    const applyResult = await runConceptIncrementalCaptureIntent(
      ["--apply", "--session", ELIGIBLE],
      {
        openDb: () => {
          opened = true;
          return db;
        },
        generateStructured: async () => {
          llmCalls += 1;
          throw new Error("should not call LLM");
        },
      },
    );
    assert.equal(applyResult.ok, false);
    if (!applyResult.ok) {
      assert.equal(applyResult.code, "apply");
      assert.equal(applyResult.error, CONCEPT_INCREMENTAL_CAPTURE_APPLY_ERROR);
    }
    assert.equal(opened, false);
    assert.equal(llmCalls, 0);
    assert.deepEqual(counts(db), before);
  });
});

test("malformed CLI → LLM 0", async () => {
  await withExtractEnv(async () => {
    const db = openMemoryDb();
    seedBase(db);
    let opened = false;
    let llmCalls = 0;
    const missing = await runConceptIncrementalCaptureIntent([], {
      openDb: () => {
        opened = true;
        return db;
      },
      generateStructured: async () => {
        llmCalls += 1;
        throw new Error("should not call LLM");
      },
    });
    const multiple = await runConceptIncrementalCaptureIntent(
      ["--session", ELIGIBLE, "--session", COVERED],
      {
        openDb: () => {
          opened = true;
          return db;
        },
        generateStructured: async () => {
          llmCalls += 1;
          throw new Error("should not call LLM");
        },
      },
    );
    assert.equal(missing.ok, false);
    assert.equal(multiple.ok, false);
    assert.equal(opened, false);
    assert.equal(llmCalls, 0);
  });
});

test("runner uses gated planner / Frozen Intent APIs and does not append", () => {
  const sources = [
    "lib/concepts/incremental/capture-intent.ts",
    "scripts/concept-incremental-capture-intent.ts",
  ].map((path) => readFileSync(resolve(process.cwd(), path), "utf8"));
  const lib = sources[0]!;
  const cli = sources[1]!;
  assert.match(lib, /planEligibleIncrementalSession/);
  assert.match(lib, /createProductionIncrementalCandidateExtractor/);
  assert.match(lib, /existingMatchPlansFromGatedResult/);
  assert.match(lib, /freezeExistingMatchAppendIntent/);
  assert.match(lib, /loadExistingMatchAppendIntent/);
  assert.match(lib, /intentToExistingMatchPlans/);
  assert.match(lib, /loadInitialConceptProcessingCoverage/);
  assert.match(cli, /defaultOpenReadonlyIncrementalPilotDb/);
  for (const source of sources) {
    assert.doesNotMatch(source, /runExistingMatchOccurrenceAppend/);
    assert.doesNotMatch(source, /runExistingMatchOccurrencePreflight/);
    assert.doesNotMatch(source, /applyExistingMatchOccurrences/);
    assert.doesNotMatch(source, /102a1678-dbe6-47a3-a064-a8b898425b06/);
    assert.doesNotMatch(source, /evaluatePolicyCalibration/);
    assert.doesNotMatch(source, /負の連鎖/);
    assert.doesNotMatch(source, /named_or_high/);
    assert.doesNotMatch(source, /concept-incremental-pilot-result-v1/);
  }
  assert.doesNotMatch(lib, /getAiProvider/);
  assert.doesNotMatch(lib, /from "openai"/);
  assert.doesNotMatch(lib, /createOpenAiProvider/);
});
