import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import {
  CONCEPT_EXTRACT_PROMPT_VERSION,
  CONCEPT_EXTRACT_SYSTEM_PROMPT,
  CONCEPT_EXTRACT_SYSTEM_PROMPT_V4,
} from "@/lib/ai/prompts/concept-extract";
import {
  CONCEPT_EXTRACT_SCHEMA_NAME,
  conceptExtractOutputSchema,
  type ConceptExtractOutput,
} from "@/lib/ai/concept-extract-schema";
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
import { CONCEPT_EXTRACTION_VERSION } from "@/lib/concepts/types";
import type { ConceptExtractUnit } from "@/lib/concepts/user-units";
import {
  createProductionIncrementalCandidateExtractor,
  IncrementalExtractError,
} from "./extract";
import { planIncrementalSession } from "./session-plan";
import type { IncrementalCandidateExtractor } from "./session-plan";

const HUMAN_ID = "concept-human-relations";
const SESSION_A = "session-a";
const USER_A =
  "これまでの人間関係でなぜ上手くいかないのか理解できないと思った。";
const USER_B =
  "人間関係を最小限にする道を選びました。高性能AIについても触れます。";
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

function unit(
  overrides: Partial<ConceptExtractUnit> & Pick<ConceptExtractUnit, "text" | "evidenceRef">,
): ConceptExtractUnit {
  return {
    messageId: `${SESSION_A}-u`,
    sessionId: SESSION_A,
    sourceCreatedAt: "2026-07-15T12:00:00.000Z",
    sessionOccurredAt: "2099-01-01",
    ...overrides,
  };
}

const UNIT_A = unit({ evidenceRef: "M001:E01", text: USER_A });
const UNIT_B = unit({
  evidenceRef: "M002:E01",
  messageId: `${SESSION_A}-u2`,
  text: USER_B,
});

function coverUnits(
  units: ConceptExtractUnit[],
  patches: Record<string, ConceptExtractOutput["units"][number]> = {},
): ConceptExtractOutput {
  return {
    units: units.map((item) => {
      const patch = patches[item.evidenceRef];
      if (patch) {
        return patch;
      }
      return {
        evidenceRef: item.evidenceRef,
        disposition: "skip" as const,
        concepts: [],
      };
    }),
  };
}

function openMemoryDb() {
  const sqlite = new Database(":memory:");
  applySqlMigrations(sqlite);
  sqlite.pragma("foreign_keys = ON");
  return drizzle(sqlite, { schema });
}

