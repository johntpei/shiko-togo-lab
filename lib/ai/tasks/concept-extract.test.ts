import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { emptyConceptCatalog } from "@/lib/concepts/catalog";
import { prepareUserEvidenceUnits } from "@/lib/concepts/user-units";
import { runConceptExtractSession } from "./concept-extract";
import type { ConceptExtractMessage } from "@/lib/concepts/user-units";
import type { ConceptExtractOutput } from "../concept-extract-schema";

const LONG_USER =
  "高性能AIについて詳しく話したいと思っています。距離感の話も続けます。";
const LONG_ASSISTANT =
  "了解しました。高性能AIと距離感の両方について整理して返しますね。";

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

const messages: ConceptExtractMessage[] = [
  { id: "msg-1", role: "user", content: LONG_USER },
  { id: "msg-2", role: "assistant", content: LONG_ASSISTANT },
  { id: "msg-3", role: "user", content: LONG_USER },
];

function preparedUnits() {
  return prepareUserEvidenceUnits({
    sessionId: "session-a",
    occurredAt: "2026-08-02",
    messages,
  });
}

function coverUnits(
  patches: Record<string, ConceptExtractOutput["units"][number]>,
): ConceptExtractOutput {
  return {
    units: preparedUnits().map((unit) => {
      const patch = patches[unit.evidenceRef];
      if (patch) {
        return patch;
      }
      return {
        evidenceRef: unit.evidenceRef,
        disposition: "skip" as const,
        concepts: [],
      };
    }),
  };
}

test("1 Session は 1 API call で、NEW canonical は grounded surface", async () => {
  await withExtractEnv(async () => {
    let calls = 0;
    const result = await runConceptExtractSession(
      {
        sessionId: "session-a",
        occurredAt: "2026-08-02",
        messages,
        catalog: emptyConceptCatalog(),
      },
      {
        generateStructured: async () => {
          calls += 1;
          return {
            parsed: coverUnits({
              "M001:E01": {
                evidenceRef: "M001:E01",
                disposition: "extracted",
                concepts: [
                  {
                    action: "new",
                    surfaceForm: "高性能AI",
                  },
                ],
              },
              "M003:E01": {
                evidenceRef: "M003:E01",
                disposition: "skip",
                concepts: [],
              },
            }),
            model: "test-model",
            usage: {
              inputTokens: 10,
              outputTokens: 4,
              totalTokens: 14,
            },
          };
        },
      },
    );
    assert.equal(calls, 1);
    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }
    assert.equal(result.apiCalls, 1);
    assert.equal(result.retryCalls, 0);
    assert.equal(result.repaired, false);
    assert.equal(result.promptVersion, "concept-extract-prompt-v4");
    assert.equal(result.actions[0]?.action, "new");
    assert.equal(result.resolve.newConcepts[0]?.canonicalLabel, "高性能AI");
    assert.ok(result.resolve.skipped.length >= 1);
    assert.equal(result.usage?.totalTokens, 14);
  });
});

test("LLM の surfaceForm は resolver grounding で検証する", async () => {
  await withExtractEnv(async () => {
    const result = await runConceptExtractSession(
      {
        sessionId: "session-a",
        occurredAt: "2026-08-02",
        messages,
      },
      {
        generateStructured: async () => ({
          parsed: coverUnits({
            "M001:E01": {
              evidenceRef: "M001:E01",
              disposition: "extracted",
              concepts: [
                {
                  action: "new",
                  surfaceForm: "愛着不安",
                },
              ],
            },
          }),
          model: "test-model",
        }),
      },
    );
    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }
    assert.equal(result.resolve.rejected[0]?.reason, "surface_not_in_unit");
    assert.equal(result.resolve.newConcepts.length, 0);
  });
});

test("coverage duplicate は 1 回 repair し、成功すれば Session を採用する", async () => {
  await withExtractEnv(async () => {
    let calls = 0;
    const first = preparedUnits()[0]!;
    const result = await runConceptExtractSession(
      {
        sessionId: "session-a",
        occurredAt: "2026-08-02",
        messages,
      },
      {
        generateStructured: async (request) => {
          calls += 1;
          if (calls === 1) {
            return {
              parsed: {
                units: [
                  ...coverUnits({}).units,
                  {
                    evidenceRef: first.evidenceRef,
                    disposition: "skip",
                    concepts: [],
                  },
                ],
              },
              model: "test-model",
              usage: { inputTokens: 5, outputTokens: 1, totalTokens: 6 },
            };
          }
          assert.match(request.user, /Coverage repair/);
          assert.match(request.user, /duplicate_evidence_ref/);
          return {
            parsed: coverUnits({}),
            model: "test-model",
            usage: { inputTokens: 7, outputTokens: 2, totalTokens: 9 },
          };
        },
      },
    );
    assert.equal(calls, 2);
    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }
    assert.equal(result.repaired, true);
    assert.equal(result.retryCalls, 1);
    assert.equal(result.apiCalls, 2);
    assert.equal(result.usage?.totalTokens, 15);
  });
});

test("repair も coverage 失敗なら Session failed で usage は加算する", async () => {
  await withExtractEnv(async () => {
    let calls = 0;
    const result = await runConceptExtractSession(
      {
        sessionId: "session-a",
        occurredAt: "2026-08-02",
        messages,
      },
      {
        generateStructured: async () => {
          calls += 1;
          return {
            parsed: {
              units: [
                {
                  evidenceRef: "M001:E01",
                  disposition: "skip",
                  concepts: [],
                },
              ],
            },
            model: "test-model",
            usage: { inputTokens: 3, outputTokens: 1, totalTokens: 4 },
          };
        },
      },
    );
    assert.equal(calls, 2);
    assert.equal(result.ok, false);
    if (result.ok) {
      return;
    }
    assert.equal(result.code, "coverage");
    assert.match(result.error, /missing_unit/);
    assert.equal(result.apiCalls, 2);
    assert.equal(result.retryCalls, 1);
    assert.equal(result.usage?.totalTokens, 8);
  });
});

test("不正 schema は task が拒否する", async () => {
  await withExtractEnv(async () => {
    const result = await runConceptExtractSession(
      {
        sessionId: "session-a",
        occurredAt: "2026-08-02",
        messages,
      },
      {
        generateStructured: async () => ({
          parsed: { items: [{ action: "merge" }] },
          model: "test-model",
        }),
      },
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "schema");
    }
  });
});

test("task は grounding / candidate validation を再実装しない", () => {
  const source = readFileSync("lib/ai/tasks/concept-extract.ts", "utf8");
  assert.match(source, /resolveConceptActions/);
  assert.match(source, /validateConceptExtractCoverage/);
  assert.doesNotMatch(source, /validateConceptCandidate/);
  assert.doesNotMatch(source, /groundSurfaceForm/);
  assert.doesNotMatch(source, /validateConceptOccurrence/);
});
