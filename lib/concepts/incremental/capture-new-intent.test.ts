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
  insertConceptOccurrence,
} from "@/lib/db/concept-queries";
import * as schema from "@/lib/db/schema";
import {
  CONCEPT_INCREMENTAL_NEW_ASSESSMENT_INTENT_DEFAULT_PATH,
  intentToNewCandidatePlans,
  loadNewAssessmentIntent,
} from "./new-assessment-intent";
import type { NewAssessmentIntent } from "./new-assessment-intent";
import {
  CONCEPT_INCREMENTAL_NEW_CAPTURE_APPLY_ERROR,
  CONCEPT_INCREMENTAL_NEW_CAPTURE_DEFAULT_DIAGNOSTIC,
  NEW_ASSESSMENT_INTENT_TARGET_EXISTS,
  parseConceptIncrementalCaptureNewIntentArgs,
  REAL_FROZEN_NEW_ASSESSMENT_ALL_GROUNDING_REJECTED,
  REAL_FROZEN_NEW_ASSESSMENT_INTENT_BLOCKED,
  REAL_FROZEN_NEW_ASSESSMENT_INTENT_READY,
  REAL_FROZEN_NEW_ASSESSMENT_NO_NEW_CANDIDATES,
  runConceptIncrementalCaptureNewIntent,
} from "./capture-new-intent";

const COVERED = "session-covered";
const ELIGIBLE = "session-eligible";
const HUMAN_ID = "concept-human-relations";
const USER_A =
  "SECRET_USER_BODY_NEW_CAPTURE_これまでの人間関係でなぜ上手くいかないのか理解できないと思った。";
const USER_MIXED =
  "SECRET_USER_BODY_NEW_CAPTURE_人間関係と寂しさと統合支援ツールについて同じ文で考えています。";
const ASSISTANT = "SECRET_ASSISTANT_BODY_NEW_CAPTURE_了解しました。";

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
  writeIntent?: (path: string, intent: NewAssessmentIntent) => void;
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
  const intents = new Map<string, NewAssessmentIntent>();
  const result = await runConceptIncrementalCaptureNewIntent(
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
  assert.equal(parseConceptIncrementalCaptureNewIntentArgs([]).malformed, true);
  assert.equal(
    parseConceptIncrementalCaptureNewIntentArgs(["--session", ELIGIBLE])
      .sessionId,
    ELIGIBLE,
  );
  assert.equal(
    parseConceptIncrementalCaptureNewIntentArgs([
      "--apply",
      "--session",
      ELIGIBLE,
    ]).apply,
    true,
  );
  assert.equal(
    parseConceptIncrementalCaptureNewIntentArgs([
      "--replace",
      "--session",
      ELIGIBLE,
    ]).malformedReason,
    "replace_not_supported",
  );
  assert.equal(
    parseConceptIncrementalCaptureNewIntentArgs([
      "--session",
      ELIGIBLE,
      "--session",
      COVERED,
    ]).malformed,
    true,
  );
  const parsed = parseConceptIncrementalCaptureNewIntentArgs([
    "--session",
    ELIGIBLE,
  ]);
  assert.equal(
    parsed.intentPath,
    CONCEPT_INCREMENTAL_NEW_ASSESSMENT_INTENT_DEFAULT_PATH,
  );
  assert.equal(
    parsed.diagnosticPath,
    CONCEPT_INCREMENTAL_NEW_CAPTURE_DEFAULT_DIAGNOSTIC,
  );
});

