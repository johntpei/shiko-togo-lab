import assert from "node:assert/strict";
import test from "node:test";
import { INTEGRATED_REVIEW_MAX_INPUT_CHARS } from "../limits";
import { CONTEXT_PACK_PROMPT_VERSION } from "../prompts/context-pack";
import type { StoredReviewPayload } from "../review-schemas";
import { runContextPack } from "./context-pack";

const reviewPayload: StoredReviewPayload = {
  summary: "運用の設計が主題になっている。",
  commonThemes: [
    {
      text: "人間側の整理が繰り返されている。",
      evidence: [],
      semanticValid: true,
      supportType: "cross_session_interpretation",
    },
    {
      text: "除外テーマ",
      evidence: [],
      semanticValid: false,
      invalidReason: "insufficient_distinct_sessions",
    },
  ],
  shifts: [],
  tensions: [
    {
      text: "自動化と本人判断の境界が必要。",
      evidence: [],
      semanticValid: true,
      supportType: "cross_session_interpretation",
      sideA: { text: "自動化したい", evidence: [] },
      sideB: { text: "判断を残したい", evidence: [] },
    },
  ],
  crossInsights: [
    {
      text: "ボトルネックが人間側の知見管理へ移っている。",
      evidence: [],
      semanticValid: true,
      supportType: "cross_session_interpretation",
    },
  ],
  hypotheses: [
    {
      text: "自分で期限を置くと進みやすい可能性がある。",
      evidence: [],
      semanticValid: true,
      supportType: "hypothesis",
      rationale: "両方を述べているため。",
      validationIdea: "週ごとに比較する。",
    },
  ],
  openQuestions: [],
  nextQuestions: [],
  settings: {
    provider: "openai",
    store: false,
    maxInputChars: INTEGRATED_REVIEW_MAX_INPUT_CHARS,
  },
};

const sessions = [
  {
    id: "s1",
    title: "Session A",
    occurredAt: "2026-07-18",
    analysis: null,
  },
  {
    id: "s2",
    title: "Session B",
    occurredAt: "2026-08-02",
    analysis: null,
  },
];

async function withEnv(run: () => Promise<void>) {
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

const selectedRefs = {
  currentState: ["C:PROJECT_NAME", "C:CORE_PURPOSE", "R:SUMMARY"],
  confirmedContext: [],
  crossSessionInsights: ["R:INSIGHT:01", "R:THEME:01"],
  tensions: ["R:TENSION:01"],
  hypotheses: ["R:HYPOTHESIS:01"],
  openQuestions: [],
};

test("Case P: APIキーなしでは生成せず保存しない", async () => {
  const prevKey = process.env.OPENAI_API_KEY;
  const prevModel = process.env.AI_MODEL;
  delete process.env.OPENAI_API_KEY;
  process.env.AI_MODEL = "test-model";
  try {
    let called = false;
    let saved = false;
    const result = await runContextPack(
      {
        reviewId: "review-1",
        reviewPayload,
        sessions,
        currentQuestion: "相談したい",
      },
      {
        generateStructured: async () => {
          called = true;
          return { parsed: selectedRefs, model: "test-model" };
        },
        save: () => {
          saved = true;
          return { id: "pack-1" };
        },
      },
    );
    assert.equal(called, false);
    assert.equal(saved, false);
    assert.equal(result.ok, false);
  } finally {
    restore("OPENAI_API_KEY", prevKey);
    restore("AI_MODEL", prevModel);
  }
});

test("Case A / B / C / F / G / H / K / L / M: 検証済みRefからPackを保存する", async () => {
  await withEnv(async () => {
    const question = "専用ツール独自の価値をどう作るか相談したい";
    const result = await runContextPack(
      {
        reviewId: "review-1",
        reviewPayload,
        sessions,
        currentQuestion: question,
      },
      {
        generateStructured: async (request) => {
          assert.equal(request.schemaName, "context_pack_v1");
          assert.match(request.user, /専用ツール独自の価値をどう作るか相談したい/);
          assert.doesNotMatch(request.user, /SESSION S01/);
          assert.doesNotMatch(request.user, /除外テーマ/);
          return { parsed: selectedRefs, model: "returned-model" };
        },
        save: (input) => {
          assert.equal(input.sourceReviewId, "review-1");
          assert.equal(input.currentQuestion, question);
          assert.equal(input.promptVersion, CONTEXT_PACK_PROMPT_VERSION);
          assert.equal(input.model, "returned-model");
          assert.deepEqual(input.sessionIds, ["s1", "s2"]);
          assert.match(input.markdown, /専用ツール独自の価値をどう作るか相談したい/);
          assert.match(input.markdown, /思考統合研究所/);
          assert.match(input.markdown, /【仮説】/);
          assert.match(input.markdown, /【AIによる横断的な解釈】/);
          assert.match(input.markdown, /ボトルネックが人間側の知見管理へ移っている。/);
          assert.doesNotMatch(input.markdown, /R:INSIGHT:01/);
          assert.doesNotMatch(input.markdown, /除外テーマ/);
          assert.equal(input.payload.currentQuestion, question);
          return { id: "pack-1" };
        },
      },
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.contextPackId, "pack-1");
    }
  });
});

test("Case D: 存在しないSourceRefはMarkdownに入らない", async () => {
  await withEnv(async () => {
    const result = await runContextPack(
      {
        reviewId: "review-1",
        reviewPayload,
        sessions,
        currentQuestion: "",
      },
      {
        generateStructured: async () => ({
          parsed: {
            ...selectedRefs,
            crossSessionInsights: ["R:INSIGHT:01", "R:INSIGHT:99"],
          },
          model: "test-model",
        }),
        save: (input) => {
          assert.equal(
            input.payload.invalidSourceRefs?.some(
              (item) => item.ref === "R:INSIGHT:99",
            ),
            true,
          );
          assert.doesNotMatch(input.markdown, /R:INSIGHT:99/);
          assert.match(input.markdown, /ボトルネックが人間側の知見管理へ移っている。/);
          return { id: "pack-1" };
        },
      },
    );
    assert.equal(result.ok, true);
  });
});

test("Case K: currentQuestionなしでも保存できる", async () => {
  await withEnv(async () => {
    const result = await runContextPack(
      {
        reviewId: "review-1",
        reviewPayload,
        sessions,
        currentQuestion: "",
      },
      {
        generateStructured: async (request) => {
          assert.match(request.user, /汎用Context Pack/);
          return { parsed: selectedRefs, model: "test-model" };
        },
        save: (input) => {
          assert.equal(input.currentQuestion, "");
          assert.doesNotMatch(input.markdown, /## 今回相談したいこと/);
          return { id: "pack-1" };
        },
      },
    );
    assert.equal(result.ok, true);
  });
});
