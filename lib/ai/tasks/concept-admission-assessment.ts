import { getAiConfig } from "../config";
import { AnalyzeSessionError, userMessageForAnalyzeError } from "../errors";
import {
  INTEGRATED_REVIEW_TIMEOUT_MS,
  isIntegratedReviewInputTooLong,
} from "../limits";
import {
  CONCEPT_ADMISSION_ASSESSMENT_PROMPT_VERSION,
  CONCEPT_ADMISSION_ASSESSMENT_SYSTEM_PROMPT,
  buildConceptAssessmentRepairUserPrompt,
  buildConceptAssessmentUserPrompt,
  toAssessmentLlmCandidates,
} from "../prompts/concept-admission-assessment";
import type { AiProvider, StructuredGenerateUsage } from "../provider";
import { addStructuredUsage, getAiProvider } from "../provider";
import {
  CONCEPT_ADMISSION_ASSESSMENT_SCHEMA_NAME,
  conceptAssessmentOutputSchema,
} from "../concept-admission-assessment-schema";
import { CONCEPT_ADMISSION_ASSESSMENT_VERSION } from "@/lib/concepts/admission/assessment-types";
import type { ConceptAssessment } from "@/lib/concepts/admission/assessment-types";
import { validateAssessmentCoverage } from "@/lib/concepts/admission/assessment-validation";
import {
  ASSESSMENT_BATCH_STRATEGY,
  partitionAssessmentBatches,
  type AssessmentBatchStrategy,
} from "@/lib/concepts/admission/assessment-batches";
import type { AdmissionCandidate } from "@/lib/concepts/admission/types";

export type ConceptAssessmentDeps = {
  generateStructured: AiProvider["generateStructured"];
};

export type ConceptAssessmentUsage = {
  totalBatches: number;
  successfulBatches: number;
  failedBatches: number;
  llmCallsActual: number;
  retryCalls: number;
  repairedBatches: number;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
};

export type ConceptAssessmentBatchResult = {
  index: number;
  candidateRefs: string[];
  repaired: boolean;
};

export type ConceptAssessmentOk = {
  ok: true;
  model: string;
  promptVersion: typeof CONCEPT_ADMISSION_ASSESSMENT_PROMPT_VERSION;
  assessmentVersion: typeof CONCEPT_ADMISSION_ASSESSMENT_VERSION;
  batchStrategy: AssessmentBatchStrategy;
  usage: ConceptAssessmentUsage;
  batches: ConceptAssessmentBatchResult[];
  assessments: ConceptAssessment[];
};

export type ConceptAssessmentFail = {
  ok: false;
  code: string;
  error: string;
  usage?: ConceptAssessmentUsage;
  apiCalls?: number;
  retryCalls?: number;
  coverageFailed?: boolean;
  model?: string | null;
};

export type ConceptAssessmentResult =
  | ConceptAssessmentOk
  | ConceptAssessmentFail;

function coverageError(reason: string, detail: string) {
  return `Assessment coverage が不完全です (${reason}: ${detail})`;
}

function withTokenTotals(
  usage: ConceptAssessmentUsage,
  tokens: StructuredGenerateUsage | null,
): ConceptAssessmentUsage {
  return {
    ...usage,
    inputTokens: tokens?.inputTokens ?? usage.inputTokens,
    outputTokens: tokens?.outputTokens ?? usage.outputTokens,
    totalTokens: tokens?.totalTokens ?? usage.totalTokens,
  };
}

