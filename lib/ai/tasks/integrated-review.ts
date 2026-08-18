import { getAiConfig } from "../config";
import { AnalyzeSessionError, userMessageForAnalyzeError } from "../errors";
import { computeEvidenceStats } from "../evidence";
import { resolveEvidenceRefs } from "../evidence-refs";
import {
  INTEGRATED_REVIEW_TIMEOUT_MS,
  MAX_COMMON_THEMES,
  MAX_CROSS_INSIGHTS,
  MAX_HYPOTHESES,
  MAX_NEXT_QUESTIONS,
  MAX_OPEN_QUESTIONS,
  MAX_REVIEW_EVIDENCE_REFS_PER_ITEM,
  MIN_INTEGRATED_REVIEW_SESSIONS,
  isIntegratedReviewInputTooLong,
} from "../limits";
import {
  INTEGRATED_REVIEW_PROMPT_VERSION,
  INTEGRATED_REVIEW_SYSTEM_PROMPT,
  buildIntegratedReviewUserPromptV5,
} from "../prompts/integrated-review";
import type { AiProvider } from "../provider";
import { getAiProvider } from "../provider";
import {
  buildIntegratedReviewInput,
  type ReviewSessionSource,
} from "../review-input";
import {
  defaultReviewSettings,
  integratedReviewV5OutputSchema,
  type StoredReviewEvidence,
  type StoredReviewItem,
  type StoredReviewPayload,
  type StoredReviewShiftItem,
  type ReviewSupportType,
} from "../review-schemas";
import { textsAreNearDuplicates } from "../review-quality";
import {
  mergeGroupedEvidenceRefs,
  type EvidenceGroup,
  type ReviewRelationType,
} from "../evidence-groups";
import {
  computeReviewGuardStats,
  distinctSessionIds,
  validateCommonThemeSupport,
  validateCrossInsightSupport,
  validateHypothesisSupport,
  validateNextQuestionSupport,
  validateOptionalEvidence,
  validateShiftSupport,
  validateTensionSupport,
} from "../review-semantic";
import { computeSemanticStats } from "../semantic-support";
import type { ValidatedEvidence } from "../evidence";

export type IntegratedReviewResult =
  | { ok: true; reviewId: string }
  | { ok: false; error: string; code: string };

export type IntegratedReviewSaveInput = {
  title: string;
  model: string;
  promptVersion: string;
  payload: StoredReviewPayload;
  sessionIds: string[];
  evidences: Array<{
    sessionId: string;
    messageId: string;
    quote: string;
    validated: boolean;
  }>;
};

export type IntegratedReviewDeps = {
  generateStructured: AiProvider["generateStructured"];
  save: (input: IntegratedReviewSaveInput) => { id: string };
};

function toStoredEvidence(evidence: ValidatedEvidence): StoredReviewEvidence {
  return {
    messageRef: evidence.messageRef,
    quote: evidence.quote,
    validated: evidence.validated,
    messageId: evidence.messageId,
    sessionId: evidence.sessionId ?? null,
    sessionTitle: evidence.sessionTitle ?? null,
    occurredAt: evidence.occurredAt ?? null,
    role: evidence.role ?? null,
    reason: evidence.reason,
  };
}

function storeItem(
  text: string,
  evidence: ValidatedEvidence[],
  semantic: {
    valid: boolean;
    reason: string | null;
    guardType: StoredReviewItem["guardType"];
  },
  extra?: {
    rationale?: string;
    validationIdea?: string;
    supportType?: ReviewSupportType;
    relationType?: ReviewRelationType;
    distinctSessionCount?: number;
    sideA?: StoredReviewItem["sideA"];
    sideB?: StoredReviewItem["sideB"];
  },
): StoredReviewItem {
  return {
    text,
    evidence: evidence.map(toStoredEvidence),
    semanticValid: semantic.valid,
    invalidReason: semantic.reason as StoredReviewItem["invalidReason"],
    guardType: semantic.guardType,
    supportType: extra?.supportType,
    rationale: extra?.rationale,
    validationIdea: extra?.validationIdea,
    relationType: extra?.relationType,
    distinctSessionCount: extra?.distinctSessionCount,
    sideA: extra?.sideA,
    sideB: extra?.sideB,
  };
}

