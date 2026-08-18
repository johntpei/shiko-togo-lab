import { getAiConfig } from "../config";
import { AnalyzeSessionError, userMessageForAnalyzeError } from "../errors";
import {
  CONTEXT_PACK_TIMEOUT_MS,
  MAX_PACK_CONFIRMED,
  MAX_PACK_HYPOTHESES,
  MAX_PACK_INSIGHTS,
  MAX_PACK_OPEN_QUESTIONS,
  MAX_PACK_TENSIONS,
  isContextPackSourceTooLong,
} from "../limits";
import {
  CONTEXT_PACK_PROMPT_VERSION,
  CONTEXT_PACK_SYSTEM_PROMPT,
  buildContextPackUserPrompt,
} from "../prompts/context-pack";
import type { AiProvider } from "../provider";
import { getAiProvider } from "../provider";
import {
  buildContextCandidates,
  buildContextPackTitle,
  candidateMap,
  formatContextCandidatesForAi,
  type ContextPackSessionSource,
} from "@/lib/context-pack/candidates";
import { renderContextPackMarkdown } from "@/lib/context-pack/render-markdown";
import {
  contextPackAiOutputSchema,
  defaultContextPackSettings,
  type StoredContextPackPayload,
} from "@/lib/context-pack/schema";
import {
  forceCurrentContext,
  resolveSourceRefs,
} from "@/lib/context-pack/validation";
import type { StoredReviewPayload } from "../review-schemas";

export type ContextPackResult =
  | { ok: true; contextPackId: string }
  | { ok: false; error: string; code: string };

export type ContextPackSaveInput = {
  title: string;
  currentQuestion: string;
  sourceReviewId: string;
  model: string;
  promptVersion: string;
  payload: StoredContextPackPayload;
  markdown: string;
  sessionIds: string[];
};

export type ContextPackDeps = {
  generateStructured: AiProvider["generateStructured"];
  save: (input: ContextPackSaveInput) => { id: string };
};

function sliceItems<T>(items: T[], max: number) {
  return items.slice(0, max);
}

