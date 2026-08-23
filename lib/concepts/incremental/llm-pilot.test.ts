import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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
  CONCEPT_INCREMENTAL_LLM_PILOT_APPLY_ERROR,
  parseConceptIncrementalLlmPilotArgs,
  runConceptIncrementalLlmPilot,
} from "./llm-pilot";

const COVERED = "session-covered";
const ELIGIBLE = "session-eligible";
const HUMAN_ID = "concept-human-relations";
const USER_A =
  "SECRET_USER_BODY_LLM_PILOT_これまでの人間関係でなぜ上手くいかないのか理解できないと思った。";
const USER_MIXED =
  "SECRET_USER_BODY_LLM_PILOT_人間関係と寂しさと統合支援ツールについて同じ文で考えています。";
const ASSISTANT = "SECRET_ASSISTANT_BODY_LLM_PILOT_了解しました。";

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

function seedBase(db: ReturnType<typeof openMemoryDb>, eligibleContent = USER_A) {
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

function extractOnFirst(
  user: string,
  concept: ConceptExtractOutput["units"][number]["concepts"][number],
): ConceptExtractOutput {
  const output = skipAllFromPrompt(user);
  const first = output.units[0];
  if (first) {
    first.disposition = "extracted";
    first.concepts = [concept];
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
};

async function runPilot(
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
  const result = await runConceptIncrementalLlmPilot(
    ["--session", overrides.sessionId ?? ELIGIBLE, ...(overrides.extraArgs ?? [])],
    {
      openDb: () => db,
      generateStructured,
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
      model: "test-model",
    },
  );
  return { result, generateStructuredCalls, candidateText };
}

test("A. explicit eligible Session reaches gated planning", async () => {
  await withExtractEnv(async () => {
    const db = openMemoryDb();
    seedBase(db);
    const before = counts(db);
    const { result, generateStructuredCalls } = await runPilot(db, {
      generateStructured: async (request) => ({
        parsed: extractOnFirst(request.user, {
          action: "new",
          surfaceForm: "人間関係",
        }),
        model: request.model,
      }),
    });
    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }
    assert.equal(result.report.classification, "REAL_INCREMENTAL_LLM_PILOT_PLANNED");
    assert.equal(result.report.eligibility, "eligible");
    assert.equal(result.report.sessionExecutions, 1);
    assert.equal(generateStructuredCalls >= 1, true);
    assert.deepEqual(counts(db), before);
  });
});

test("B. already covered → LLM call 0", async () => {
  await withExtractEnv(async () => {
    const db = openMemoryDb();
    seedBase(db);
    const before = counts(db);
    const { result, generateStructuredCalls } = await runPilot(db, {
      sessionId: COVERED,
    });
    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }
    assert.equal(result.report.classification, "REAL_INCREMENTAL_LLM_PILOT_BLOCKED");
    assert.equal(result.report.eligibility, "already_covered");
    assert.equal(result.report.generateStructuredCalls, 0);
    assert.equal(generateStructuredCalls, 0);
    assert.deepEqual(counts(db), before);
  });
});

test("C. missing Session → LLM call 0", async () => {
  await withExtractEnv(async () => {
    const db = openMemoryDb();
    seedBase(db);
    const before = counts(db);
    const { result, generateStructuredCalls } = await runPilot(db, {
      sessionId: "missing-session",
    });
    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }
    assert.equal(result.report.classification, "REAL_INCREMENTAL_LLM_PILOT_BLOCKED");
    assert.equal(result.report.reason, "missing_session");
    assert.equal(result.report.stage, "eligibility");
    assert.equal(result.report.generateStructuredCalls, 0);
    assert.equal(generateStructuredCalls, 0);
    assert.deepEqual(counts(db), before);
  });
});

