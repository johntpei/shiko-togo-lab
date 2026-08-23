import { getAiConfig } from "../config";
import { AnalyzeSessionError, userMessageForAnalyzeError } from "../errors";
import { ANALYZE_SESSION_TIMEOUT_MS, isAnalyzeInputTooLong } from "../limits";
import {
  CONCEPT_EXTRACT_PROMPT_VERSION,
  CONCEPT_EXTRACT_SYSTEM_PROMPT,
  buildConceptExtractRepairUserPrompt,
  buildConceptExtractUserPrompt,
} from "../prompts/concept-extract";
import type {
  AiProvider,
  StructuredGenerateUsage,
} from "../provider";
import { addStructuredUsage, getAiProvider } from "../provider";
import {
  CONCEPT_EXTRACT_SCHEMA_NAME,
  conceptExtractOutputSchema,
  type ConceptExtractOutput,
} from "../concept-extract-schema";
import type { ConceptExtractAction } from "@/lib/concepts/actions";
import type { ConceptRegistrySnapshot } from "@/lib/concepts/catalog";
import { emptyConceptCatalog } from "@/lib/concepts/catalog";
import { validateConceptExtractCoverage } from "@/lib/concepts/coverage";
import { resolveConceptActions } from "@/lib/concepts/resolve";
import type { ConceptResolveResult } from "@/lib/concepts/resolve";
import {
  listRequiredEvidenceRefs,
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
  retryCalls: number;
  repaired: boolean;
  units: ConceptExtractUnit[];
  actions: ConceptExtractAction[];
  resolve: ConceptResolveResult;
};

export type ConceptExtractActionsOk = Omit<ConceptExtractOk, "resolve">;

export type ConceptExtractFail = {
  ok: false;
  sessionId: string;
  code: string;
  error: string;
  usage?: StructuredGenerateUsage | null;
  apiCalls?: number;
  retryCalls?: number;
};

export type ConceptExtractResult = ConceptExtractOk | ConceptExtractFail;

export function toExtractActions(
  output: ConceptExtractOutput,
): ConceptExtractAction[] {
  const actions: ConceptExtractAction[] = [];
  for (const unit of output.units) {
    if (unit.disposition === "skip") {
      actions.push({
        action: "skip",
        evidenceRef: unit.evidenceRef,
        surfaceForm: "",
      });
      continue;
    }
    if (unit.disposition === "uncertain") {
      actions.push({
        action: "uncertain",
        evidenceRef: unit.evidenceRef,
        surfaceForm: "",
      });
      continue;
    }
    for (const concept of unit.concepts) {
      if (concept.action === "match") {
        actions.push({
          action: "match",
          evidenceRef: unit.evidenceRef,
          surfaceForm: concept.surfaceForm,
          existingConceptRef: concept.existingConceptRef,
        });
        continue;
      }
      actions.push({
        action: "new",
        evidenceRef: unit.evidenceRef,
        surfaceForm: concept.surfaceForm,
      });
    }
  }
  return actions;
}

function coverageError(reason: string, detail: string) {
  return `Evidence Unit coverage が不完全です (${reason}: ${detail})`;
}

export type ConceptExtractActionsResult =
  | ConceptExtractActionsOk
  | ConceptExtractFail;

/**
 * Frozen Extraction v4 LLM path。units は caller が用意する。
 * Identity Resolution は行わない。
 */
