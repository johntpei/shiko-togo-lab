import assert from "node:assert/strict";
import test from "node:test";
import {
  INTEGRATED_REVIEW_MAX_INPUT_CHARS,
  MAX_COMMON_THEMES,
  MAX_HYPOTHESES,
  MAX_NEXT_QUESTIONS,
} from "../limits";
import { INTEGRATED_REVIEW_PROMPT_VERSION } from "../prompts/integrated-review";
import type { ReviewSessionSource } from "../review-input";
import { runIntegratedReview } from "./integrated-review";

function message(id: string, role: string, content: string) {
  return { id, role, content, attachmentsJson: null };
}

function source(
  id: string,
  title: string,
  occurredAt: string,
  messages: ReturnType<typeof message>[],
): ReviewSessionSource {
  return {
    session: {
      id,
      title,
      occurredAt,
      source: "chatgpt",
      category: "制作",
      createdAt: `${occurredAt}T00:00:00.000Z`,
    },
    messages,
    analysis: null,
  };
}

const twoSessions = [
  source("s1", "Session A", "2026-07-18", [
    message("u1", "user", "自由に考えたいです。枠がない方が深い対話になります。"),
    message("a1", "assistant", "KnowledgeをMVPに含めるのがおすすめです。"),
  ]),
  source("s2", "Session B", "2026-08-02", [
    message("u2", "user", "外部締切がある方が動きやすいです。自分で期限を置きたいです。"),
    message("a2", "assistant", "KnowledgeはVersion 2へ回すのが良いと思います。"),
  ]),
];

const validOutput = {
  summary: "仕組みの話が増えている。",
  commonThemes: [
    {
      text: "仕組みに価値を置く方向が繰り返されている。",
      evidenceRefs: ["S01:M001:E01", "S02:M001:E01"],
    },
  ],
  shifts: [
    {
      before: "自由に考えたい",
      after: "締切があると動きやすい",
      interpretation: "制約の捉え方が変化している。",
      beforeEvidenceRefs: ["S01:M001:E01"],
      afterEvidenceRefs: ["S02:M001:E01"],
    },
  ],
  tensions: [
    {
      text: "自由と締切は両立条件を考えるポイントになる。",
      evidenceRefs: ["S01:M001:E01", "S02:M001:E01"],
    },
  ],
  crossInsights: [
    {
      text: "これらのSessionを合わせると、運用の設計が主題になっている。",
      evidenceRefs: ["S01:M001:E01", "S02:M001:E01"],
    },
  ],
  hypotheses: [
    {
      text: "期限を自分で選べると動きやすい可能性がある。",
      rationale: "自由と締切の両方を本人が述べているため。",
      validationIdea:
        "締切を自分で置いた週と置かなかった週で、実際に進んだ作業量を比較する。",
      evidenceRefs: ["S01:M001:E01", "S02:M001:E01"],
    },
  ],
  openQuestions: [
    {
      text: "自動化と本人判断の境界をどこに置くか？",
      evidenceRefs: [],
    },
  ],
  nextQuestions: [
    { text: "問い1", evidenceRefs: [] },
    { text: "問い2", evidenceRefs: [] },
    { text: "問い3", evidenceRefs: [] },
    { text: "問い4", evidenceRefs: [] },
    { text: "問い5", evidenceRefs: [] },
  ],
};

async function withReviewEnv(run: () => Promise<void>) {
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

test("Case A: 2 Session 選択なら Review 可能", async () => {
  await withReviewEnv(async () => {
    let called = false;
    const result = await runIntegratedReview(twoSessions, "統合レビュー — テスト", {
      generateStructured: async (request) => {
        called = true;
        assert.equal(request.schemaName, "integrated_review_v4");
        const contextIdx = request.user.indexOf("CURRENT CONTEXT");
        const sessionIdx = request.user.indexOf("SESSION S01");
        assert.ok(contextIdx >= 0 && sessionIdx > contextIdx);
        assert.match(request.user, /思考統合研究所/);
        assert.match(request.user, /Core Purpose:/);
        assert.doesNotMatch(request.user, /選んでいないSession/);
        return { parsed: validOutput, model: "returned-model" };
      },
      save: (input) => {
        assert.equal(input.promptVersion, INTEGRATED_REVIEW_PROMPT_VERSION);
        assert.equal(input.model, "returned-model");
        assert.equal(input.payload.commonThemes[0]?.semanticValid, true);
        assert.equal(input.payload.shifts[0]?.semanticValid, true);
        assert.equal(
          input.payload.hypotheses[0]?.rationale,
          "自由と締切の両方を本人が述べているため。",
        );
        assert.match(
          input.payload.hypotheses[0]?.validationIdea ?? "",
          /締切を自分で置いた週/,
        );
        assert.equal(input.payload.crossInsights[0]?.supportType, "cross_session_interpretation");
        assert.equal(input.payload.hypotheses[0]?.supportType, "hypothesis");
        assert.equal(input.payload.shifts[0]?.supportType, "direct");
        assert.equal(input.payload.shifts[0]?.guardType, "hard");
        assert.equal(input.sessionIds.includes("s1"), true);
        assert.equal(input.sessionIds.includes("s2"), true);
        return { id: "review-1" };
      },
    });
    assert.equal(called, true);
    assert.equal(result.ok, true);
  });
});

test("Case B: 1 Session のみでは Review 不可で API を呼ばない", async () => {
  await withReviewEnv(async () => {
    let called = false;
    const result = await runIntegratedReview(
      [twoSessions[0]!],
      "統合レビュー — テスト",
      {
        generateStructured: async () => {
          called = true;
          return { parsed: validOutput, model: "test-model" };
        },
        save: () => ({ id: "review-1" }),
      },
    );
    assert.equal(called, false);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "too_few_sessions");
    }
  });
});

