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
  buildIntegratedReviewUserPromptV8,
} from "../prompts/integrated-review";
import type { AiProvider } from "../provider";
import type { ReviewSessionSource } from "../review-input";
import type { EvidenceUnit } from "../evidence-units";
import {
  defaultReviewSettings,
  INTEGRATED_REVIEW_SCHEMA_NAME,
  createIntegratedReviewV8OutputSchema,
  type IntegratedReviewV5Output,
  type IntegratedReviewV8Output,
  type StoredReviewEvidence,
  type StoredReviewItem,
  type StoredReviewPayload,
  type StoredReviewShiftItem,
  type ReviewSupportType,
} from "../review-schemas";
import {
  REVIEW_EVIDENCE_TRANSPORT_VERSION,
  buildCanonicalReviewEvidenceInput,
  diagnoseReviewEvidenceAliases,
  exactEvidenceRefForAlias,
  type ReviewEvidenceAliasDiagnostics,
} from "../review-evidence-transport";
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
import type { ObservationConceptSupportDb } from "@/lib/db/observation-concept-support-queries";
import type {
  ObservationConceptRelationLifecycleResult,
  ObservationConceptRelationReconcileFn,
} from "@/lib/observations/observation-concept-relation-lifecycle";

export type IntegratedReviewResult =
  | {
      ok: true;
      reviewId: string;
      relationReconciliation?: ObservationConceptRelationLifecycleResult;
    }
  | {
      ok: false;
      error: string;
      code: string;
      reason?: string;
      groundingDiagnostic?: ReviewGroundingFailureDiagnostic;
    };

export type ReviewGroundingFailureDiagnostic = {
  aliasAttemptCount: number;
  resolvedAliasCount: number;
  aliasDiagnostics: ReviewEvidenceAliasDiagnostics;
  usableValidatedEvidenceCount: number;
};

export function evaluateReviewGroundingValidity(input: {
  aliasAttemptCount: number;
  items: Array<{
    evidence: Array<{
      validated: boolean;
      evidenceRef?: string | null;
      messageId: string | null;
      sessionId?: string | null;
    }>;
  }>;
}) {
  const usableValidatedEvidenceCount = input.items.reduce(
    (count, item) =>
      count +
      item.evidence.filter(
        (evidence) =>
          evidence.validated &&
          Boolean(evidence.evidenceRef) &&
          Boolean(evidence.messageId) &&
          Boolean(evidence.sessionId),
      ).length,
    0,
  );
  return {
    usableValidatedEvidenceCount,
    valid:
      input.aliasAttemptCount === 0 || usableValidatedEvidenceCount > 0,
  };
}

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

function normalizeAliasList(
  aliases: string[],
  evidenceByAlias: ReadonlyMap<string, EvidenceUnit>,
) {
  return aliases.map((alias) =>
    exactEvidenceRefForAlias(alias, evidenceByAlias),
  );
}

function normalizeIntegratedReviewAliasOutput(
  output: IntegratedReviewV8Output,
  evidenceByAlias: ReadonlyMap<string, EvidenceUnit>,
): IntegratedReviewV5Output {
  const groups = (
    items: Array<{ sessionRef: string; evidenceAliases: string[] }>,
  ) =>
    items.map((item) => ({
      sessionRef: item.sessionRef,
      evidenceRefs: normalizeAliasList(item.evidenceAliases, evidenceByAlias),
    }));
  const groupedItem = <T extends {
    evidenceGroups: Array<{ sessionRef: string; evidenceAliases: string[] }>;
    evidenceAliases: string[];
  }>(item: T) => ({
    ...item,
    evidenceGroups: groups(item.evidenceGroups),
    evidenceRefs: normalizeAliasList(item.evidenceAliases, evidenceByAlias),
  });

  return {
    summary: output.summary,
    commonThemes: output.commonThemes.map(groupedItem),
    shifts: output.shifts.map((item) => ({
      before: item.before,
      after: item.after,
      interpretation: item.interpretation,
      beforeEvidenceRefs: normalizeAliasList(
        item.beforeEvidenceAliases,
        evidenceByAlias,
      ),
      afterEvidenceRefs: normalizeAliasList(
        item.afterEvidenceAliases,
        evidenceByAlias,
      ),
    })),
    tensions: output.tensions.map((item) => ({
      ...groupedItem(item),
      sideA: {
        text: item.sideA.text,
        evidenceRefs: normalizeAliasList(
          item.sideA.evidenceAliases,
          evidenceByAlias,
        ),
      },
      sideB: {
        text: item.sideB.text,
        evidenceRefs: normalizeAliasList(
          item.sideB.evidenceAliases,
          evidenceByAlias,
        ),
      },
    })),
    crossInsights: output.crossInsights.map(groupedItem),
    hypotheses: output.hypotheses.map(groupedItem),
    openQuestions: output.openQuestions.map((item) => ({
      text: item.text,
      evidenceRefs: normalizeAliasList(item.evidenceAliases, evidenceByAlias),
    })),
    nextQuestions: output.nextQuestions.map((item) => ({
      text: item.text,
      evidenceRefs: normalizeAliasList(item.evidenceAliases, evidenceByAlias),
    })),
  };
}

