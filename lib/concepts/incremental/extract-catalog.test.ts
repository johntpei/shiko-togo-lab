import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import {
  emptyConceptCatalog,
  formatConceptCatalogForLlm,
  type ConceptRegistrySnapshot,
} from "@/lib/concepts/catalog";
import type { ConceptExtractOutput } from "@/lib/ai/concept-extract-schema";
import type { StructuredGenerateRequest } from "@/lib/ai/provider";
import { applySqlMigrations } from "@/lib/db/client";
import {
  countConceptAliases,
  countConceptOccurrences,
  countConcepts,
  insertConcept,
  insertConceptAlias,
} from "@/lib/db/concept-queries";
import * as schema from "@/lib/db/schema";
import { applyExistingMatchOccurrences } from "./append";
import { createProductionIncrementalCandidateExtractor } from "./extract";
import type { ExistingMatchPlan } from "./plan";
import { loadConceptRegistrySnapshot } from "./registry";
import { planIncrementalSession } from "./session-plan";
import type { IncrementalCandidateExtractorContext } from "./session-plan";

const HUMAN_ID = "concept-human-relations";
const AI_ID = "concept-high-perf-ai";
const SESSION_A = "session-a";
const USER_A =
  "これまでの人間関係でなぜ上手くいかないのか理解できないと思った。";
const USER_ALIAS =
  "これまでの対人関係でなぜ上手くいかないのか理解できないと思った。";
const USER_MIXED =
  "人間関係と寂しさと統合支援ツールについて同じ文で考えています。";
const ASSISTANT = "了解しました。人間関係と高性能AIの両方を整理します。";

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

function seedSession(db: ReturnType<typeof openMemoryDb>, content: string) {
  db.insert(schema.sessions)
    .values({
      id: SESSION_A,
      title: SESSION_A,
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
      id: `${SESSION_A}-u`,
      sessionId: SESSION_A,
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
      id: `${SESSION_A}-a`,
      sessionId: SESSION_A,
      index: 1,
      role: "assistant",
      content: ASSISTANT,
      charStart: 0,
      charEnd: ASSISTANT.length,
      sourceMessageId: null,
      sourceCreatedAt: "2019-01-01T00:00:00.000Z",
      contentType: "text",
      attachmentsJson: null,
    })
    .run();
}

function seedRegistry(
  db: ReturnType<typeof openMemoryDb>,
  order: "human-first" | "ai-first" = "human-first",
) {
  const human = {
    id: HUMAN_ID,
    canonicalLabel: "人間関係",
    createdAt: "2026-08-18T00:00:00.000Z",
  };
  const ai = {
    id: AI_ID,
    canonicalLabel: "高性能AI",
    createdAt: "2026-08-18T00:00:00.000Z",
  };
  if (order === "human-first") {
    insertConcept(human, db);
    insertConcept(ai, db);
  } else {
    insertConcept(ai, db);
    insertConcept(human, db);
  }
  insertConceptAlias({ conceptId: HUMAN_ID, aliasLabel: "対人関係" }, db);
}

function counts(db: ReturnType<typeof openMemoryDb>) {
  return {
    concepts: countConcepts(db),
    aliases: countConceptAliases(db),
    occurrences: countConceptOccurrences(db),
  };
}

function parsedUnit(concepts: ConceptExtractOutput["units"][number]["concepts"]): ConceptExtractOutput {
  return {
    units: [
      {
        evidenceRef: "M001:E01",
        disposition: "extracted",
        concepts,
      },
    ],
  };
}

function skipUnit(): ConceptExtractOutput {
  return {
    units: [
      {
        evidenceRef: "M001:E01",
        disposition: "skip",
        concepts: [],
      },
    ],
  };
}