test("D. --apply reject, LLM 0, DB write 0", async () => {
  await withExtractEnv(async () => {
    const parsed = parseConceptIncrementalLlmPilotArgs([
      "--apply",
      "--session",
      ELIGIBLE,
    ]);
    assert.equal(parsed.apply, true);
    const db = openMemoryDb();
    seedBase(db);
    const before = counts(db);
    let opened = false;
    let llmCalls = 0;
    const result = await runConceptIncrementalLlmPilot(
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
    assert.equal(result.ok, false);
    if (result.ok) {
      return;
    }
    assert.equal(result.code, "apply");
    assert.equal(result.error, CONCEPT_INCREMENTAL_LLM_PILOT_APPLY_ERROR);
    assert.equal(opened, false);
    assert.equal(llmCalls, 0);
    assert.deepEqual(counts(db), before);
  });
});

test("E. malformed CLI → LLM call 0", async () => {
  await withExtractEnv(async () => {
    assert.equal(parseConceptIncrementalLlmPilotArgs([]).malformed, true);
    assert.equal(
      parseConceptIncrementalLlmPilotArgs(["--session", ELIGIBLE, "--session", COVERED])
        .malformed,
      true,
    );
    const db = openMemoryDb();
    seedBase(db);
    const before = counts(db);
    let opened = false;
    let llmCalls = 0;
    const missing = await runConceptIncrementalLlmPilot([], {
      openDb: () => {
        opened = true;
        return db;
      },
      generateStructured: async () => {
        llmCalls += 1;
        throw new Error("should not call LLM");
      },
    });
    const multiple = await runConceptIncrementalLlmPilot(
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
    if (!missing.ok) {
      assert.equal(missing.code, "missing_session");
    }
    if (!multiple.ok) {
      assert.equal(multiple.code, "multiple_sessions");
    }
    assert.equal(opened, false);
    assert.equal(llmCalls, 0);
    assert.deepEqual(counts(db), before);
  });
});

test("F. planned classification counts", async () => {
  await withExtractEnv(async () => {
    const db = openMemoryDb();
    seedBase(db);
    const before = counts(db);
    const { result } = await runPilot(db, {
      generateStructured: async (request) => ({
        parsed: extractOnFirst(request.user, {
          action: "new",
          surfaceForm: "人間関係",
        }),
        model: request.model,
      }),
    });
    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }
    assert.equal(result.report.status, "planned");
    assert.equal(result.report.existingMatchCount, 1);
    assert.equal(result.report.exactCanonicalCount, 1);
    assert.equal(result.report.uniqueObservedAliasCount, 0);
    assert.equal(result.report.newCount, 0);
    assert.equal(result.report.provisionalNewCount, 0);
    assert.equal(result.report.plans[0]?.kind, "existing_match");
    assert.equal(result.report.plans[0]?.matchReason, "exact_canonical");
    assert.equal(result.report.plans[0]?.conceptId, HUMAN_ID);
    assert.equal(result.report.coverage.extractPromptVersion, CONCEPT_EXTRACT_PROMPT_VERSION);
    assert.equal(result.report.coverage.extractionVersion, CONCEPT_EXTRACTION_VERSION);
    assert.deepEqual(counts(db), before);
  });
});

test("G. Candidate 0 → no_op", async () => {
  await withExtractEnv(async () => {
    const db = openMemoryDb();
    seedBase(db);
    const before = counts(db);
    const { result, generateStructuredCalls } = await runPilot(db);
    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }
    assert.equal(result.report.classification, "REAL_INCREMENTAL_LLM_PILOT_NO_OP");
    assert.equal(result.report.status, "no_op");
    assert.equal(result.report.actionCount, 0);
    assert.equal(generateStructuredCalls >= 1, true);
    assert.deepEqual(counts(db), before);
  });
});

