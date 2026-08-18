import {
  currentProjectContext,
  type CurrentProjectContext,
} from "@/lib/app/current-context";
import type { StoredContextPackItem, StoredContextPackPayload } from "./schema";

export const CONTEXT_PACK_USAGE_INSTRUCTIONS = `以下は過去のAI対話と統合レビューから抽出した前提です。

* 「確認済み」と「AIによる横断的な解釈」と「仮説」を区別してください。
* 仮説を事実として扱わないでください。
* 新しい情報と矛盾する場合は、より新しい明示的なユーザー情報を優先してください。
* 過去の説明をむやみに繰り返さず、このContextを前提に対話を続けてください。`;

function bullet(text: string) {
  return `* ${text}`;
}

function nested(label: string, value: string) {
  return `  * ${label}：${value}`;
}

function renderCurrentPremise(
  items: StoredContextPackItem[],
  context: CurrentProjectContext,
) {
  const name =
    items.find((item) => item.sourceRef === "C:PROJECT_NAME")?.text ??
    context.projectName;
  const purpose =
    items.find((item) => item.sourceRef === "C:CORE_PURPOSE")?.text ??
    context.corePurpose;
  return [
    "## 現在の前提",
    "",
    bullet(`プロジェクト名：${name}`),
    bullet(`目的：${purpose}`),
  ].join("\n");
}

function renderShift(item: StoredContextPackItem) {
  const lines = [bullet(item.text)];
  if (item.before) {
    lines.push(nested("以前", item.before));
  }
  if (item.after) {
    lines.push(nested("現在", item.after));
  }
  return lines.join("\n");
}

function renderTension(item: StoredContextPackItem) {
  const lines = [bullet(item.text)];
  if (item.sideA) {
    lines.push(nested("A", item.sideA));
  }
  if (item.sideB) {
    lines.push(nested("B", item.sideB));
  }
  return lines.join("\n");
}

function renderHypothesis(item: StoredContextPackItem) {
  const lines = [bullet(`【仮説】${item.text}`)];
  if (item.rationale) {
    lines.push(nested("なぜそう考えられるか", item.rationale));
  }
  if (item.validationIdea) {
    lines.push(nested("検証案", item.validationIdea));
  }
  return lines.join("\n");
}

function renderInsight(item: StoredContextPackItem) {
  return [
    bullet(`【AIによる横断的な解釈】${item.text}`),
  ].join("\n");
}

function renderSection(title: string, body: string[]) {
  if (body.length === 0) {
    return [];
  }
  return ["", `## ${title}`, "", ...body];
}

export function renderContextPackMarkdown(input: {
  currentQuestion: string;
  selected: StoredContextPackPayload["selected"];
  currentContext?: CurrentProjectContext;
}) {
  const context = input.currentContext ?? currentProjectContext;
  const selected = input.selected;
  const currentStateWithoutContext = selected.currentState.filter(
    (item) => item.type !== "current_context",
  );

  const location = currentStateWithoutContext.map((item) =>
    item.type === "shift" ? renderShift(item) : bullet(item.text),
  );
  const confirmed = selected.confirmedContext.map((item) => bullet(item.text));
  const insights = selected.crossSessionInsights.map((item) => {
    if (item.type === "insight" || item.supportType === "cross_session_interpretation") {
      return renderInsight(item);
    }
    return bullet(item.text);
  });
  const tensions = selected.tensions.map(renderTension);
  const hypotheses = selected.hypotheses.map(renderHypothesis);
  const openQuestions = selected.openQuestions.map((item) => bullet(item.text));
  const question = input.currentQuestion.trim();

  const parts = [
    `# Context Pack｜${context.projectName}`,
    "",
    "## このコンテキストの扱い",
    "",
    CONTEXT_PACK_USAGE_INSTRUCTIONS,
    "",
    renderCurrentPremise(selected.currentState, context),
    ...renderSection("現在地", location),
    ...renderSection("これまでに確認された方針", confirmed),
    ...renderSection("複数Sessionから見えてきたこと", insights),
    ...renderSection("緊張関係・注意点", tensions),
    ...renderSection("仮説", hypotheses),
    ...renderSection("未解決の問い", openQuestions),
  ];

  if (question) {
    parts.push("", "## 今回相談したいこと", "", question);
  }

  return parts.filter((part, index, all) => {
    if (part !== "") {
      return true;
    }
    return all[index - 1] !== "";
  }).join("\n").trim() + "\n";
}