test("A. Empty Registry は empty catalog と等価", async () => {
  await withExtractEnv(async () => {
    const db = openMemoryDb();
    seedSession(db, USER_A);
    let request: StructuredGenerateRequest | undefined;
    const result = await planIncrementalSession({
      sessionId: SESSION_A,
      db,
      extractCandidates: createProductionIncrementalCandidateExtractor({
        generateStructured: async (input) => {
          request = input;
          return { parsed: skipUnit(), model: input.model };
        },
      }),
    });
    assert.equal(result.status, "no_op");
    assert.equal(
      request?.user.includes(formatConceptCatalogForLlm(emptyConceptCatalog())),
      true,
    );
    assert.match(request?.user ?? "", /（まだ Concept はありません）/);
  });
});

test("B. Existing Concepts が Extraction v4 Catalog に載る", async () => {
  await withExtractEnv(async () => {
    const db = openMemoryDb();
    seedSession(db, USER_A);
    seedRegistry(db);
    let request: StructuredGenerateRequest | undefined;
    await planIncrementalSession({
      sessionId: SESSION_A,
      db,
      extractCandidates: createProductionIncrementalCandidateExtractor({
        generateStructured: async (input) => {
          request = input;
          return { parsed: skipUnit(), model: input.model };
        },
      }),
    });
    const user = request?.user ?? "";
    assert.match(user, new RegExp(`${HUMAN_ID} \\| 人間関係`));
    assert.match(user, /aliases: 対人関係/);
    assert.match(user, new RegExp(`${AI_ID} \\| 高性能AI`));
    assert.doesNotMatch(user, /（まだ Concept はありません）/);
  });
});

test("C. frequency / Admission 情報を Catalog へ載せない", async () => {
  await withExtractEnv(async () => {
    const db = openMemoryDb();
    seedSession(db, USER_A);
    seedRegistry(db);
    let request: StructuredGenerateRequest | undefined;
    await planIncrementalSession({
      sessionId: SESSION_A,
      db,
      extractCandidates: createProductionIncrementalCandidateExtractor({
        generateStructured: async (input) => {
          request = input;
          return { parsed: skipUnit(), model: input.model };
        },
      }),
    });
    const user = request?.user ?? "";
    assert.doesNotMatch(user, /occurrenceCount/);
    assert.doesNotMatch(user, /distinctSessionCount/);
    assert.doesNotMatch(user, /firstSeenAt/);
    assert.doesNotMatch(user, /lastSeenAt/);
    assert.doesNotMatch(user, /named_or_high/);
    assert.doesNotMatch(user, /Calibration/);
    assert.doesNotMatch(user, /Assessment/);
    assert.doesNotMatch(user, /suspiciousFlags/);
    assert.doesNotMatch(user, /Topic Signal/);
  });
});

test("D. exact canonical は confirmed existing_match", async () => {
  await withExtractEnv(async () => {
    const db = openMemoryDb();
    seedSession(db, USER_A);
    seedRegistry(db);
    const result = await planIncrementalSession({
      sessionId: SESSION_A,
      db,
      extractCandidates: createProductionIncrementalCandidateExtractor({
        generateStructured: async (input) => ({
          parsed: parsedUnit([{ action: "new", surfaceForm: "人間関係" }]),
          model: input.model,
        }),
      }),
    });
    assert.equal(result.status, "planned");
    if (result.status !== "planned") {
      return;
    }
    assert.equal(result.existingMatches, 1);
    assert.equal(result.plans[0]?.kind, "existing_match");
    if (result.plans[0]?.kind === "existing_match") {
      assert.equal(result.plans[0].conceptId, HUMAN_ID);
      assert.equal(result.plans[0].matchReason, "exact_canonical");
    }
  });
});