test("H. blocked grounding, write 0", async () => {
  await withExtractEnv(async () => {
    const db = openMemoryDb();
    seedBase(db);
    const before = counts(db);
    const { result } = await runPilot(db, {
      generateStructured: async (request) => ({
        parsed: extractOnFirst(request.user, {
          action: "new",
          surfaceForm: "存在しない表層",
        }),
        model: request.model,
      }),
    });
    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }
    assert.equal(result.report.classification, "REAL_INCREMENTAL_LLM_PILOT_BLOCKED");
    assert.equal(result.report.stage, "planning");
    assert.equal(result.report.reason, "all_actions_grounding_rejected");
    assert.equal(result.report.eligibility, "eligible");
    assert.deepEqual(counts(db), before);
  });
});

test("I. semantic MATCH stays provisional_new", async () => {
  await withExtractEnv(async () => {
    const db = openMemoryDb();
    seedBase(db, USER_MIXED);
    const before = counts(db);
    const { result } = await runPilot(db, {
      generateStructured: async (request) => ({
        parsed: extractOnFirst(request.user, {
          action: "match",
          surfaceForm: "寂しさ",
          existingConceptRef: HUMAN_ID,
        }),
        model: request.model,
      }),
    });
    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }
    assert.equal(result.report.status, "planned");
    assert.equal(result.report.provisionalNewCount, 1);
    assert.equal(result.report.existingMatchCount, 0);
    assert.equal(result.report.plans[0]?.kind, "provisional_new");
    assert.equal(result.report.plans[0]?.provisionalReason, "semantic");
    assert.equal(result.report.plans[0]?.conceptId, null);
    assert.deepEqual(counts(db), before);
  });
});

test("J. zero DB write on every path", async () => {
  await withExtractEnv(async () => {
    const db = openMemoryDb();
    seedBase(db);
    const before = counts(db);
    await runPilot(db);
    await runPilot(db, { sessionId: COVERED });
    await runPilot(db, { sessionId: "missing-session" });
    assert.deepEqual(counts(db), before);
  });
});

test("K. persistent result has no USER body / raw LLM output", async () => {
  await withExtractEnv(async () => {
    const db = openMemoryDb();
    seedBase(db);
    let written: unknown = null;
    const candidateText = candidateReportText([COVERED]);
    const result = await runConceptIncrementalLlmPilot(["--session", ELIGIBLE], {
      openDb: () => db,
      generateStructured: async (request) => ({
        parsed: extractOnFirst(request.user, {
          action: "new",
          surfaceForm: "人間関係",
        }),
        model: request.model,
      }),
      readFile: (path) => {
        if (path.includes("concept-pilot-2b-v4") || path.includes("candidates")) {
          return candidateText;
        }
        return manifestText(candidateText);
      },
      writeReport: (_path, payload) => {
        written = payload;
      },
      now: () => "2026-08-22T00:00:00.000Z",
      model: "test-model",
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
    if (result.ok) {
      assert.equal("executedAt" in result.report, true);
    }
  });
});

test("runner uses gated planner and does not append or auto-select", () => {
  const sources = [
    "lib/concepts/incremental/llm-pilot.ts",
    "scripts/concept-incremental-pilot.ts",
  ].map((path) => readFileSync(resolve(process.cwd(), path), "utf8"));
  for (const source of sources) {
    assert.match(sources[0]!, /planEligibleIncrementalSession/);
    assert.match(sources[0]!, /createProductionIncrementalCandidateExtractor/);
    assert.doesNotMatch(source, /runExistingMatchOccurrenceAppend/);
    assert.doesNotMatch(source, /runExistingMatchOccurrencePreflight/);
    assert.doesNotMatch(source, /applyExistingMatchOccurrences/);
    assert.doesNotMatch(source, /102a1678-dbe6-47a3-a064-a8b898425b06/);
    assert.doesNotMatch(source, /evaluatePolicyCalibration/);
    assert.doesNotMatch(source, /負の連鎖/);
  }
  const lib = sources[0]!;
  assert.doesNotMatch(lib, /getAiProvider/);
  assert.doesNotMatch(lib, /from "openai"/);
  assert.doesNotMatch(lib, /createOpenAiProvider/);
});
