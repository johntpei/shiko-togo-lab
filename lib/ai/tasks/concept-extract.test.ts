import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { emptyConceptCatalog } from "@/lib/concepts/catalog";
import { runConceptExtractSession } from "./concept-extract";
import type { ConceptExtractMessage } from "@/lib/concepts/user-units";

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

test("1 Session は 1 API call で、結果を 3C-1a resolver へ渡す", async () => {
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
            parsed: {
              items: [
                {
                  action: "new",
                  evidenceRef: "M001:E01",
                  surfaceForm: "高性能AI",
                  proposedCanonicalLabel: "AI性能",
                  aliases: [],
                },
                {
                  action: "skip",
                  evidenceRef: "M003:E01",
                  surfaceForm: "方法",
                },
              ],
            },
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
    assert.equal(result.actions[0]?.action, "new");
    assert.equal(result.resolve.newConcepts[0]?.canonicalLabel, "AI性能");
    assert.equal(result.resolve.skipped.length, 1);
    assert.equal(result.units.some((unit) => unit.evidenceRef.startsWith("M003:")), true);
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
          parsed: {
            items: [
              {
                action: "new",
                evidenceRef: "M001:E01",
                surfaceForm: "愛着不安",
                proposedCanonicalLabel: "愛着不安",
                aliases: [],
              },
            ],
          },
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
  assert.doesNotMatch(source, /validateConceptCandidate/);
  assert.doesNotMatch(source, /groundSurfaceForm/);
  assert.doesNotMatch(source, /validateConceptOccurrence/);
});