export async function runConceptExtractOnUnits(
  input: {
    sessionId: string;
    units: ConceptExtractUnit[];
    catalog?: ConceptRegistrySnapshot;
  },
  deps: ConceptExtractDeps,
): Promise<ConceptExtractActionsResult> {
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
  const modelName = config.model;
  if (!modelName) {
    return {
      ok: false,
      sessionId: input.sessionId,
      code: "not_configured",
      error: "AI_MODEL が設定されていません",
    };
  }

  const catalog = input.catalog ?? emptyConceptCatalog();
  const units = input.units;

  if (units.length === 0) {
    return {
      ok: true,
      sessionId: input.sessionId,
      model: modelName,
      promptVersion: CONCEPT_EXTRACT_PROMPT_VERSION,
      usage: null,
      apiCalls: 0,
      retryCalls: 0,
      repaired: false,
      units,
      actions: [],
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

  const evidenceRefs = listRequiredEvidenceRefs(units);
  let usage: StructuredGenerateUsage | null = null;
  let apiCalls = 0;
  let retryCalls = 0;
  let usedModel = modelName;

  const callLlm = async (user: string) => {
    apiCalls += 1;
    const generated = await deps.generateStructured({
      model: modelName,
      system: CONCEPT_EXTRACT_SYSTEM_PROMPT,
      user,
      schema: conceptExtractOutputSchema,
      schemaName: CONCEPT_EXTRACT_SCHEMA_NAME,
      timeoutMs: ANALYZE_SESSION_TIMEOUT_MS,
    });
    usage = addStructuredUsage(usage, generated.usage ?? null);
    usedModel = generated.model || usedModel;
    return generated.parsed;
  };

  const fail = (code: string, error: string): ConceptExtractFail => ({
    ok: false,
    sessionId: input.sessionId,
    code,
    error,
    usage,
    apiCalls,
    retryCalls,
  });

  let parsedUnknown: unknown;
  try {
    parsedUnknown = await callLlm(userPrompt);
  } catch (error) {
    const mapped = userMessageForAnalyzeError(error);
    return fail(mapped.code, mapped.error);
  }

  const firstParsed = conceptExtractOutputSchema.safeParse(parsedUnknown);
  if (!firstParsed.success) {
    return fail("schema", "抽出結果の形式が不正だったため処理しませんでした。");
  }

  let output = firstParsed.data;
  let coverage = validateConceptExtractCoverage({
    evidenceRefs,
    units: output.units,
  });
  let repaired = false;

  if (!coverage.ok) {
    const repairPrompt = buildConceptExtractRepairUserPrompt({
      catalog,
      units,
      coverageReason: coverage.reason,
      coverageDetail: coverage.detail,
    });
    if (isAnalyzeInputTooLong(repairPrompt)) {
      return fail("coverage", coverageError(coverage.reason, coverage.detail));
    }
    try {
      retryCalls = 1;
      parsedUnknown = await callLlm(repairPrompt);
    } catch (error) {
      const mapped = userMessageForAnalyzeError(error);
      return fail(mapped.code, mapped.error);
    }
    const repairedParsed = conceptExtractOutputSchema.safeParse(parsedUnknown);
    if (!repairedParsed.success) {
      return fail(
        "schema",
        "抽出結果の形式が不正だったため処理しませんでした。",
      );
    }
    output = repairedParsed.data;
    coverage = validateConceptExtractCoverage({
      evidenceRefs,
      units: output.units,
    });
    if (!coverage.ok) {
      return fail("coverage", coverageError(coverage.reason, coverage.detail));
    }
    repaired = true;
  }

  return {
    ok: true,
    sessionId: input.sessionId,
    model: usedModel,
    promptVersion: CONCEPT_EXTRACT_PROMPT_VERSION,
    usage,
    apiCalls,
    retryCalls,
    repaired,
    units,
    actions: toExtractActions(output),
  };
}

export async function runConceptExtractSession(
  input: ConceptExtractSessionInput,
  deps: ConceptExtractDeps,
): Promise<ConceptExtractResult> {
  const catalog = input.catalog ?? emptyConceptCatalog();
  const units = prepareUserEvidenceUnits({
    sessionId: input.sessionId,
    occurredAt: input.occurredAt,
    messages: input.messages,
  });
  const extracted = await runConceptExtractOnUnits(
    { sessionId: input.sessionId, units, catalog },
    deps,
  );
  if (!extracted.ok) {
    return extracted;
  }
  return {
    ...extracted,
    resolve: resolveConceptActions({
      units: extracted.units,
      catalog,
      actions: extracted.actions,
    }),
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