test("E. unique alias は confirmed existing_match", async () => {
  await withExtractEnv(async () => {
    const db = openMemoryDb();
    seedSession(db, USER_ALIAS);
    seedRegistry(db);
    const result = await planIncrementalSession({
      sessionId: SESSION_A,
      db,
      extractCandidates: createProductionIncrementalCandidateExtractor({
        generateStructured: async (input) => ({
          parsed: parsedUnit([{ action: "new", surfaceForm: "対人関係" }]),
          model: input.model,
        }),
      }),
    });
    assert.equal(result.status, "planned");
    if (result.status !== "planned") {
      return;
    }
    assert.equal(result.existingMatches, 1);
    assert.equal(result.plans[0]?.kind, "existing_match");
    if (result.plans[0]?.kind === "existing_match") {
      assert.equal(result.plans[0].conceptId, HUMAN_ID);
      assert.equal(result.plans[0].matchReason, "unique_observed_alias");
    }
  });
});

test("F. semantic MATCH は provisional_new であり existing_match にならない", async () => {
  await withExtractEnv(async () => {
    const db = openMemoryDb();
    seedSession(db, USER_MIXED);
    seedRegistry(db);
    const result = await planIncrementalSession({
      sessionId: SESSION_A,
      db,
      extractCandidates: createProductionIncrementalCandidateExtractor({
        generateStructured: async (input) => ({
          parsed: parsedUnit([
            {
              action: "match",
              surfaceForm: "寂しさ",
              existingConceptRef: HUMAN_ID,
            },
          ]),
          model: input.model,
        }),
      }),
    });
    assert.equal(result.status, "planned");
    if (result.status !== "planned") {
      return;
    }
    assert.equal(result.existingMatches, 0);
    assert.equal(result.provisionalNewCandidates, 1);
    assert.equal(result.plans[0]?.kind, "provisional_new");
    if (result.plans[0]?.kind === "provisional_new") {
      assert.equal(result.plans[0].canonicalLabel, "寂しさ");
      assert.equal(result.plans[0].provisionalConceptId, HUMAN_ID);
      assert.equal(result.plans[0].provisionalReason, "semantic");
    }
  });
});

test("G. semantic provisional_new は existing-match append できない", async () => {
  await withExtractEnv(async () => {
    const db = openMemoryDb();
    seedSession(db, USER_MIXED);
    seedRegistry(db);
    const result = await planIncrementalSession({
      sessionId: SESSION_A,
      db,
      extractCandidates: createProductionIncrementalCandidateExtractor({
        generateStructured: async (input) => ({
          parsed: parsedUnit([
            {
              action: "match",
              surfaceForm: "寂しさ",
              existingConceptRef: HUMAN_ID,
            },
          ]),
          model: input.model,
        }),
      }),
    });
    assert.equal(result.status, "planned");
    if (result.status !== "planned") {
      return;
    }
    assert.equal(result.plans[0]?.kind, "provisional_new");
    const applied = applyExistingMatchOccurrences(
      [result.plans[0] as unknown as ExistingMatchPlan],
      { db },
    );
    assert.equal(applied.ok, false);
    if (!applied.ok) {
      assert.equal(applied.code, "unsupported_plan_kind");
    }
    assert.equal(countConceptOccurrences(db), 0);
  });
});

test("H. invalid existingConceptRef は confirmed にしない", async () => {
  await withExtractEnv(async () => {
    const db = openMemoryDb();
    seedSession(db, USER_A);
    seedRegistry(db);
    const result = await planIncrementalSession({
      sessionId: SESSION_A,
      db,
      extractCandidates: createProductionIncrementalCandidateExtractor({
        generateStructured: async (input) => ({
          parsed: parsedUnit([
            {
              action: "match",
              surfaceForm: "理解できない",
              existingConceptRef: "C99-missing",
            },
          ]),
          model: input.model,
        }),
      }),
    });
    assert.equal(result.status, "blocked");
    if (result.status === "blocked") {
      assert.equal(result.code, "unknown_concept_ref");
    }
  });
});

