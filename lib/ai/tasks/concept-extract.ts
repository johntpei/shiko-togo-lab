import { getAiConfig } from "../config";
import { AnalyzeSessionError, userMessageForAnalyzeError } from "../errors";
import { ANALYZE_SESSION_TIMEOUT_MS, isAnalyzeInputTooLong } from "../limits";
import {
  CONCEPT_EXTRACT_PROMPT_VERSION,
  CONCEPT_EXTRACT_SYSTEM_PROMPT,
  buildConceptExtractUserPrompt,
} from "../prompts/concept-extract";
import type {
  AiProvider,
  StructuredGenerateUsage,
} from "../provider";
import { getAiProvider } from "../provider";
import {
  CONCEPT_EXTRACT_SCHEMA_NAME,
  conceptExtractOutputSchema,
  type ConceptExtractOutput,
} from "../concept-extract-schema";
import type { ConceptExtractAction } from "@/lib/concepts/actions";
import type { ConceptRegistrySnapshot } from "@/lib/concepts/catalog";
import { emptyConceptCatalog } from "@/lib/concepts/catalog";
import { resolveConceptActions } from "@/lib/concepts/resolve";
import type { ConceptResolveResult } from "@/lib/concepts/resolve";
import {
  prepareUserEvidenceUnits,
  type ConceptExtractMessage,
  type ConceptExtractUnit,
} from "@/lib/concepts/user-units";

export type ConceptExtractDeps = {
  generateStructured: AiProvider["generateStructured"];
};

export type ConceptExtractSessionInput = {
  sessionId: string;
  occurredAt: string;
  messages: ConceptExtractMessage[];
  catalog?: ConceptRegistrySnapshot;
};

export type ConceptExtractOk = {
  ok: true;
  sessionId: string;
  model: string;
  promptVersion: typeof CONCEPT_EXTRACT_PROMPT_VERSION;
  usage: StructuredGenerateUsage | null;
  apiCalls: number;
  units: ConceptExtractUnit[];
  actions: ConceptExtractAction[];
  resolve: ConceptResolveResult;
};

export type ConceptExtractFail = {
  ok: false;
  sessionId: string;
  code: string;
  error: string;
};

export type ConceptExtractResult = ConceptExtractOk | ConceptExtractFail;

function toExtractActions(
  items: ConceptExtractOutput["items"],
): ConceptExtractAction[] {
  return items.map((item) => {
    if (item.action === "match") {
      return {
        action: "match",
        evidenceRef: item.evidenceRef,
        surfaceForm: item.surfaceForm,
        existingConceptRef: item.existingConceptRef,
      };
    }
    if (item.action === "new") {
      return {
        action: "new",
        evidenceRef: item.evidenceRef,
        surfaceForm: item.surfaceForm,
        proposedCanonicalLabel: item.proposedCanonicalLabel,
        aliases: item.aliases,
      };
    }
    return {
      action: item.action,
      evidenceRef: item.evidenceRef,
      surfaceForm: item.surfaceForm,
    };
  });
}

export async function runConceptExtractSession(
  input: ConceptExtractSessionInput,
  deps: ConceptExtractDeps,
): Promise<ConceptExtractResult> {
  const config = getAiConfig();
  if (!config.apiKey) {
    return {
      ok: false,
      sessionId: input.sessionId,
      code: "not_configured",
      error: "OpenAI APIキーが設定されていません",
    };
  }
  if (config.provider !== "openai") {
    return {
      ok: false,
      sessionId: input.sessionId,
      code: "unsupported_provider",
      error: "未対応のAIプロバイダです",
    };
  }
  if (!config.model) {
    return {
      ok: false,
      sessionId: input.sessionId,
      code: "not_configured",
      error: "AI_MODEL が設定されていません",
    };
  }

  const catalog = input.catalog ?? emptyConceptCatalog();
  const units = prepareUserEvidenceUnits({
    sessionId: input.sessionId,
    occurredAt: input.occurredAt,
    messages: input.messages,
  });

  if (units.length === 0) {
    return {
      ok: true,
      sessionId: input.sessionId,
      model: config.model,
      promptVersion: CONCEPT_EXTRACT_PROMPT_VERSION,
      usage: null,
      apiCalls: 0,
      units,
      actions: [],
      resolve: resolveConceptActions({ units, catalog, actions: [] }),
    };
  }

  const userPrompt = buildConceptExtractUserPrompt({ catalog, units });
  if (isAnalyzeInputTooLong(userPrompt)) {
    return {
      ok: false,
      sessionId: input.sessionId,
      code: "too_long",
      error: "このSessionは現在のMVPで抽出できる上限を超えています",
    };
  }

  let parsedUnknown: unknown;
  let usedModel = config.model;
  let usage: StructuredGenerateUsage | null = null;
  try {
    const generated = await deps.generateStructured({
      model: config.model,
      system: CONCEPT_EXTRACT_SYSTEM_PROMPT,
      user: userPrompt,
      schema: conceptExtractOutputSchema,
      schemaName: CONCEPT_EXTRACT_SCHEMA_NAME,
      timeoutMs: ANALYZE_SESSION_TIMEOUT_MS,
    });
    parsedUnknown = generated.parsed;
    usedModel = generated.model || config.model;
    usage = generated.usage ?? null;
  } catch (error) {
    const mapped = userMessageForAnalyzeError(error);
    return { ok: false, sessionId: input.sessionId, ...mapped };
  }

  const parsed = conceptExtractOutputSchema.safeParse(parsedUnknown);
  if (!parsed.success) {
    return {
      ok: false,
      sessionId: input.sessionId,
      code: "schema",
      error: "抽出結果の形式が不正だったため処理しませんでした。",
    };
  }

  const actions = toExtractActions(parsed.data.items);
  const resolve = resolveConceptActions({ units, catalog, actions });

  return {
    ok: true,
    sessionId: input.sessionId,
    model: usedModel,
    promptVersion: CONCEPT_EXTRACT_PROMPT_VERSION,
    usage,
    apiCalls: 1,
    units,
    actions,
    resolve,
  };
}

export async function extractConceptsForSession(
  input: ConceptExtractSessionInput,
): Promise<ConceptExtractResult> {
  try {
    const provider = getAiProvider();
    return await runConceptExtractSession(input, {
      generateStructured: (request) => provider.generateStructured(request),
    });
  } catch (error) {
    if (error instanceof AnalyzeSessionError) {
      return {
        ok: false,
        sessionId: input.sessionId,
        code: error.code,
        error: error.message,
      };
    }
    const mapped = userMessageForAnalyzeError(error);
    return { ok: false, sessionId: input.sessionId, ...mapped };
  }
}