function collectReturnedEvidenceAliases(output: IntegratedReviewV8Output) {
  const aliases: string[] = [];
  const addGrouped = (item: {
    evidenceGroups: Array<{ evidenceAliases: string[] }>;
    evidenceAliases: string[];
  }) => {
    for (const group of item.evidenceGroups) {
      aliases.push(...group.evidenceAliases);
    }
    aliases.push(...item.evidenceAliases);
  };

  for (const item of output.commonThemes) {
    addGrouped(item);
  }
  for (const item of output.shifts) {
    aliases.push(
      ...item.beforeEvidenceAliases,
      ...item.afterEvidenceAliases,
    );
  }
  for (const item of output.tensions) {
    addGrouped(item);
    aliases.push(...item.sideA.evidenceAliases, ...item.sideB.evidenceAliases);
  }
  for (const item of output.crossInsights) {
    addGrouped(item);
  }
  for (const item of output.hypotheses) {
    addGrouped(item);
  }
  for (const item of output.openQuestions) {
    aliases.push(...item.evidenceAliases);
  }
  for (const item of output.nextQuestions) {
    aliases.push(...item.evidenceAliases);
  }
  return aliases;
}

function toStoredEvidence(evidence: ValidatedEvidence): StoredReviewEvidence {
  const evidenceRef =
    evidence.validated && evidence.evidenceRef && evidence.evidenceRef.trim() !== ""
      ? evidence.evidenceRef
      : undefined;
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
    ...(evidenceRef ? { evidenceRef } : {}),
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

  const { input, transport } = buildCanonicalReviewEvidenceInput(sources);
  if (input.analyzableSessionCount < MIN_INTEGRATED_REVIEW_SESSIONS) {
    return {
      ok: false,
      code: "too_few_sessions",
      error: "統合レビューには2件以上のSessionが必要です",
    };
  }
  if (isIntegratedReviewInputTooLong(transport.serializedEvidence)) {
    return {
      ok: false,
      code: "too_long",
      error:
        "選択したSessionの合計が、現在のMVPでレビューできる上限を超えています。Sessionを減らしてください。",
    };
  }

  let parsedUnknown: unknown;
  let usedModel = config.model;
  const outputSchema = createIntegratedReviewV8OutputSchema(
    transport.aliasWidth,
  );
  try {
    const generated = await deps.generateStructured({
      model: config.model,
      system: INTEGRATED_REVIEW_SYSTEM_PROMPT,
      user: buildIntegratedReviewUserPromptV8(
        transport.serializedEvidence,
        transport.aliasWidth,
      ),
      schema: outputSchema,
      schemaName: INTEGRATED_REVIEW_SCHEMA_NAME,
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

  const parsed = outputSchema.safeParse(parsedUnknown);
  if (!parsed.success) {
    return {
      ok: false,
      code: "schema",
      error: "分析結果の形式が不正だったため保存しませんでした。",
    };
  }
  const returnedAliases = collectReturnedEvidenceAliases(parsed.data);
  const aliasDiagnostics = diagnoseReviewEvidenceAliases(
    returnedAliases,
    transport,
  );
  const normalized = normalizeIntegratedReviewAliasOutput(
    parsed.data,
    transport.evidenceByAlias,
  );

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

  const commonThemes = normalized.commonThemes
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

  const shifts: StoredReviewShiftItem[] = normalized.shifts.map((item) => {
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

  const tensions = normalized.tensions.map((item) => {
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

  const crossInsights = normalized.crossInsights
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

  const hypotheses = normalized.hypotheses
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

  const openQuestions = normalized.openQuestions
    .slice(0, MAX_OPEN_QUESTIONS)
    .map((item) => {
    const evidence = resolve(item.evidenceRefs);
    return storeItem(item.text, evidence, validateOptionalEvidence(evidence), {
      supportType: "direct",
    });
  });

  const nextQuestions = normalized.nextQuestions
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

  const groundingValidity = evaluateReviewGroundingValidity({
    aliasAttemptCount: aliasDiagnostics.totalAliasReferences,
    items: allItems,
  });

  if (!groundingValidity.valid) {
    return {
      ok: false,
      code: "all_review_evidence_invalid",
      reason: "evidence_validation_failed",
      error: "観測結果の根拠を確認できなかったため、保存しませんでした。",
      groundingDiagnostic: {
        aliasAttemptCount: aliasDiagnostics.totalAliasReferences,
        resolvedAliasCount: aliasDiagnostics.exactMemberCount,
        aliasDiagnostics,
        usableValidatedEvidenceCount:
          groundingValidity.usableValidatedEvidenceCount,
      },
    };
  }

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
    summary: normalized.summary,
    commonThemes,
    shifts,
    tensions,
    crossInsights,
    hypotheses,
    openQuestions,
    nextQuestions,
    settings: defaultReviewSettings(
      config.provider,
      REVIEW_EVIDENCE_TRANSPORT_VERSION,
    ),
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
  lifecycle?: {
    db?: ObservationConceptSupportDb;
    reconcile?: ObservationConceptRelationReconcileFn;
  },
): Promise<IntegratedReviewResult> {
  const { createIntegratedReviewWithRecovery } = await import(
    "@/lib/reviews/integrated-review-processor"
  );
  return createIntegratedReviewWithRecovery(sources, title, lifecycle);
}