test("I. Catalog 付きでも invalid grounding は blocked", async () => {
  await withExtractEnv(async () => {
    const db = openMemoryDb();
    seedSession(db, USER_A);
    seedRegistry(db);
    const result = await planIncrementalSession({
      sessionId: SESSION_A,
      db,
      extractCandidates: createProductionIncrementalCandidateExtractor({
        generateStructured: async (input) => ({
          parsed: parsedUnit([{ action: "new", surfaceForm: "存在しない表層" }]),
          model: input.model,
        }),
      }),
    });
    assert.equal(result.status, "blocked");
    if (result.status === "blocked") {
      assert.equal(result.code, "all_actions_grounding_rejected");
    }
  });
});

test("J. 1 Session planning は同じ Registry snapshot を Extraction へ渡す", async () => {
  await withExtractEnv(async () => {
    const db = openMemoryDb();
    seedSession(db, USER_A);
    seedRegistry(db);
    let seen: ConceptRegistrySnapshot | undefined;
    const extractor = createProductionIncrementalCandidateExtractor({
      generateStructured: async (input) => ({
        parsed: parsedUnit([{ action: "new", surfaceForm: "人間関係" }]),
        model: input.model,
      }),
    });
    const wrapped = async (
      units: Parameters<typeof extractor>[0],
      context?: IncrementalCandidateExtractorContext,
    ) => {
      seen = context?.catalog;
      return extractor(units, context);
    };
    const result = await planIncrementalSession({
      sessionId: SESSION_A,
      db,
      extractCandidates: wrapped,
    });
    const loaded = loadConceptRegistrySnapshot(db);
    assert.deepEqual(seen, loaded);
    assert.equal(result.status, "planned");
    if (result.status === "planned") {
      assert.equal(result.plans[0]?.kind, "existing_match");
      if (result.plans[0]?.kind === "existing_match") {
        assert.equal(result.plans[0].conceptId, HUMAN_ID);
      }
    }
    const source = readFileSync(
      resolve(process.cwd(), "lib/concepts/incremental/session-plan.ts"),
      "utf8",
    );
    const loads = source.match(/loadConceptRegistrySnapshot/g) ?? [];
    assert.equal(loads.length, 2);
  });
});

test("K. 同じ Registry から生成した Catalog は決定論的", () => {
  const firstDb = openMemoryDb();
  seedRegistry(firstDb, "human-first");
  const secondDb = openMemoryDb();
  seedRegistry(secondDb, "ai-first");
  const first = loadConceptRegistrySnapshot(firstDb);
  const second = loadConceptRegistrySnapshot(secondDb);
  assert.deepEqual(first, second);
  assert.equal(
    formatConceptCatalogForLlm(first),
    formatConceptCatalogForLlm(second),
  );
  assert.deepEqual(
    first.entries.map((item) => item.ref),
    [AI_ID, HUMAN_ID],
  );
});

test("L. Catalog wiring 前後で DB counts 不変", async () => {
  await withExtractEnv(async () => {
    const db = openMemoryDb();
    seedSession(db, USER_MIXED);
    seedRegistry(db);
    const before = counts(db);
    await planIncrementalSession({
      sessionId: SESSION_A,
      db,
      extractCandidates: createProductionIncrementalCandidateExtractor({
        generateStructured: async (input) => ({
          parsed: parsedUnit([
            {
              action: "match",
              surfaceForm: "寂しさ",
              existingConceptRef: HUMAN_ID,
            },
          ]),
          model: input.model,
        }),
      }),
    });
    assert.deepEqual(counts(db), before);
  });
});

test("adapter は getDb せず Catalog を inject で受ける", () => {
  const source = readFileSync(
    resolve(process.cwd(), "lib/concepts/incremental/extract.ts"),
    "utf8",
  );
  assert.match(source, /conceptCatalog/);
  assert.match(source, /emptyConceptCatalog/);
  assert.doesNotMatch(source, /getDb\(/);
  assert.doesNotMatch(source, /loadConceptRegistrySnapshot/);
  assert.doesNotMatch(source, /occurrenceCount/);
  assert.doesNotMatch(source, /applyExistingMatchOccurrences/);
});