export async function runContextPack(
  input: {
    reviewId: string;
    reviewPayload: StoredReviewPayload;
    sessions: ContextPackSessionSource[];
    currentQuestion: string;
  },
  deps: ContextPackDeps,
): Promise<ContextPackResult> {
  const config = getAiConfig();
  if (!config.apiKey) {
    return {
      ok: false,
      code: "not_configured",
      error: "OpenAI APIキーが設定されていません",
    };
  }
  if (config.provider !== "openai") {
    return {
      ok: false,
      code: "unsupported_provider",
      error: "未対応のAIプロバイダです",
    };
  }
  if (!config.model) {
    return {
      ok: false,
      code: "not_configured",
      error: "AI_MODEL が設定されていません",
    };
  }

  const currentQuestion = input.currentQuestion;
  const candidates = buildContextCandidates({
    reviewId: input.reviewId,
    reviewPayload: input.reviewPayload,
    sessions: input.sessions,
  });
  const labeled = formatContextCandidatesForAi(candidates);
  const userPrompt = buildContextPackUserPrompt({
    currentQuestion,
    labeledCandidates: labeled,
  });
  if (isContextPackSourceTooLong(userPrompt)) {
    return {
      ok: false,
      code: "too_long",
      error:
        "Context Packの候補情報が上限を超えています。別のReviewを選んでください。",
    };
  }

  let parsedUnknown: unknown;
  let usedModel = config.model;
  try {
    const generated = await deps.generateStructured({
      model: config.model,
      system: CONTEXT_PACK_SYSTEM_PROMPT,
      user: userPrompt,
      schema: contextPackAiOutputSchema,
      schemaName: "context_pack_v1",
      timeoutMs: CONTEXT_PACK_TIMEOUT_MS,
    });
    parsedUnknown = generated.parsed;
    usedModel = generated.model || config.model;
  } catch (error) {
    const mapped = userMessageForAnalyzeError(error);
    return { ok: false, code: mapped.code, error: mapped.error };
  }

  const parsed = contextPackAiOutputSchema.safeParse(parsedUnknown);
  if (!parsed.success) {
    return {
      ok: false,
      code: "schema",
      error: "分析結果の形式が不正だったため保存しませんでした。",
    };
  }

  const byRef = candidateMap(candidates);
  const selectedRefs = [
    ...parsed.data.currentState,
    ...parsed.data.confirmedContext,
    ...parsed.data.crossSessionInsights,
    ...parsed.data.tensions,
    ...parsed.data.hypotheses,
    ...parsed.data.openQuestions,
  ];
  const resolved = resolveSourceRefs(selectedRefs, byRef);
  const invalidSourceRefs = resolved.invalid;

  if (process.env.NODE_ENV !== "production") {
    for (const item of invalidSourceRefs) {
      console.info("context-pack invalid_source_ref", item);
    }
  }

  const byType = (types: string[]) =>
    resolved.items.filter((item) => types.includes(item.type));

  const selected: StoredContextPackPayload["selected"] = {
    currentState: forceCurrentContext(
      sliceItems(byType(["summary", "shift"]), 4),
      byRef,
    ),
    confirmedContext: sliceItems(
      byType(["decision", "user_fact"]),
      MAX_PACK_CONFIRMED,
    ),
    crossSessionInsights: sliceItems(
      byType(["insight", "theme"]),
      MAX_PACK_INSIGHTS,
    ),
    tensions: sliceItems(byType(["tension"]), MAX_PACK_TENSIONS),
    hypotheses: sliceItems(byType(["hypothesis"]), MAX_PACK_HYPOTHESES),
    openQuestions: sliceItems(
      byType(["open_question", "next_question"]),
      MAX_PACK_OPEN_QUESTIONS,
    ),
  };

  const markdown = renderContextPackMarkdown({
    currentQuestion,
    selected,
  });

  const sourceRefs = [
    ...selected.currentState,
    ...selected.confirmedContext,
    ...selected.crossSessionInsights,
    ...selected.tensions,
    ...selected.hypotheses,
    ...selected.openQuestions,
  ].map((item) => item.sourceRef);

  const payload: StoredContextPackPayload = {
    currentQuestion,
    selected,
    sourceRefs,
    invalidSourceRefs,
    settings: defaultContextPackSettings(config.provider),
  };

  try {
    const saved = deps.save({
      title: buildContextPackTitle(
        input.sessions.map((session) => session.occurredAt),
      ),
      currentQuestion,
      sourceReviewId: input.reviewId,
      model: usedModel,
      promptVersion: CONTEXT_PACK_PROMPT_VERSION,
      payload,
      markdown,
      sessionIds: input.sessions.map((session) => session.id),
    });
    return { ok: true, contextPackId: saved.id };
  } catch {
    console.error("context-pack save failed", { code: "save" });
    return {
      ok: false,
      code: "save",
      error: "Context Packの保存に失敗しました。元のReviewは変更していません。",
    };
  }
}

export async function createContextPack(input: {
  reviewId: string;
  reviewPayload: StoredReviewPayload;
  sessions: ContextPackSessionSource[];
  currentQuestion: string;
}): Promise<ContextPackResult> {
  const { insertContextPack } = await import("@/lib/db/queries");
  try {
    const provider = getAiProvider();
    return await runContextPack(input, {
      generateStructured: (request) => provider.generateStructured(request),
      save: insertContextPack,
    });
  } catch (error) {
    if (error instanceof AnalyzeSessionError) {
      return { ok: false, code: error.code, error: error.message };
    }
    console.error("context-pack failed");
    return {
      ok: false,
      code: "api",
      error: "Context Packの生成に失敗しました。元のReviewは変更していません。",
    };
  }
}