test("Case L: 入力上限超過では API を呼ばない", async () => {
  await withReviewEnv(async () => {
    let called = false;
    const huge = "あ".repeat(INTEGRATED_REVIEW_MAX_INPUT_CHARS);
    const result = await runIntegratedReview(
      [
        source("s1", "巨大A", "2026-07-18", [message("u1", "user", huge)]),
        source("s2", "巨大B", "2026-08-02", [message("u2", "user", huge)]),
      ],
      "統合レビュー — テスト",
      {
        generateStructured: async () => {
          called = true;
          return { parsed: validOutput, model: "test-model" };
        },
        save: () => ({ id: "review-1" }),
      },
    );
    assert.equal(called, false);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "too_long");
    }
  });
});

test("Case M: nextQuestions は最大3件", async () => {
  await withReviewEnv(async () => {
    const result = await runIntegratedReview(twoSessions, "統合レビュー — テスト", {
      generateStructured: async () => ({ parsed: validOutput, model: "test-model" }),
      save: (input) => {
        assert.equal(input.payload.nextQuestions.length, MAX_NEXT_QUESTIONS);
        assert.equal(input.payload.nextQuestions[2]?.text, "問い3");
        return { id: "review-1" };
      },
    });
    assert.equal(result.ok, true);
  });
});

test("1 Session だけの commonTheme は保存されるが semantic invalid", async () => {
  await withReviewEnv(async () => {
    const result = await runIntegratedReview(twoSessions, "統合レビュー — テスト", {
      generateStructured: async () => ({
        parsed: {
          ...validOutput,
          commonThemes: [
            {
              text: "1 Sessionだけのテーマ",
              evidenceRefs: ["S01:M001:E01"],
            },
          ],
        },
        model: "test-model",
      }),
      save: (input) => {
        assert.equal(input.payload.commonThemes[0]?.kind, undefined);
        assert.equal(input.payload.commonThemes[0]?.semanticValid, false);
        assert.equal(
          input.payload.commonThemes[0]?.invalidReason,
          "insufficient_distinct_sessions",
        );
        return { id: "review-1" };
      },
    });
    assert.equal(result.ok, true);
  });
});

test("存在しない EvidenceRef は semantic invalid のまま保存しカテゴリを変えない", async () => {
  await withReviewEnv(async () => {
    const result = await runIntegratedReview(twoSessions, "統合レビュー — テスト", {
      generateStructured: async () => ({
        parsed: {
          ...validOutput,
          crossInsights: [
            {
              text: "不正参照",
              evidenceRefs: ["S09:M001:E01"],
            },
          ],
        },
        model: "test-model",
      }),
      save: (input) => {
        assert.equal(input.payload.crossInsights[0]?.semanticValid, false);
        assert.equal(
          input.payload.crossInsights[0]?.invalidReason,
          "invalid_evidence_ref",
        );
        return { id: "review-1" };
      },
    });
    assert.equal(result.ok, true);
  });
});

test("Case J: hypotheses が空でも保存できる", async () => {
  await withReviewEnv(async () => {
    const result = await runIntegratedReview(twoSessions, "統合レビュー — テスト", {
      generateStructured: async () => ({
        parsed: {
          ...validOutput,
          hypotheses: [],
        },
        model: "test-model",
      }),
      save: (input) => {
        assert.equal(input.payload.hypotheses.length, 0);
        return { id: "review-1" };
      },
    });
    assert.equal(result.ok, true);
  });
});

test("v3: commonThemes は最大3件", async () => {
  await withReviewEnv(async () => {
    const result = await runIntegratedReview(twoSessions, "統合レビュー — テスト", {
      generateStructured: async () => ({
        parsed: {
          ...validOutput,
          commonThemes: [1, 2, 3, 4].map((n) => ({
            text: `テーマ${n}`,
            evidenceRefs: ["S01:M001:E01", "S02:M001:E01"],
          })),
        },
        model: "test-model",
      }),
      save: (input) => {
        assert.equal(input.payload.commonThemes.length, MAX_COMMON_THEMES);
        return { id: "review-1" };
      },
    });
    assert.equal(result.ok, true);
  });
});