function seedSessionA(db: ReturnType<typeof openMemoryDb>) {
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
      content: USER_A,
      charStart: 0,
      charEnd: USER_A.length,
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
  insertConcept(
    {
      id: HUMAN_ID,
      canonicalLabel: "人間関係",
      createdAt: "2026-08-18T00:00:00.000Z",
    },
    db,
  );
  insertConceptAlias({ conceptId: HUMAN_ID, aliasLabel: "対人関係" }, db);
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

test("A. Production adapter は IncrementalCandidateExtractor として使える", async () => {
  await withExtractEnv(async () => {
    const extractor: IncrementalCandidateExtractor =
      createProductionIncrementalCandidateExtractor({
        generateStructured: async () => ({
          parsed: coverUnits([UNIT_A]),
          model: "test-model",
        }),
      });
    const actions = await extractor([UNIT_A]);
    assert.equal(Array.isArray(actions), true);
  });
});

test("B. freeze済み concept-extract-prompt-v4 を使用し新Promptは作らない", async () => {
  await withExtractEnv(async () => {
    assert.equal(CONCEPT_EXTRACT_PROMPT_VERSION, "concept-extract-prompt-v4");
    assert.equal(CONCEPT_EXTRACT_SYSTEM_PROMPT, CONCEPT_EXTRACT_SYSTEM_PROMPT_V4);
    let request: StructuredGenerateRequest | null = null;
    const extractor = createProductionIncrementalCandidateExtractor({
      generateStructured: async (input) => {
        request = input;
        return { parsed: coverUnits([UNIT_A]), model: input.model };
      },
    });
    await extractor([UNIT_A]);
    assert.equal(request?.system, CONCEPT_EXTRACT_SYSTEM_PROMPT_V4);
    assert.equal(request?.model, "test-model");
    const adapter = readFileSync(
      resolve(process.cwd(), "lib/concepts/incremental/extract.ts"),
      "utf8",
    );
    assert.doesNotMatch(adapter, /CONCEPT_EXTRACT_SYSTEM_PROMPT_V5/);
    assert.doesNotMatch(adapter, /あなたは、1つの対話Session/);
  });
});

test("C. Extraction version は concept-extraction-v1", async () => {
  await withExtractEnv(async () => {
    assert.equal(CONCEPT_EXTRACTION_VERSION, "concept-extraction-v1");
    const db = openMemoryDb();
    seedSessionA(db);
    const result = await planIncrementalSession({
      sessionId: SESSION_A,
      db,
      extractCandidates: createProductionIncrementalCandidateExtractor({
        generateStructured: async () => ({
          parsed: coverUnits(
            [
              unit({
                evidenceRef: "M001:E01",
                text: USER_A,
              }),
            ],
            {
              "M001:E01": {
                evidenceRef: "M001:E01",
                disposition: "extracted",
                concepts: [{ action: "new", surfaceForm: "人間関係" }],
              },
            },
          ),
          model: "test-model",
        }),
      }),
    });
    assert.equal(result.status, "planned");
    if (result.status === "planned") {
      assert.equal(
        result.plans[0]?.provenance.extractionVersion,
        CONCEPT_EXTRACTION_VERSION,
      );
    }
  });
});

test("D. 既存 Structured Output schema / parser を使用する", async () => {
  await withExtractEnv(async () => {
    let request: StructuredGenerateRequest | null = null;
    const extractor = createProductionIncrementalCandidateExtractor({
      generateStructured: async (input) => {
        request = input;
        return { parsed: coverUnits([UNIT_A]), model: input.model };
      },
    });
    await extractor([UNIT_A]);
    assert.equal(request?.schemaName, CONCEPT_EXTRACT_SCHEMA_NAME);
    assert.equal(request?.schema, conceptExtractOutputSchema);
  });
});

test("E. Provider へ渡す source は入力 USER Evidence Units だけ", async () => {
  await withExtractEnv(async () => {
    let request: StructuredGenerateRequest | null = null;
    const extractor = createProductionIncrementalCandidateExtractor({
      generateStructured: async (input) => {
        request = input;
        return {
          parsed: coverUnits([UNIT_A, UNIT_B]),
          model: input.model,
        };
      },
    });
    await extractor([UNIT_A, UNIT_B]);
    const user = request?.user ?? "";
    assert.match(user, /M001:E01/);
    assert.match(user, /M002:E01/);
    assert.equal(user.includes(USER_A), true);
    assert.equal(user.includes(USER_B), true);
    assert.doesNotMatch(request?.user ?? "", /occurrenceCount/);
    assert.doesNotMatch(request?.user ?? "", /distinctSessionCount/);
    assert.doesNotMatch(request?.user ?? "", /firstSeenAt/);
    assert.doesNotMatch(request?.user ?? "", /lastSeenAt/);
    assert.doesNotMatch(request?.user ?? "", /named_or_high/);
    assert.doesNotMatch(request?.user ?? "", /Calibration/);
    assert.doesNotMatch(request?.user ?? "", /人間関係 \|/);
    assert.match(request?.user ?? "", /（まだ Concept はありません）/);
  });
});

test("F. Adapter は DB から assistant content を取得しない", () => {
  const source = readFileSync(
    resolve(process.cwd(), "lib/concepts/incremental/extract.ts"),
    "utf8",
  );
  assert.doesNotMatch(source, /from\(messages\)/);
  assert.doesNotMatch(source, /from\(sessions\)/);
  assert.doesNotMatch(source, /getDb\(/);
  assert.doesNotMatch(source, /prepareUserEvidenceUnits/);
});

test("G. valid Candidate は既存 contract で返る", async () => {
  await withExtractEnv(async () => {
    const extractor = createProductionIncrementalCandidateExtractor({
      generateStructured: async () => ({
        parsed: coverUnits([UNIT_A], {
          "M001:E01": {
            evidenceRef: "M001:E01",
            disposition: "extracted",
            concepts: [{ action: "new", surfaceForm: "人間関係" }],
          },
        }),
        model: "test-model",
      }),
    });
    const actions = await extractor([UNIT_A]);
    assert.deepEqual(actions, [
      {
        action: "new",
        evidenceRef: "M001:E01",
        surfaceForm: "人間関係",
      },
    ]);
  });
});

test("H. valid zero Candidates は空配列であり failure ではない", async () => {
  await withExtractEnv(async () => {
    const extractor = createProductionIncrementalCandidateExtractor({
      generateStructured: async () => ({
        parsed: coverUnits([UNIT_A]),
        model: "test-model",
      }),
    });
    const actions = await extractor([UNIT_A]);
    assert.deepEqual(actions, []);
  });
});

test("I. malformed structured output は空配列へ fallback しない", async () => {
  await withExtractEnv(async () => {
    const extractor = createProductionIncrementalCandidateExtractor({
      generateStructured: async () => ({
        parsed: { items: [{ action: "merge" }] },
        model: "test-model",
      }),
    });
    await assert.rejects(
      () => extractor([UNIT_A]),
      (error: unknown) => {
        assert.equal(error instanceof IncrementalExtractError, true);
        if (error instanceof IncrementalExtractError) {
          assert.equal(error.code, "schema");
        }
        return true;
      },
    );
  });
});

test("J. provider failure は明示的 failure で adapter 独自 retry しない", async () => {
  await withExtractEnv(async () => {
    let calls = 0;
    const extractor = createProductionIncrementalCandidateExtractor({
      generateStructured: async () => {
        calls += 1;
        throw new Error("network down");
      },
    });
    await assert.rejects(
      () => extractor([UNIT_A]),
      (error: unknown) => {
        assert.equal(error instanceof IncrementalExtractError, true);
        if (error instanceof IncrementalExtractError) {
          assert.equal(error.code, "api");
        }
        return true;
      },
    );
    assert.equal(calls, 1);
  });
});

test("K. Production Adapter は Registry を読まない", () => {
  const source = readFileSync(
    resolve(process.cwd(), "lib/concepts/incremental/extract.ts"),
    "utf8",
  );
  assert.match(source, /emptyConceptCatalog/);
  assert.doesNotMatch(source, /loadConceptRegistrySnapshot/);
  assert.doesNotMatch(source, /concept_aliases/);
  assert.doesNotMatch(source, /concept_occurrences/);
  assert.doesNotMatch(source, /from\(concepts\)/);
});

test("L. Assessment / Admission Policy を import / execute しない", () => {
  const source = readFileSync(
    resolve(process.cwd(), "lib/concepts/incremental/extract.ts"),
    "utf8",
  );
  assert.doesNotMatch(source, /concept-admission/);
  assert.doesNotMatch(source, /named_or_high/);
  assert.doesNotMatch(source, /assessment/);
  assert.doesNotMatch(source, /resolveConceptActions/);
  assert.doesNotMatch(source, /evaluatePolicyCalibration/);
});

test("M. Adapter / integration 前後で DB mutation なし", async () => {
  await withExtractEnv(async () => {
    const db = openMemoryDb();
    seedSessionA(db);
    const before = counts(db);
    const extractor = createProductionIncrementalCandidateExtractor({
      generateStructured: async () => ({
        parsed: coverUnits(
          [UNIT_A],
          {
            "M001:E01": {
              evidenceRef: "M001:E01",
              disposition: "extracted",
              concepts: [{ action: "new", surfaceForm: "人間関係" }],
            },
          },
        ),
        model: "test-model",
      }),
    });
    await extractor([UNIT_A]);
    await planIncrementalSession({
      sessionId: SESSION_A,
      db,
      extractCandidates: extractor,
    });
    assert.deepEqual(counts(db), before);
  });
});

test("N. stub provider の Production adapter を planIncrementalSession へ inject できる", async () => {
  await withExtractEnv(async () => {
    const db = openMemoryDb();
    seedSessionA(db);
    const result = await planIncrementalSession({
      sessionId: SESSION_A,
      db,
      extractCandidates: createProductionIncrementalCandidateExtractor({
        generateStructured: async () => ({
          parsed: coverUnits(
            [UNIT_A],
            {
              "M001:E01": {
                evidenceRef: "M001:E01",
                disposition: "extracted",
                concepts: [{ action: "new", surfaceForm: "人間関係" }],
              },
            },
          ),
          model: "test-model",
        }),
      }),
    });
    assert.equal(result.status, "planned");
    if (result.status !== "planned") {
      return;
    }
    assert.equal(result.existingMatches, 1);
    assert.equal(result.newCandidates, 0);
    assert.equal(result.plans[0]?.kind, "existing_match");
    if (result.plans[0]?.kind === "existing_match") {
      assert.equal(result.plans[0].conceptId, HUMAN_ID);
      assert.equal(result.plans[0].provenance.sourceRole, "user");
      assert.equal(result.plans[0].provenance.sourceType, "evidence_unit");
    }
  });
});

test("O. invalid grounding は Production adapter 接続後も Server で blocked", async () => {
  await withExtractEnv(async () => {
    const db = openMemoryDb();
    seedSessionA(db);
    const result = await planIncrementalSession({
      sessionId: SESSION_A,
      db,
      extractCandidates: createProductionIncrementalCandidateExtractor({
        generateStructured: async () => ({
          parsed: coverUnits(
            [UNIT_A],
            {
              "M001:E01": {
                evidenceRef: "M001:E01",
                disposition: "extracted",
                concepts: [{ action: "new", surfaceForm: "存在しない表層" }],
              },
            },
          ),
          model: "test-model",
        }),
      }),
    });
    assert.equal(result.status, "blocked");
    if (result.status === "blocked") {
      assert.equal(result.code, "all_actions_grounding_rejected");
    }
  });
});

test("adapter は OpenAI SDK / real provider / write path に接続しない", () => {
  const source = readFileSync(
    resolve(process.cwd(), "lib/concepts/incremental/extract.ts"),
    "utf8",
  );
  assert.match(source, /runConceptExtractOnUnits/);
  assert.match(source, /createProductionIncrementalCandidateExtractor/);
  assert.doesNotMatch(source, /getAiProvider/);
  assert.doesNotMatch(source, /openai/);
  assert.doesNotMatch(source, /app\.db/);
  assert.doesNotMatch(source, /applyExistingMatchOccurrences/);
  assert.doesNotMatch(source, /runExistingMatchOccurrenceAppend/);
  assert.doesNotMatch(source, /applyInitialAdmissionManifest/);
  assert.doesNotMatch(source, /負の連鎖/);
});