export async function runConceptAssessment(
  input: {
    candidates: AdmissionCandidate[];
    unitTexts: Record<string, string>;
  },
  deps: ConceptAssessmentDeps,
): Promise<ConceptAssessmentResult> {
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
      error: "Assessment する Candidate がありません",
    };
  }

  const batches = partitionAssessmentBatches(input.candidates);
  let tokens: StructuredGenerateUsage | null = null;
  let apiCalls = 0;
  let retryCalls = 0;
  let repairedBatches = 0;
  let usedModel = modelName;
  const batchResults: ConceptAssessmentBatchResult[] = [];
  const assessmentsByRef = new Map<string, ConceptAssessment>();

  const fail = (
    code: string,
    error: string,
    extra?: { coverageFailed?: boolean },
  ): ConceptAssessmentFail => ({
    ok: false,
    code,
    error,
    model: usedModel,
    apiCalls,
    retryCalls,
    coverageFailed: extra?.coverageFailed,
    usage: withTokenTotals(
      {
        totalBatches: batches.length,
        successfulBatches: batchResults.length,
        failedBatches: 1,
        llmCallsActual: apiCalls,
        retryCalls,
        repairedBatches,
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
      },
      tokens,
    ),
  });

  const callLlm = async (user: string) => {
    apiCalls += 1;
    const generated = await deps.generateStructured({
      model: modelName,
      system: CONCEPT_ADMISSION_ASSESSMENT_SYSTEM_PROMPT,
      user,
      schema: conceptAssessmentOutputSchema,
      schemaName: CONCEPT_ADMISSION_ASSESSMENT_SCHEMA_NAME,
      timeoutMs: INTEGRATED_REVIEW_TIMEOUT_MS,
    });
    tokens = addStructuredUsage(tokens, generated.usage ?? null);
    usedModel = generated.model || usedModel;
    return generated.parsed;
  };

  for (const batch of batches) {
    const llmCandidates = toAssessmentLlmCandidates(
      batch.candidates,
      input.unitTexts,
    );
    const userPrompt = buildConceptAssessmentUserPrompt({
      candidates: llmCandidates,
    });
    if (isIntegratedReviewInputTooLong(userPrompt)) {
      return fail("too_long", "Assessment 入力が現在のMVP上限を超えています");
    }

    let parsedUnknown: unknown;
    try {
      parsedUnknown = await callLlm(userPrompt);
    } catch (error) {
      const mapped = userMessageForAnalyzeError(error);
      return fail(mapped.code, mapped.error);
    }

    const firstParsed = conceptAssessmentOutputSchema.safeParse(parsedUnknown);
    if (!firstParsed.success) {
      return fail(
        "schema",
        "Assessment 結果の形式が不正だったため処理しませんでした。",
      );
    }

    let output = firstParsed.data;
    let coverage = validateAssessmentCoverage({
      candidates: batch.candidates,
      assessments: output.assessments,
    });
    let repaired = false;

    if (!coverage.ok) {
      const repairPrompt = buildConceptAssessmentRepairUserPrompt({
        candidates: llmCandidates,
        coverageReason: coverage.reason,
        coverageDetail: coverage.detail,
      });
      if (isIntegratedReviewInputTooLong(repairPrompt)) {
        return fail(
          "coverage",
          coverageError(coverage.reason, coverage.detail),
          { coverageFailed: true },
        );
      }
      try {
        retryCalls += 1;
        parsedUnknown = await callLlm(repairPrompt);
      } catch (error) {
        const mapped = userMessageForAnalyzeError(error);
        return fail(mapped.code, mapped.error);
      }
      const repairedParsed =
        conceptAssessmentOutputSchema.safeParse(parsedUnknown);
      if (!repairedParsed.success) {
        return fail(
          "schema",
          "Assessment 結果の形式が不正だったため処理しませんでした。",
        );
      }
      output = repairedParsed.data;
      coverage = validateAssessmentCoverage({
        candidates: batch.candidates,
        assessments: output.assessments,
      });
      if (!coverage.ok) {
        return fail(
          "coverage",
          coverageError(coverage.reason, coverage.detail),
          { coverageFailed: true },
        );
      }
      repaired = true;
      repairedBatches += 1;
    }

    for (const item of coverage.assessments) {
      assessmentsByRef.set(item.candidateRef, item);
    }
    batchResults.push({
      index: batch.index,
      candidateRefs: [...batch.candidateRefs],
      repaired,
    });
  }

  const assessments = input.candidates.map(
    (candidate) => assessmentsByRef.get(candidate.candidateRef)!,
  );

  return {
    ok: true,
    model: usedModel,
    promptVersion: CONCEPT_ADMISSION_ASSESSMENT_PROMPT_VERSION,
    assessmentVersion: CONCEPT_ADMISSION_ASSESSMENT_VERSION,
    batchStrategy: ASSESSMENT_BATCH_STRATEGY,
    usage: withTokenTotals(
      {
        totalBatches: batches.length,
        successfulBatches: batchResults.length,
        failedBatches: 0,
        llmCallsActual: apiCalls,
        retryCalls,
        repairedBatches,
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
      },
      tokens,
    ),
    batches: batchResults,
    assessments,
  };
}

export async function assessConcepts(input: {
  candidates: AdmissionCandidate[];
  unitTexts: Record<string, string>;
}) {
  try {
    const provider = getAiProvider();
    return await runConceptAssessment(input, {
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
