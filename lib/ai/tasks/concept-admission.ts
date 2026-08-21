import { getAiConfig } from "../config";
import { AnalyzeSessionError, userMessageForAnalyzeError } from "../errors";
import {
  INTEGRATED_REVIEW_TIMEOUT_MS,
  isIntegratedReviewInputTooLong,
} from "../limits";
import {
  CONCEPT_ADMISSION_PROMPT_VERSION,
  CONCEPT_ADMISSION_SYSTEM_PROMPT,
  buildConceptAdmissionRepairUserPrompt,
  buildConceptAdmissionUserPrompt,
} from "../prompts/concept-admission";
import type { AiProvider, StructuredGenerateUsage } from "../provider";
import { addStructuredUsage, getAiProvider } from "../provider";
import {
  CONCEPT_ADMISSION_SCHEMA_NAME,
  conceptAdmissionOutputSchema,
} from "../concept-admission-schema";
import type { AdmissionCandidate, AdmissionDecision } from "@/lib/concepts/admission/types";
import { CONCEPT_ADMISSION_VERSION } from "@/lib/concepts/admission/types";
import { validateAdmissionCoverage } from "@/lib/concepts/admission/validation";
import { applyAdmissionDecisions } from "@/lib/concepts/admission/report";
import type { ApplyAdmissionResult } from "@/lib/concepts/admission/report";

export type ConceptAdmissionDeps = {
  generateStructured: AiProvider["generateStructured"];
};

export type ConceptAdmissionOk = {
  ok: true;
  model: string;
  promptVersion: typeof CONCEPT_ADMISSION_PROMPT_VERSION;
  admissionVersion: typeof CONCEPT_ADMISSION_VERSION;
  usage: StructuredGenerateUsage | null;
  apiCalls: number;
  retryCalls: number;
  repaired: boolean;
  decisions: AdmissionDecision[];
  applied: Extract<ApplyAdmissionResult, { ok: true }>;
};

export type ConceptAdmissionFail = {
  ok: false;
  code: string;
  error: string;
  usage?: StructuredGenerateUsage | null;
  apiCalls?: number;
  retryCalls?: number;
  coverageFailed?: boolean;
};

export type ConceptAdmissionResult = ConceptAdmissionOk | ConceptAdmissionFail;

function coverageError(reason: string, detail: string) {
  return `Admission coverage が不完全です (${reason}: ${detail})`;
}

export async function runConceptAdmission(
  input: { candidates: AdmissionCandidate[] },
  deps: ConceptAdmissionDeps,
): Promise<ConceptAdmissionResult> {
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
  const modelName = config.model;
  if (!modelName) {
    return {
      ok: false,
      code: "not_configured",
      error: "AI_MODEL が設定されていません",
    };
  }

  if (input.candidates.length === 0) {
    return {
      ok: false,
      code: "empty_candidates",
      error: "Admission する Candidate がありません",
    };
  }

  const userPrompt = buildConceptAdmissionUserPrompt({
    candidates: input.candidates,
  });
  if (isIntegratedReviewInputTooLong(userPrompt)) {
    return {
      ok: false,
      code: "too_long",
      error: "Admission 入力が現在のMVP上限を超えています",
    };
  }

  let usage: StructuredGenerateUsage | null = null;
  let apiCalls = 0;
  let retryCalls = 0;
  let usedModel = modelName;

  const callLlm = async (user: string) => {
    apiCalls += 1;
    const generated = await deps.generateStructured({
      model: modelName,
      system: CONCEPT_ADMISSION_SYSTEM_PROMPT,
      user,
      schema: conceptAdmissionOutputSchema,
      schemaName: CONCEPT_ADMISSION_SCHEMA_NAME,
      timeoutMs: INTEGRATED_REVIEW_TIMEOUT_MS,
    });
    usage = addStructuredUsage(usage, generated.usage ?? null);
    usedModel = generated.model || usedModel;
    return generated.parsed;
  };

  const fail = (
    code: string,
    error: string,
    extra?: { coverageFailed?: boolean },
  ): ConceptAdmissionFail => ({
    ok: false,
    code,
    error,
    usage,
    apiCalls,
    retryCalls,
    coverageFailed: extra?.coverageFailed,
  });

  let parsedUnknown: unknown;
  try {
    parsedUnknown = await callLlm(userPrompt);
  } catch (error) {
    const mapped = userMessageForAnalyzeError(error);
    return fail(mapped.code, mapped.error);
  }

  const firstParsed = conceptAdmissionOutputSchema.safeParse(parsedUnknown);
  if (!firstParsed.success) {
    return fail("schema", "Admission 結果の形式が不正だったため処理しませんでした。");
  }

  let output = firstParsed.data;
  let coverage = validateAdmissionCoverage({
    candidates: input.candidates,
    decisions: output.decisions,
  });
  let repaired = false;

  if (!coverage.ok) {
    const repairPrompt = buildConceptAdmissionRepairUserPrompt({
      candidates: input.candidates,
      coverageReason: coverage.reason,
      coverageDetail: coverage.detail,
    });
    if (isIntegratedReviewInputTooLong(repairPrompt)) {
      return fail("coverage", coverageError(coverage.reason, coverage.detail), {
        coverageFailed: true,
      });
    }
    try {
      retryCalls = 1;
      parsedUnknown = await callLlm(repairPrompt);
    } catch (error) {
      const mapped = userMessageForAnalyzeError(error);
      return fail(mapped.code, mapped.error);
    }
    const repairedParsed = conceptAdmissionOutputSchema.safeParse(parsedUnknown);
    if (!repairedParsed.success) {
      return fail(
        "schema",
        "Admission 結果の形式が不正だったため処理しませんでした。",
      );
    }
    output = repairedParsed.data;
    coverage = validateAdmissionCoverage({
      candidates: input.candidates,
      decisions: output.decisions,
    });
    if (!coverage.ok) {
      return fail("coverage", coverageError(coverage.reason, coverage.detail), {
        coverageFailed: true,
      });
    }
    repaired = true;
  }

  const applied = applyAdmissionDecisions(input.candidates, output.decisions);
  if (!applied.ok) {
    return fail("coverage", coverageError(applied.reason, applied.detail), {
      coverageFailed: true,
    });
  }

  return {
    ok: true,
    model: usedModel,
    promptVersion: CONCEPT_ADMISSION_PROMPT_VERSION,
    admissionVersion: CONCEPT_ADMISSION_VERSION,
    usage,
    apiCalls,
    retryCalls,
    repaired,
    decisions: output.decisions,
    applied,
  };
}

export async function admitConcepts(input: { candidates: AdmissionCandidate[] }) {
  try {
    const provider = getAiProvider();
    return await runConceptAdmission(input, {
      generateStructured: (request) => provider.generateStructured(request),
    });
  } catch (error) {
    if (error instanceof AnalyzeSessionError) {
      return { ok: false as const, code: error.code, error: error.message };
    }
    const mapped = userMessageForAnalyzeError(error);
    return { ok: false as const, ...mapped };
  }
}