test("A. planned + NEW → Intent", async () => {
  await withExtractEnv(async () => {
    const db = openMemoryDb();
    seedBase(db, USER_MIXED);
    const before = counts(db);
    const { result, generateStructuredCalls, intents } = await runCapture(db, {
      generateStructured: async (request) => ({
        parsed: extractConcepts(request.user, [
          { action: "new", surfaceForm: "寂しさ" },
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
      REAL_FROZEN_NEW_ASSESSMENT_INTENT_READY,
    );
    assert.equal(result.report.newCount, 1);
    assert.equal(result.report.intentWritten, true);
    assert.equal(result.report.intentVerified, true);
    assert.equal(result.report.frozenCandidateCount, 1);
    assert.equal(generateStructuredCalls >= 1, true);
    const stored = [...intents.values()][0];
    assert.ok(stored);
    assert.equal(stored.candidates[0]?.kind, "new");
    assert.equal(stored.candidates[0]?.provenance.surfaceForm, "寂しさ");
    assert.deepEqual(counts(db), before);
  });
});

test("B. planned + multiple NEW freeze all", async () => {
  await withExtractEnv(async () => {
    const db = openMemoryDb();
    seedBase(db, USER_MIXED);
    const { result, intents } = await runCapture(db, {
      generateStructured: async (request) => ({
        parsed: extractConcepts(request.user, [
          { action: "new", surfaceForm: "寂しさ" },
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
      REAL_FROZEN_NEW_ASSESSMENT_INTENT_READY,
    );
    assert.equal(result.report.newCount, 2);
    const stored = [...intents.values()][0];
    assert.equal(stored?.candidates.length, 2);
    assert.deepEqual(
      stored?.candidates.map((item) => item.provenance.surfaceForm),
      ["寂しさ", "統合支援ツール"],
    );
  });
});

test("C. existing + NEW excludes existing", async () => {
  await withExtractEnv(async () => {
    const db = openMemoryDb();
    seedBase(db, USER_MIXED);
    const { result, intents } = await runCapture(db, {
      generateStructured: async (request) => ({
        parsed: extractConcepts(request.user, [
          { action: "new", surfaceForm: "人間関係" },
          { action: "new", surfaceForm: "寂しさ" },
        ]),
        model: request.model,
      }),
    });
    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }
    assert.equal(result.report.existingMatchCount, 1);
    assert.equal(result.report.newCount, 1);
    const stored = [...intents.values()][0];
    assert.equal(stored?.candidates.length, 1);
    assert.equal(stored?.candidates[0]?.kind, "new");
    assert.equal(stored?.candidates[0]?.provenance.surfaceForm, "寂しさ");
    assert.equal(JSON.stringify(stored).includes("existing_match"), false);
  });
});

test("D. NEW + provisional excludes provisional", async () => {
  await withExtractEnv(async () => {
    const db = openMemoryDb();
    seedBase(db, USER_MIXED);
    const { result, intents } = await runCapture(db, {
      generateStructured: async (request) => ({
        parsed: extractConcepts(request.user, [
          { action: "new", surfaceForm: "寂しさ" },
          {
            action: "match",
            surfaceForm: "統合支援ツール",
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
    assert.equal(result.report.newCount, 1);
    assert.equal(result.report.provisionalNewCount, 1);
    const stored = [...intents.values()][0];
    assert.equal(stored?.candidates.length, 1);
    assert.equal(stored?.candidates[0]?.kind, "new");
    assert.equal(JSON.stringify(stored).includes("provisional_new"), false);
  });
});

test("E. provisional-only → NO_NEW_CANDIDATES", async () => {
  await withExtractEnv(async () => {
    const db = openMemoryDb();
    seedBase(db, USER_MIXED);
    const { result, intents } = await runCapture(db, {
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
      REAL_FROZEN_NEW_ASSESSMENT_NO_NEW_CANDIDATES,
    );
    assert.equal(result.report.intentWritten, false);
    assert.equal(result.report.provisionalNewCount, 1);
    assert.equal(intents.size, 0);
  });
});

test("F. existing-only → NO_NEW_CANDIDATES", async () => {
  await withExtractEnv(async () => {
    const db = openMemoryDb();
    seedBase(db);
    const { result, intents } = await runCapture(db, {
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
      REAL_FROZEN_NEW_ASSESSMENT_NO_NEW_CANDIDATES,
    );
    assert.equal(result.report.existingMatchCount, 1);
    assert.equal(result.report.intentWritten, false);
    assert.equal(intents.size, 0);
  });
});

test("G. Grounding blocked → Intent none", async () => {
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
      REAL_FROZEN_NEW_ASSESSMENT_ALL_GROUNDING_REJECTED,
    );
    assert.equal(result.report.reason, "all_actions_grounding_rejected");
    assert.equal(result.report.intentWritten, false);
    assert.equal(result.report.groundingFailure?.code, "surface_not_in_unit");
    assert.equal(intents.size, 0);
  });
});

test("H. already covered → LLM 0", async () => {
  await withExtractEnv(async () => {
    const db = openMemoryDb();
    seedBase(db);
    const { result, generateStructuredCalls, intents } = await runCapture(db, {
      sessionId: COVERED,
    });
    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }
    assert.equal(
      result.report.classification,
      REAL_FROZEN_NEW_ASSESSMENT_INTENT_BLOCKED,
    );
    assert.equal(result.report.eligibility, "already_covered");
    assert.equal(generateStructuredCalls, 0);
    assert.equal(intents.size, 0);
  });
});

test("I. missing Session → LLM 0", async () => {
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
      REAL_FROZEN_NEW_ASSESSMENT_INTENT_BLOCKED,
    );
    assert.equal(result.report.reason, "missing_session");
    assert.equal(generateStructuredCalls, 0);
  });
});

test("J. target exists → no overwrite, LLM 0", async () => {
  await withExtractEnv(async () => {
    const db = openMemoryDb();
    seedBase(db);
    let opened = false;
    let llmCalls = 0;
    let wroteIntent = false;
    const original = '{"keep":"me"}';
    const dir = mkdtempSync(join(tmpdir(), "capture-new-intent-exists-"));
    const intentPath = join(dir, "intent.json");
    writeFileSync(intentPath, original, "utf8");
    const result = await runConceptIncrementalCaptureNewIntent(
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
      REAL_FROZEN_NEW_ASSESSMENT_INTENT_BLOCKED,
    );
    assert.equal(result.report.reason, NEW_ASSESSMENT_INTENT_TARGET_EXISTS);
    assert.equal(result.report.generateStructuredCalls, 0);
    assert.equal(opened, false);
    assert.equal(llmCalls, 0);
    assert.equal(wroteIntent, false);
    assert.equal(readFileSync(intentPath, "utf8"), original);
  });
});

test("K. surfaceForm freeze matches in-memory NEW plan", async () => {
  await withExtractEnv(async () => {
    const db = openMemoryDb();
    seedBase(db, USER_MIXED);
    const { result, intents } = await runCapture(db, {
      generateStructured: async (request) => ({
        parsed: extractConcepts(request.user, [
          { action: "new", surfaceForm: "寂しさ" },
        ]),
        model: request.model,
      }),
    });
    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }
    const stored = [...intents.values()][0];
    const planned = result.report.plans.find((plan) => plan.kind === "new");
    assert.ok(stored);
    assert.ok(planned);
    assert.equal(stored.candidates[0]?.candidateRef, planned.candidateRef);
    assert.equal(stored.candidates[0]?.provenance.surfaceForm, "寂しさ");
    assert.equal(stored.candidates[0]?.provenance.evidenceRef, planned.evidenceRef);
  });
});

test("L. lossless replay equals original NEW plans", async () => {
  await withExtractEnv(async () => {
    const db = openMemoryDb();
    seedBase(db, USER_MIXED);
    const dir = mkdtempSync(join(tmpdir(), "capture-new-intent-replay-"));
    const intentPath = join(dir, "intent.json");
    const { result } = await runCapture(db, {
      extraArgs: ["--intent", intentPath],
      generateStructured: async (request) => ({
        parsed: extractConcepts(request.user, [
          { action: "new", surfaceForm: "寂しさ" },
          { action: "new", surfaceForm: "統合支援ツール" },
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
    const loaded = loadNewAssessmentIntent(readFileSync(intentPath, "utf8"));
    assert.equal(loaded.ok, true);
    if (!loaded.ok) {
      return;
    }
    const replayed = intentToNewCandidatePlans(loaded.intent);
    assert.deepEqual(replayed, loaded.intent.candidates);
    assert.equal(replayed.length, 2);
  });
});

test("M. safe diagnostic has no USER / surfaceForm / raw LLM", async () => {
  await withExtractEnv(async () => {
    const db = openMemoryDb();
    seedBase(db, USER_MIXED);
    const { result, diagnostic } = await runCapture(db, {
      generateStructured: async (request) => ({
        parsed: extractConcepts(request.user, [
          { action: "new", surfaceForm: "寂しさ" },
        ]),
        model: request.model,
      }),
    });
    assert.equal(result.ok, true);
    const serialized = JSON.stringify(diagnostic);
    assert.doesNotMatch(serialized, /"surfaceForm":/);
    assert.equal(serialized.includes(USER_MIXED), false);
    assert.equal(serialized.includes(ASSISTANT), false);
    assert.equal(serialized.includes("SECRET_USER_BODY"), false);
    assert.doesNotMatch(serialized, /"parsed":/);
    assert.doesNotMatch(serialized, /"rawContent":/);
  });
});

test("N. DB mutation zero", async () => {
  await withExtractEnv(async () => {
    const db = openMemoryDb();
    seedBase(db, USER_MIXED);
    const before = counts(db);
    const { result } = await runCapture(db, {
      generateStructured: async (request) => ({
        parsed: extractConcepts(request.user, [
          { action: "new", surfaceForm: "寂しさ" },
        ]),
        model: request.model,
      }),
    });
    assert.equal(result.ok, true);
    assert.deepEqual(counts(db), before);
  });
});

test("3C-3b1 K. mixed plans freeze NEW only after selective reject", async () => {
  await withExtractEnv(async () => {
    const db = openMemoryDb();
    seedBase(db, USER_MIXED);
    const { result, intents } = await runCapture(db, {
      generateStructured: async (request) => ({
        parsed: extractConcepts(request.user, [
          { action: "new", surfaceForm: "人間関係" },
          { action: "new", surfaceForm: "存在しない表層XYZ" },
          { action: "new", surfaceForm: "寂しさ" },
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
      REAL_FROZEN_NEW_ASSESSMENT_INTENT_READY,
    );
    assert.equal(result.report.actionsEnteringGrounding, 3);
    assert.equal(result.report.groundedActions, 2);
    assert.equal(result.report.groundingRejectedCount, 1);
    assert.equal(result.report.existingMatchCount, 1);
    assert.equal(result.report.newCount, 1);
    assert.equal(result.report.provisionalNewCount, 0);
    const stored = [...intents.values()][0];
    assert.equal(stored?.candidates.length, 1);
    assert.equal(stored?.candidates[0]?.kind, "new");
    assert.equal(stored?.candidates[0]?.provenance.surfaceForm, "寂しさ");
    const serialized = JSON.stringify(stored);
    assert.equal(serialized.includes("存在しない表層XYZ"), false);
    assert.equal(serialized.includes("provisional_new"), false);
    assert.equal(serialized.includes("existing_match"), false);
  });
});

test("3C-3b1 L. rejected surface is not frozen into Intent", async () => {
  await withExtractEnv(async () => {
    const db = openMemoryDb();
    seedBase(db, USER_MIXED);
    const { result, intents, diagnostic } = await runCapture(db, {
      generateStructured: async (request) => ({
        parsed: extractConcepts(request.user, [
          { action: "new", surfaceForm: "寂しさ" },
          { action: "new", surfaceForm: "存在しない表層XYZ" },
        ]),
        model: request.model,
      }),
    });
    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }
    const stored = [...intents.values()][0];
    assert.ok(stored);
    assert.equal(
      stored.candidates.some(
        (item) => item.provenance.surfaceForm === "存在しない表層XYZ",
      ),
      false,
    );
    const diagnosticText = JSON.stringify(diagnostic);
    assert.equal(diagnosticText.includes("存在しない表層XYZ"), false);
    assert.doesNotMatch(diagnosticText, /"surfaceForm":/);
    assert.equal(result.report.groundingRejectedCount, 1);
  });
});

test("O. Assessment / Policy / Existing append / --apply LLM 0", async () => {
  await withExtractEnv(async () => {
    const db = openMemoryDb();
    seedBase(db);
    const before = counts(db);
    let opened = false;
    let llmCalls = 0;
    const applyResult = await runConceptIncrementalCaptureNewIntent(
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
      assert.equal(applyResult.error, CONCEPT_INCREMENTAL_NEW_CAPTURE_APPLY_ERROR);
    }
    assert.equal(opened, false);
    assert.equal(llmCalls, 0);
    assert.deepEqual(counts(db), before);
  });

  const sources = [
    "lib/concepts/incremental/capture-new-intent.ts",
    "scripts/concept-incremental-capture-new-intent.ts",
  ].map((path) => readFileSync(resolve(process.cwd(), path), "utf8"));
  const lib = sources[0]!;
  const cli = sources[1]!;
  assert.match(lib, /planEligibleIncrementalSession/);
  assert.match(lib, /createProductionIncrementalCandidateExtractor/);
  assert.match(lib, /newCandidatePlansFromGatedResult/);
  assert.match(lib, /freezeNewAssessmentIntent/);
  assert.match(lib, /loadNewAssessmentIntent/);
  assert.match(lib, /intentToNewCandidatePlans/);
  assert.match(cli, /defaultOpenReadonlyIncrementalPilotDb/);
  for (const source of sources) {
    assert.doesNotMatch(source, /buildExistingMatchAppendIntent/);
    assert.doesNotMatch(source, /runExistingMatchOccurrencePreflight/);
    assert.doesNotMatch(source, /applyExistingMatchOccurrences/);
    assert.doesNotMatch(source, /runConceptAssessment/);
    assert.doesNotMatch(source, /named_or_high/);
    assert.doesNotMatch(source, /evaluatePolicyCalibration/);
    assert.doesNotMatch(source, /102a1678-dbe6-47a3-a064-a8b898425b06/);
    assert.doesNotMatch(source, /insertConcept\(/);
  }
  assert.doesNotMatch(lib, /getAiProvider/);
  assert.doesNotMatch(lib, /from "openai"/);
});