test("v3: hypotheses は最大2件", async () => {
  await withReviewEnv(async () => {
    const result = await runIntegratedReview(twoSessions, "統合レビュー — テスト", {
      generateStructured: async () => ({
        parsed: {
          ...validOutput,
          hypotheses: [1, 2, 3].map((n) => ({
            text: `仮説${n}`,
            rationale: "根拠があるため。",
            validationIdea: `比較${n}で確認する。`,
            evidenceRefs: ["S01:M001:E01", "S02:M001:E01"],
          })),
        },
        model: "test-model",
      }),
      save: (input) => {
        assert.equal(input.payload.hypotheses.length, MAX_HYPOTHESES);
        return { id: "review-1" };
      },
    });
    assert.equal(result.ok, true);
  });
});

test("Case F: hypothesis に validationIdea が無いと保存しない", async () => {
  await withReviewEnv(async () => {
    let saved = false;
    const result = await runIntegratedReview(twoSessions, "統合レビュー — テスト", {
      generateStructured: async () => ({
        parsed: {
          ...validOutput,
          hypotheses: [
            {
              text: "検証方法のない仮説",
              rationale: "根拠があるように見えるため。",
              evidenceRefs: ["S01:M001:E01", "S02:M001:E01"],
            },
          ],
        },
        model: "test-model",
      }),
      save: () => {
        saved = true;
        return { id: "review-1" };
      },
    });
    assert.equal(result.ok, false);
    assert.equal(saved, false);
  });
});

test("v3: hypothesis に rationale が無いと保存しない", async () => {
  await withReviewEnv(async () => {
    let saved = false;
    const result = await runIntegratedReview(twoSessions, "統合レビュー — テスト", {
      generateStructured: async () => ({
        parsed: {
          ...validOutput,
          hypotheses: [
            {
              text: "飛躍した仮説",
              evidenceRefs: ["S01:M001:E01", "S02:M001:E01"],
            },
          ],
        },
        model: "test-model",
      }),
      save: () => {
        saved = true;
        return { id: "review-1" };
      },
    });
    assert.equal(result.ok, false);
    assert.equal(saved, false);
  });
});

test("Case C: 顧客獲得への飛躍 Cross Insight は Hard Guard で除外", async () => {
  await withReviewEnv(async () => {
    const result = await runIntegratedReview(twoSessions, "統合レビュー — テスト", {
      generateStructured: async () => ({
        parsed: {
          ...validOutput,
          crossInsights: [
            {
              text: "このサービスは顧客獲得増加につながる。",
              evidenceRefs: ["S01:M001:E01", "S02:M001:E01"],
            },
          ],
        },
        model: "test-model",
      }),
      save: (input) => {
        assert.equal(input.payload.crossInsights[0]?.semanticValid, false);
        assert.equal(input.payload.crossInsights[0]?.invalidReason, "domain_leap");
        assert.equal(input.payload.crossInsights[0]?.guardType, "hard");
        return { id: "review-1" };
      },
    });
    assert.equal(result.ok, true);
  });
});

test("Case J: Cross Insight と Common Theme が実質同じなら重複除外", async () => {
  await withReviewEnv(async () => {
    const result = await runIntegratedReview(twoSessions, "統合レビュー — テスト", {
      generateStructured: async () => ({
        parsed: {
          ...validOutput,
          commonThemes: [
            {
              text: "人間側の運用設計が繰り返し重要視されている。",
              evidenceRefs: ["S01:M001:E01", "S02:M001:E01"],
            },
          ],
          crossInsights: [
            {
              text: "人間側の運用設計が繰り返し重要視されている。",
              evidenceRefs: ["S01:M001:E01", "S02:M001:E01"],
            },
          ],
        },
        model: "test-model",
      }),
      save: (input) => {
        assert.equal(input.payload.commonThemes[0]?.semanticValid, true);
        assert.equal(input.payload.crossInsights[0]?.semanticValid, false);
        assert.equal(
          input.payload.crossInsights[0]?.invalidReason,
          "duplicate_interpretation",
        );
        return { id: "review-1" };
      },
    });
    assert.equal(result.ok, true);
  });
});

test("Case G / H: 弱い Next Question は除外し、境界の問いは残す", async () => {
  await withReviewEnv(async () => {
    const result = await runIntegratedReview(twoSessions, "統合レビュー — テスト", {
      generateStructured: async () => ({
        parsed: {
          ...validOutput,
          nextQuestions: [
            { text: "次のステップは何か？", evidenceRefs: [] },
            {
              text: "自動化と本人判断の境界をどこに置くべきか？",
              evidenceRefs: [],
            },
          ],
        },
        model: "test-model",
      }),
      save: (input) => {
        assert.equal(input.payload.nextQuestions[0]?.semanticValid, false);
        assert.equal(
          input.payload.nextQuestions[0]?.invalidReason,
          "weak_next_question",
        );
        assert.equal(input.payload.nextQuestions[1]?.semanticValid, true);
        return { id: "review-1" };
      },
    });
    assert.equal(result.ok, true);
  });
});
