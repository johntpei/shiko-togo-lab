import { getAiConfig } from "../config";
import { AnalyzeSessionError, userMessageForAnalyzeError } from "../errors";
import { isV3UnsupportedClaim, resolveEvidenceRefs } from "../evidence-refs";
import { computeEvidenceStats } from "../evidence";
import { isAnalyzeInputTooLong } from "../limits";
import {
  ANALYZE_SESSION_PROMPT_VERSION,
  ANALYZE_SESSION_SYSTEM_PROMPT,
  buildAnalyzeSessionUserPrompt,
} from "../prompts/analyze-session";
import type { AiProvider } from "../provider";
import { getAiProvider } from "../provider";
import {
  defaultAnalysisSettings,
  sessionAnalysisV4OutputSchema,
  type StoredAnalysisPayload,
} from "../schemas";
import {
  computeSemanticStats,
  validateSemanticSupport,
} from "../semantic-support";
import {
  buildEvidenceAnalyzeInput,
  type AnalyzeMessage,
} from "../session-input";

export type AnalyzeSessionResult =
  | { ok: true; analysisId: string }
  | { ok: false; error: string; code: string };

export type AnalyzeSessionSaveInput = {
  sessionId: string;
  model: string;
  promptVersion: string;
  payload: StoredAnalysisPayload;
  evidences: Array<{
    messageId: string;
    quote: string;
    validated: boolean;
  }>;
};

export type AnalyzeSessionDeps = {
  generateStructured: AiProvider["generateStructured"];
  save: (input: AnalyzeSessionSaveInput) => { id: string };
};

export async function runAnalyzeSession(
  sessionId: string,
  messages: AnalyzeMessage[],
  deps: AnalyzeSessionDeps,
): Promise<AnalyzeSessionResult> {
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

  const input = buildEvidenceAnalyzeInput(messages);
  if (input.analyzableCount === 0) {
    return {
      ok: false,
      code: "no_messages",
      error: "分析できる User / Assistant の発言がありません。",
    };
  }
  if (isAnalyzeInputTooLong(input.labeledTranscript)) {
    return {
      ok: false,
      code: "too_long",
      error: "このSessionは現在のMVPで分析できる上限を超えています",
    };
  }

  let parsedUnknown: unknown;
  let usedModel = config.model;
  try {
    const generated = await deps.generateStructured({
      model: config.model,
      system: ANALYZE_SESSION_SYSTEM_PROMPT,
      user: buildAnalyzeSessionUserPrompt(input.labeledTranscript),
      schema: sessionAnalysisV4OutputSchema,
      schemaName: "session_analysis_v4",
    });
    parsedUnknown = generated.parsed;
    usedModel = generated.model || config.model;
  } catch (error) {
    const mapped = userMessageForAnalyzeError(error);
    return { ok: false, ...mapped };
  }

  const parsed = sessionAnalysisV4OutputSchema.safeParse(parsedUnknown);
  if (!parsed.success) {
    return {
      ok: false,
      code: "schema",
      error: "分析結果の形式が不正だったため保存しませんでした。",
    };
  }

  const items = parsed.data.items.map((item) => {
    const evidence = resolveEvidenceRefs(
      item.evidenceRefs,
      input.unitsByRef,
      input.contentByMessageId,
    );
    const semantic = validateSemanticSupport(
      {
        kind: item.kind,
        subject: item.subject,
        evidenceRefs: item.evidenceRefs,
      },
      input.unitsByRef,
      evidence,
    );
    return {
      kind: item.kind,
      subject: item.subject,
      text: item.text,
      evidence,
      semanticValid: semantic.valid,
      invalidReason: semantic.reason,
      unsupportedClaim: isV3UnsupportedClaim(
        item.kind,
        evidence,
        input.unitsByRef,
      ),
    };
  });

  if (process.env.NODE_ENV !== "production") {
    for (const item of items) {
      for (const evidence of item.evidence) {
        if (evidence.validated || evidence.reason == null) {
          continue;
        }
        console.info("analyze-session evidence invalid", {
          kind: item.kind,
          messageRef: evidence.messageRef,
          reason: evidence.reason,
        });
      }
      if (item.semanticValid === false) {
        console.info("analyze-session semantic_support_failed", {
          kind: item.kind,
          subject: item.subject,
          reason: item.invalidReason,
        });
      }
    }
  }

  const payload: StoredAnalysisPayload = {
    summary: parsed.data.summary,
    items,
    settings: defaultAnalysisSettings(config.provider),
    metrics: {
      ...computeEvidenceStats(items),
      ...computeSemanticStats(items),
    },
  };

  const evidences = items.flatMap((item) =>
    item.evidence.flatMap((evidence) => {
      if (!evidence.messageId) {
        return [];
      }
      return [
        {
          messageId: evidence.messageId,
          quote: evidence.quote,
          validated: evidence.validated,
        },
      ];
    }),
  );

  try {
    const saved = deps.save({
      sessionId,
      model: usedModel,
      promptVersion: ANALYZE_SESSION_PROMPT_VERSION,
      payload,
      evidences,
    });
    return { ok: true, analysisId: saved.id };
  } catch {
    console.error("analyze-session save failed", {
      sessionId,
      code: "save",
    });
    return {
      ok: false,
      code: "save",
      error: "分析結果の保存に失敗しました。Sessionの原文と発言は変更していません。",
    };
  }
}

export async function analyzeSession(
  sessionId: string,
): Promise<AnalyzeSessionResult> {
  const { getSessionById, insertSessionAnalysis, listMessagesBySessionId } =
    await import("@/lib/db/queries");

  const session = getSessionById(sessionId);
  if (!session) {
    return {
      ok: false,
      code: "not_found",
      error: "Sessionが見つかりません。",
    };
  }

  const messages = listMessagesBySessionId(sessionId);
  try {
    const provider = getAiProvider();
    return await runAnalyzeSession(sessionId, messages, {
      generateStructured: (request) => provider.generateStructured(request),
      save: insertSessionAnalysis,
    });
  } catch (error) {
    if (error instanceof AnalyzeSessionError) {
      return { ok: false, code: error.code, error: error.message };
    }
    console.error("analyze-session failed", { sessionId });
    return {
      ok: false,
      code: "api",
      error: "AI分析に失敗しました。Sessionの原文と発言は変更していません。",
    };
  }
}
