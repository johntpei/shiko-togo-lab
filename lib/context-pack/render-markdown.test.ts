import assert from "node:assert/strict";
import test from "node:test";
import { renderContextPackMarkdown } from "./render-markdown";
import type { StoredContextPackPayload } from "./schema";

function selected(
  override: Partial<StoredContextPackPayload["selected"]> = {},
): StoredContextPackPayload["selected"] {
  return {
    currentState: [
      {
        sourceRef: "C:PROJECT_NAME",
        type: "current_context",
        text: "思考統合研究所",
        supportType: "confirmed",
      },
      {
        sourceRef: "C:CORE_PURPOSE",
        type: "current_context",
        text: "知見を次の対話へ再利用できるようにする。",
        supportType: "confirmed",
      },
    ],
    confirmedContext: [],
    crossSessionInsights: [],
    tensions: [],
    hypotheses: [],
    openQuestions: [],
    ...override,
  };
}

test("Case B: currentQuestion は原文のまま Markdown に入る", () => {
  const question = "専用ツール独自の価値をどう作るか相談したい";
  const markdown = renderContextPackMarkdown({
    currentQuestion: question,
    selected: selected(),
  });
  assert.match(markdown, /## 今回相談したいこと/);
  assert.match(markdown, /専用ツール独自の価値をどう作るか相談したい/);
});

test("Case C: 選択したCandidate.textがMarkdownへ入る", () => {
  const markdown = renderContextPackMarkdown({
    currentQuestion: "",
    selected: selected({
      crossSessionInsights: [
        {
          sourceRef: "R:INSIGHT:01",
          type: "insight",
          text: "ボトルネックが人間側の知見管理へ移っている。",
          supportType: "cross_session_interpretation",
        },
      ],
    }),
  });
  assert.match(markdown, /ボトルネックが人間側の知見管理へ移っている。/);
});

test("Case F: Hypothesis は仮説ラベルを維持する", () => {
  const markdown = renderContextPackMarkdown({
    currentQuestion: "",
    selected: selected({
      hypotheses: [
        {
          sourceRef: "R:HYPOTHESIS:01",
          type: "hypothesis",
          text: "自分で期限を置くと進みやすい可能性がある。",
          supportType: "hypothesis",
          validationIdea: "置いた週と比較する。",
        },
      ],
    }),
  });
  assert.match(markdown, /【仮説】自分で期限を置くと進みやすい可能性がある。/);
  assert.match(markdown, /検証案：置いた週と比較する。/);
});

test("Case G: Cross Insight は横断的解釈として残る", () => {
  const markdown = renderContextPackMarkdown({
    currentQuestion: "",
    selected: selected({
      crossSessionInsights: [
        {
          sourceRef: "R:INSIGHT:01",
          type: "insight",
          text: "ボトルネックが人間側へ移っている。",
          supportType: "cross_session_interpretation",
        },
      ],
    }),
  });
  assert.match(markdown, /【AIによる横断的な解釈】/);
});

test("Case H: プロジェクト名 思考統合研究所 が入る", () => {
  const markdown = renderContextPackMarkdown({
    currentQuestion: "",
    selected: selected(),
  });
  assert.match(markdown, /プロジェクト名：思考統合研究所/);
});

test("Case N: コピー用Markdownに内部SourceRefを出さない", () => {
  const markdown = renderContextPackMarkdown({
    currentQuestion: "",
    selected: selected({
      crossSessionInsights: [
        {
          sourceRef: "R:INSIGHT:01",
          type: "insight",
          text: "人間側の知見管理がボトルネック。",
          supportType: "cross_session_interpretation",
        },
      ],
    }),
  });
  assert.doesNotMatch(markdown, /R:INSIGHT:01/);
  assert.doesNotMatch(markdown, /C:PROJECT_NAME/);
});

test("Case O: 空Sectionは出力しない", () => {
  const markdown = renderContextPackMarkdown({
    currentQuestion: "",
    selected: selected(),
  });
  assert.doesNotMatch(markdown, /## 仮説/);
  assert.doesNotMatch(markdown, /## 緊張関係/);
  assert.doesNotMatch(markdown, /## 今回相談したいこと/);
});
