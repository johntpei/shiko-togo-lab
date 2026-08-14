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
  message("msg-2", "assistant", "記録用の表を作りましょうか。続けると定着しやすいです。"),
];

const validOutput = {
  summary: "歩行習慣について決めた。",
  items: [
    {
      kind: "decision" as const,
      subject: "user" as const,
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

test("v4: EvidenceRef から原文 quote をサーバーが確定する", async () => {
  await withAnalyzeEnv(async () => {
    let systemPrompt = "";
    let schemaName = "";
    const result = await runAnalyzeSession("session-1", sampleMessages, {
      generateStructured: async (request) => {
        systemPrompt = request.system;
        schemaName = request.schemaName;
        return { parsed: validOutput, model: "returned-model" };
      },
      save: (input) => {
        const item = input.payload.items[0];
        const evidence = item?.evidence[0];
        assert.equal(input.promptVersion, "analyze-session-v4");
        assert.equal(item?.subject, "user");
        assert.equal(item?.semanticValid, true);
        assert.equal(evidence?.validated, true);
        assert.equal(evidence?.quote, "来週から週3回歩くことにします。");
        assert.equal(evidence?.messageId, "msg-1");
        assert.equal(evidence?.role, "user");
        assert.equal(input.payload.metrics?.validationRate, 1);
        assert.equal(input.payload.metrics?.semanticValidationRate, 1);
        return { id: "analysis-1" };
      },
    });
    assert.equal(result.ok, true);
    assert.equal(schemaName, "session_analysis_v4");
    assert.match(systemPrompt, /USER Evidence が無ければ Decision を絶対に生成しない/);
    assert.equal(ANALYZE_SESSION_PROMPT_VERSION, "analyze-session-v4");
  });
});

test("v4: 存在しない EvidenceRef は Evidence / Semantic ともに成立しない", async () => {
  await withAnalyzeEnv(async () => {
    const result = await runAnalyzeSession("session-1", sampleMessages, {
      generateStructured: async () => ({
        parsed: {
          summary: "参照ミス",
          items: [
            {
              kind: "fact",
              subject: "conversation",
              text: "不明な参照",
              evidenceRefs: ["M999:E01"],
            },
          ],
        },
        model: "test-model",
      }),
      save: (input) => {
        const item = input.payload.items[0];
        const evidence = item?.evidence[0];
        assert.equal(evidence?.validated, false);
        assert.equal(evidence?.reason, "invalid_evidence_ref");
        assert.equal(item?.semanticValid, false);
        assert.equal(item?.invalidReason, "invalid_evidence_ref");
        assert.equal(item?.kind, "fact");
        return { id: "analysis-1" };
      },
    });
    assert.equal(result.ok, true);
  });
});

test("v4: Assistant 提案だけの Decision は semantic invalid のまま保存し kind を変えない", async () => {
  await withAnalyzeEnv(async () => {
    const result = await runAnalyzeSession("session-1", sampleMessages, {
      generateStructured: async () => ({
        parsed: {
          summary: "提案のみ",
          items: [
            {
              kind: "decision",
              subject: "user",
              text: "表を作ることにした",
              evidenceRefs: ["M002:E01"],
            },
          ],
        },
        model: "test-model",
      }),
      save: (input) => {
        const item = input.payload.items[0];
        assert.equal(item?.kind, "decision");
        assert.equal(item?.evidence[0]?.validated, true);
        assert.equal(item?.semanticValid, false);
        assert.equal(item?.invalidReason, "evidence_role_mismatch");
        assert.equal(input.payload.metrics?.semanticValidCount, 0);
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

test("v4: subject が無い出力は schema 不一致として保存しない", async () => {
  await withAnalyzeEnv(async () => {
    let saved = false;
    const result = await runAnalyzeSession("session-1", sampleMessages, {
      generateStructured: async () => ({
        parsed: {
          summary: "subjectなし",
          items: [
            {
              kind: "decision",
              text: "週3回歩く",
              evidenceRefs: ["M001:E01"],
            },
          ],
        },
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