export async function runIntegratedReview(
  sources: ReviewSessionSource[],
  title: string,
  deps: IntegratedReviewDeps,
): Promise<IntegratedReviewResult> {
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

  const input = buildIntegratedReviewInput(sources);
  if (input.analyzableSessionCount < MIN_INTEGRATED_REVIEW_SESSIONS) {
    return {
      ok: false,
      code: "too_few_sessions",
      error: "統合レビューには2件以上のSessionが必要です",
    };
  }
  if (isIntegratedReviewInputTooLong(input.labeledTranscript)) {
    return {
      ok: false,
      code: "too_long",
      error:
        "選択したSessionの合計が、現在のMVPでレビューできる上限を超えています。Sessionを減らしてください。",
    };
  }

  let parsedUnknown: unknown;
  let usedModel = config.model;
  try {
    const generated = await deps.generateStructured({
      model: config.model,
      system: INTEGRATED_REVIEW_SYSTEM_PROMPT,
      user: buildIntegratedReviewUserPromptV5(input.labeledTranscript),
      schema: integratedReviewV5OutputSchema,
      schemaName: "integrated_review_v5",
      timeoutMs: INTEGRATED_REVIEW_TIMEOUT_MS,
    });
    parsedUnknown = generated.parsed;
    usedModel = generated.model || config.model;
  } catch (error) {
    const mapped = userMessageForAnalyzeError(error);
    return {
      ok: false,
      code: mapped.code,
      error:
        mapped.code === "timeout"
          ? "統合レビューが時間内に終わりませんでした。Sessionの原文は変更していません。"
          : mapped.code === "schema"
            ? "分析結果の形式が不正だったため保存しませんでした。"
            : "統合レビューに失敗しました。Sessionの原文は変更していません。",
    };
  }

  const parsed = integratedReviewV5OutputSchema.safeParse(parsedUnknown);
  if (!parsed.success) {
    return {
      ok: false,
      code: "schema",
      error: "分析結果の形式が不正だったため保存しませんでした。",
    };
  }

  const resolve = (refs: string[]) =>
    resolveEvidenceRefs(
      refs,
      input.unitsByRef,
      input.contentByMessageId,
      MAX_REVIEW_EVIDENCE_REFS_PER_ITEM,
    );

  const refsFromGrouped = (item: {
    evidenceGroups?: EvidenceGroup[] | null;
    evidenceRefs?: string[] | null;
    sideA?: { evidenceRefs: string[] };
    sideB?: { evidenceRefs: string[] };
  }) =>
    mergeGroupedEvidenceRefs(item.evidenceGroups, [
      ...(item.evidenceRefs ?? []),
      ...(item.sideA?.evidenceRefs ?? []),
      ...(item.sideB?.evidenceRefs ?? []),
    ]);

  const sessionCountFor = (evidence: ValidatedEvidence[]) =>
    distinctSessionIds(evidence, input.unitsByRef).size;

  const commonThemes = parsed.data.commonThemes
    .slice(0, MAX_COMMON_THEMES)
    .map((item) => {
    const evidence = resolve(refsFromGrouped(item));
    return storeItem(
      item.text,
      evidence,
      validateCommonThemeSupport(evidence, input.unitsByRef, item.text),
      {
        supportType: "cross_session_interpretation",
        relationType: item.relationType,
        distinctSessionCount: sessionCountFor(evidence),
      },
    );
  });

  const shifts: StoredReviewShiftItem[] = parsed.data.shifts.map((item) => {
    const beforeEvidence = resolve(item.beforeEvidenceRefs);
    const afterEvidence = resolve(item.afterEvidenceRefs);
    const evidence = [...beforeEvidence, ...afterEvidence];
    const semantic = validateShiftSupport(
      beforeEvidence,
      afterEvidence,
      input.unitsByRef,
      input.sessions,
    );
    return {
      text: item.interpretation,
      before: item.before,
      after: item.after,
      interpretation: item.interpretation,
      beforeEvidence: beforeEvidence.map(toStoredEvidence),
      afterEvidence: afterEvidence.map(toStoredEvidence),
      evidence: evidence.map(toStoredEvidence),
      semanticValid: semantic.valid,
      invalidReason: semantic.reason,
      guardType: semantic.guardType,
      supportType: "direct",
      distinctSessionCount: sessionCountFor(evidence),
    };
  });

  const tensions = parsed.data.tensions.map((item) => {
    const sideAEvidence = resolve(item.sideA.evidenceRefs);
    const sideBEvidence = resolve(item.sideB.evidenceRefs);
    const evidence = resolve(refsFromGrouped(item));
    return storeItem(
      item.text,
      evidence,
      validateTensionSupport(evidence, input.unitsByRef, item.text, {
        sideA: sideAEvidence,
        sideB: sideBEvidence,
      }),
      {
        supportType: "cross_session_interpretation",
        relationType: item.relationType,
        distinctSessionCount: sessionCountFor(evidence),
        sideA: {
          text: item.sideA.text,
          evidence: sideAEvidence.map(toStoredEvidence),
        },
        sideB: {
          text: item.sideB.text,
          evidence: sideBEvidence.map(toStoredEvidence),
        },
      },
    );
  });

  const crossInsights = parsed.data.crossInsights
    .slice(0, MAX_CROSS_INSIGHTS)
    .map((item) => {
    const evidence = resolve(refsFromGrouped(item));
    const semantic = validateCrossInsightSupport(
      evidence,
      input.unitsByRef,
      item.text,
    );
    const duplicate = commonThemes.some(
      (theme) =>
        theme.semanticValid !== false &&
        textsAreNearDuplicates(theme.text, item.text),
    );
    return storeItem(
      item.text,
      evidence,
      duplicate
        ? {
            valid: false,
            reason: "duplicate_interpretation",
            guardType: "interpretation",
          }
        : semantic,
      {
        supportType: "cross_session_interpretation",
        relationType: item.relationType,
        distinctSessionCount: sessionCountFor(evidence),
      },
    );
  });

  const hypotheses = parsed.data.hypotheses
    .slice(0, MAX_HYPOTHESES)
    .map((item) => {
    const evidence = resolve(refsFromGrouped(item));
    return storeItem(
      item.text,
      evidence,
      validateHypothesisSupport(evidence, input.unitsByRef, item.text),
      {
        rationale: item.rationale,
        validationIdea: item.validationIdea,
        supportType: "hypothesis",
        relationType: item.relationType,
        distinctSessionCount: sessionCountFor(evidence),
      },
    );
  });

  const openQuestions = parsed.data.openQuestions
    .slice(0, MAX_OPEN_QUESTIONS)
    .map((item) => {
    const evidence = resolve(item.evidenceRefs);
    return storeItem(item.text, evidence, validateOptionalEvidence(evidence), {
      supportType: "direct",
    });
  });

  const nextQuestions = parsed.data.nextQuestions
    .slice(0, MAX_NEXT_QUESTIONS)
    .map((item) => {
      const evidence = resolve(item.evidenceRefs);
      return storeItem(
        item.text,
        evidence,
        validateNextQuestionSupport(item.text, evidence),
      );
    });

  const allItems = [
    ...commonThemes,
    ...shifts,
    ...tensions,
    ...crossInsights,
    ...hypotheses,
    ...openQuestions,
    ...nextQuestions,
  ];

  if (process.env.NODE_ENV !== "production") {
    for (const item of allItems) {
      if (item.semanticValid === false) {
        console.info("integrated-review semantic_support_failed", {
          reason: item.invalidReason,
          guardType: item.guardType,
          distinctSessionCount: item.distinctSessionCount,
        });
      }
    }
  }

  const payload: StoredReviewPayload = {
    summary: parsed.data.summary,
    commonThemes,
    shifts,
    tensions,
    crossInsights,
    hypotheses,
    openQuestions,
    nextQuestions,
    settings: defaultReviewSettings(config.provider),
    metrics: {
      ...computeEvidenceStats(allItems),
      ...computeSemanticStats(allItems),
      ...computeReviewGuardStats(allItems),
      sessionCount: input.analyzableSessionCount,
    },
  };

  const evidences = allItems.flatMap((item) =>
    item.evidence.flatMap((evidence) => {
      if (!evidence.messageId || !evidence.sessionId) {
        return [];
      }
      return [
        {
          sessionId: evidence.sessionId,
          messageId: evidence.messageId,
          quote: evidence.quote,
          validated: evidence.validated,
        },
      ];
    }),
  );

  try {
    const saved = deps.save({
      title,
      model: usedModel,
      promptVersion: INTEGRATED_REVIEW_PROMPT_VERSION,
      payload,
      sessionIds: input.sessions.map((session) => session.sessionId),
      evidences,
    });
    return { ok: true, reviewId: saved.id };
  } catch {
    console.error("integrated-review save failed", { code: "save" });
    return {
      ok: false,
      code: "save",
      error: "統合レビューの保存に失敗しました。Sessionの原文は変更していません。",
    };
  }
}

export async function createIntegratedReview(
  sources: ReviewSessionSource[],
  title: string,
): Promise<IntegratedReviewResult> {
  const { insertReviewAndProject } = await import(
    "@/lib/observations/project-review"
  );
  try {
    const provider = getAiProvider();
    return await runIntegratedReview(sources, title, {
      generateStructured: (request) => provider.generateStructured(request),
      save: insertReviewAndProject,
    });
  } catch (error) {
    if (error instanceof AnalyzeSessionError) {
      return { ok: false, code: error.code, error: error.message };
    }
    console.error("integrated-review failed");
    return {
      ok: false,
      code: "api",
      error: "統合レビューに失敗しました。Sessionの原文は変更していません。",
    };
  }
}
