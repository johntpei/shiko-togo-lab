import assert from "node:assert/strict";
import test from "node:test";
import { ANALYZE_SESSION_MAX_INPUT_CHARS } from "../limits";
import { ANALYZE_SESSION_PROMPT_VERSION } from "../prompts/analyze-session";
import type { AnalyzeMessage } from "../session-input";
import { runAnalyzeSession } from "./analyze-session";

function message(
  id: string,
  role: string,
  content: string,
): AnalyzeMessage {
  return { id, role, content, attachmentsJson: null };
}

const sampleMessages = [
  message("msg-1", "user", "来週から週3回歩くことにします。"),
  message("msg-2", "assistant", "記録用の表を作りましょうか。"),
];

const validOutput = {
  summary: "歩行習慣について決めた。",
  items: [
    {
      kind: "decision" as const,
      text: "週3回歩くことを決めた。",
      evidenceRefs: ["M001:E01"],
    },
  ],
};

async function withAnalyzeEnv(run: () => Promise<void>) {
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

function restore(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

test("Case A: APIキーなしでは分析せず保存しない", async () => {
  const prevKey = process.env.OPENAI_API_KEY;
  const prevModel = process.env.AI_MODEL;
  delete process.env.OPENAI_API_KEY;
  process.env.AI_MODEL = "test-model";
  try {
    let called = false;
    let saved = false;
    const result = await runAnalyzeSession("session-1", sampleMessages, {
      generateStructured: async () => {
        called = true;
        return { parsed: validOutput, model: "test-model" };
      },
      save: () => {
        saved = true;
        return { id: "analysis-1" };
      },
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "not_configured");
    }
    assert.equal(called, false);
    assert.equal(saved, false);
  } finally {
    restore("OPENAI_API_KEY", prevKey);
    restore("AI_MODEL", prevModel);
  }
});

test("v3: EvidenceRef から原文 quote をサーバーが確定する", async () => {
  await withAnalyzeEnv(async () => {
    let systemPrompt = "";
    const result = await runAnalyzeSession("session-1", sampleMessages, {
      generateStructured: async (request) => {
        systemPrompt = request.system;
        return { parsed: validOutput, model: "returned-model" };
      },
      save: (input) => {
        const evidence = input.payload.items[0]?.evidence[0];
        assert.equal(input.promptVersion, "analyze-session-v3");
        assert.equal(evidence?.validated, true);
        assert.equal(evidence?.quote, "来週から週3回歩くことにします。");
        assert.equal(evidence?.messageId, "msg-1");
        assert.equal(input.payload.metrics?.validationRate, 1);
        return { id: "analysis-1" };
      },
    });
    assert.equal(result.ok, true);
    assert.match(systemPrompt, /Evidence本文を生成しない/);
    assert.equal(ANALYZE_SESSION_PROMPT_VERSION, "analyze-session-v3");
  });
});

test("v3: 存在しない EvidenceRef は validated = false", async () => {
  await withAnalyzeEnv(async () => {
    const result = await runAnalyzeSession("session-1", sampleMessages, {
      generateStructured: async () => ({
        parsed: {
          summary: "参照ミス",
          items: [
            {
              kind: "fact",
              text: "不明な参照",
              evidenceRefs: ["M999:E01"],
            },
          ],
        },
        model: "test-model",
      }),
      save: (input) => {
        const evidence = input.payload.items[0]?.evidence[0];
        assert.equal(evidence?.validated, false);
        assert.equal(evidence?.reason, "invalid_evidence_ref");
        assert.equal(evidence?.messageId, null);
        assert.equal(input.payload.items[0]?.unsupportedClaim, true);
        return { id: "analysis-1" };
      },
    });
    assert.equal(result.ok, true);
  });
});

test("v3: Assistant 提案だけの Decision は unsupported", async () => {
  await withAnalyzeEnv(async () => {
    const result = await runAnalyzeSession("session-1", sampleMessages, {
      generateStructured: async () => ({
        parsed: {
          summary: "提案のみ",
          items: [
            {
              kind: "decision",
              text: "表を作ることにした",
              evidenceRefs: ["M002:E01"],
            },
          ],
        },
        model: "test-model",
      }),
      save: (input) => {
        assert.equal(input.payload.items[0]?.evidence[0]?.validated, true);
        assert.equal(input.payload.items[0]?.unsupportedClaim, true);
        return { id: "analysis-1" };
      },
    });
    assert.equal(result.ok, true);
  });
});

test("Case F: schema 不一致は DB へ保存しない", async () => {
  await withAnalyzeEnv(async () => {
    let saved = false;
    const result = await runAnalyzeSession("session-1", sampleMessages, {
      generateStructured: async () => ({
        parsed: { nope: true },
        model: "test-model",
      }),
      save: () => {
        saved = true;
        return { id: "analysis-1" };
      },
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "schema");
    }
    assert.equal(saved, false);
  });
});

test("Case G: API 失敗では save しない", async () => {
  await withAnalyzeEnv(async () => {
    let saved = false;
    const result = await runAnalyzeSession("session-1", sampleMessages, {
      generateStructured: async () => {
        throw new Error("network down");
      },
      save: () => {
        saved = true;
        return { id: "analysis-1" };
      },
    });
    assert.equal(result.ok, false);
    assert.equal(saved, false);
  });
});

test("Case H: 長すぎる Session は API へ送らない", async () => {
  await withAnalyzeEnv(async () => {
    let called = false;
    const huge = [
      message("msg-1", "user", "あ".repeat(ANALYZE_SESSION_MAX_INPUT_CHARS + 50)),
    ];
    const result = await runAnalyzeSession("session-1", huge, {
      generateStructured: async () => {
        called = true;
        return { parsed: validOutput, model: "test-model" };
      },
      save: () => ({ id: "analysis-1" }),
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "too_long");
    }
    assert.equal(called, false);
  });
});
