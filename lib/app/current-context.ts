/**
 * MVP の現在状態。巨大な Memory ではなく、1か所の設定として持つ。
 * 将来 DB 化・自動更新しても、この型と formatCurrentContextBlock を再利用できる。
 */
export type CurrentProjectContext = {
  projectName: string;
  corePurpose: string;
  currentGoal?: string;
  currentMvpScope?: string;
  adoptedDecisions?: readonly string[];
  deprecatedDecisions?: readonly string[];
  currentTools?: readonly string[];
};

export const CORE_PURPOSE =
  "AIとの対話から得た知見を取りこぼさず、複数の対話をつなぎ、次のAI対話へ再利用できるようにする。";

export const currentProjectContext: CurrentProjectContext = {
  projectName: "思考統合研究所",
  corePurpose: CORE_PURPOSE,
};

function optionalLines(label: string, value: string | undefined) {
  if (!value) {
    return [];
  }
  return ["", `${label}:`, value];
}

function optionalList(label: string, values: readonly string[] | undefined) {
  if (!values || values.length === 0) {
    return [];
  }
  return ["", `${label}:`, ...values.map((value) => `- ${value}`)];
}

/**
 * Review AI 入力用の CURRENT CONTEXT。Evidence ではない。
 */
export function formatCurrentContextBlock(
  context: CurrentProjectContext = currentProjectContext,
) {
  return [
    "====================",
    "CURRENT CONTEXT",
    "===============",
    "",
    "Project Name:",
    context.projectName,
    "",
    "Canonical:",
    "true",
    "",
    "Core Purpose:",
    context.corePurpose,
    "",
    "Instruction:",
    "This is the current canonical project name.",
    "Historical project names appearing in Sessions are historical context only.",
    "Do not use them as the current project name unless a newer explicit user decision changes this context.",
    "Current Context and Core Purpose are not Evidence. Do not cite them as EvidenceRef or invent a Shift or Cross Insight from them alone.",
    "Priority: Current Context > newer explicit USER Decision > older USER Decision > Assistant suggestion.",
    "Assistant suggestions alone must not change Current State.",
    ...optionalLines("Current Goal", context.currentGoal),
    ...optionalLines("Current MVP Scope", context.currentMvpScope),
    ...optionalList("Adopted Decisions", context.adoptedDecisions),
    ...optionalList("Deprecated Decisions", context.deprecatedDecisions),
    ...optionalList("Current Tools", context.currentTools),
  ].join("\n");
}
