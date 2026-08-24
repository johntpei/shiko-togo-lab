import type { DualPipelineOrchestratorExecutionResult } from "./execution-types";
import type {
  ConceptSessionPlanRow,
  DualPipelineOrchestratorPlan,
  ReviewStageAction,
} from "./types";
import { uniqueSortedSessionIds } from "./plan";

export const PROCESSING_PLAN_PRESENTATION_VERSION =
  "processing-plan-presentation-v0";

export type ProcessingConceptSessionPresentation = {
  sessionId: string;
  title: string | null;
  stateLabel: string;
  detail: string | null;
};

export type ProcessingPlanPresentation = {
  version: typeof PROCESSING_PLAN_PRESENTATION_VERSION;
  selectionKey: string;
  sessionCount: number;
  invalidSelection: boolean;
  invalidReason: string | null;
  concept: {
    summary: string;
    sessions: ProcessingConceptSessionPresentation[];
    needsProcessingCount: number;
    coveredCount: number;
  };
  review: {
    summary: string;
    detail: string | null;
    minimumSessionsRequired: number;
  };
  canExecute: boolean;
  executeDisabledReason: string | null;
  allUpToDate: boolean;
  footnote: string;
};

export type ProcessingExecutionPresentation = {
  headline: string;
  detail: string | null;
  recoveryHint: string | null;
  conceptSummary: string | null;
  reviewSummary: string | null;
  status: DualPipelineOrchestratorExecutionResult["status"];
  conceptFailures: ProcessingConceptFailurePresentation[];
};

export type ProcessingConceptFailurePresentation = {
  sessionId: string;
  title: string | null;
  status: "blocked" | "failed";
  executionMode: "fresh" | "resumed" | null;
  failureStage: string | null;
  failureReason: string | null;
  failureCode: string | null;
  extractionCalls: number;
  assessmentCalls: number;
};

function selectionKey(sessionIds: readonly string[]) {
  return uniqueSortedSessionIds(sessionIds).join("\u001f");
}

function conceptStateLabel(row: ConceptSessionPlanRow): {
  label: string;
  detail: string | null;
} {
  if (row.state === "covered") {
    return { label: "更新済み", detail: null };
  }
  if (row.state === "needs_processing") {
    return { label: "更新予定", detail: null };
  }
  if (row.state === "blocked") {
    return { label: "今回は更新できません", detail: null };
  }
  return { label: "対象外", detail: "Sessionが見つかりません" };
}

function reviewBlockingCopy(blockingReason: string | null): string | null {
  if (!blockingReason) {
    return null;
  }
  if (blockingReason === "review_requires_at_least_two_sessions") {
    return "2つ以上の対話を選ぶと利用できます。";
  }
  if (blockingReason === "legacy_review_completion_unknown") {
    return "以前のレビュー履歴があるため、この組み合わせは自動では処理しません。";
  }
  if (blockingReason === "ambiguous_pending_reviews") {
    return "処理途中のレビューが複数見つかったため、自動では再開できません。";
  }
  if (blockingReason === "no_selection") {
    return "対話を選んでください。";
  }
  if (blockingReason === "missing_session") {
    return "選択した対話の一部が見つかりません。";
  }
  return "今回は実行できません。";
}

function reviewActionCopy(action: ReviewStageAction, blockingReason: string | null): {
  summary: string;
  detail: string | null;
} {
  if (action === "not_needed") {
    return { summary: "観測済み", detail: null };
  }
  if (action === "run_for_selection") {
    return { summary: "新しく観測します", detail: null };
  }
  if (action === "resume_projection") {
    return {
      summary: "保存済みの結果から続きを処理します",
      detail: null,
    };
  }
  if (action === "blocked") {
    return {
      summary: "今回は実行できません",
      detail: reviewBlockingCopy(blockingReason),
    };
  }
  if (action === "no_selection") {
    return {
      summary: "対話を選んでください",
      detail: null,
    };
  }
  return {
    summary: "今回は実行できません",
    detail: reviewBlockingCopy(blockingReason),
  };
}

function conceptActionable(plan: DualPipelineOrchestratorPlan) {
  return plan.concept.needsProcessingSessionIds.length > 0;
}

function reviewActionable(plan: DualPipelineOrchestratorPlan) {
  return (
    plan.review.action === "run_for_selection" ||
    plan.review.action === "resume_projection"
  );
}

export function buildProcessingPlanPresentation(input: {
  plan: DualPipelineOrchestratorPlan;
  sessionTitles?: ReadonlyMap<string, string>;
}): ProcessingPlanPresentation {
  const { plan } = input;
  const sessionIds = plan.selection.requestedSessionIds;
  const key = selectionKey(sessionIds);
  const invalidSelection = plan.selection.invalidSessionIds.length > 0;

  const conceptSessions = plan.concept.sessions
    .filter((row) => row.state !== "invalid")
    .map((row) => {
      const mapped = conceptStateLabel(row);
      return {
        sessionId: row.sessionId,
        title: input.sessionTitles?.get(row.sessionId) ?? null,
        stateLabel: mapped.label,
        detail: mapped.detail,
      };
    });

  const needsProcessingCount = plan.concept.needsProcessingSessionIds.length;
  const coveredCount = plan.concept.coveredSessionIds.length;
  const conceptSummary =
    needsProcessingCount > 0
      ? `更新予定: ${needsProcessingCount}件`
      : coveredCount > 0
        ? "更新済み"
        : "対象なし";

  const reviewCopy = reviewActionCopy(
    plan.review.action,
    plan.review.blockingReason,
  );

  const conceptCanRun = conceptActionable(plan);
  const reviewCanRun = reviewActionable(plan);
  const allUpToDate =
    !invalidSelection &&
    sessionIds.length > 0 &&
    !conceptCanRun &&
    plan.review.action === "not_needed";

  let canExecute = false;
  let executeDisabledReason: string | null = null;

  if (sessionIds.length === 0) {
    executeDisabledReason = "対話を1件以上選んでください。";
  } else if (invalidSelection) {
    executeDisabledReason = "選択した対話の一部が見つかりません。";
  } else if (allUpToDate) {
    executeDisabledReason = "更新が必要な項目はありません。";
  } else if (conceptCanRun || reviewCanRun) {
    canExecute = true;
  } else {
    executeDisabledReason =
      reviewCopy.detail ??
      conceptSessions.find((row) => row.stateLabel.includes("できません"))
        ?.detail ??
      "今回は実行できる項目がありません。";
  }

  return {
    version: PROCESSING_PLAN_PRESENTATION_VERSION,
    selectionKey: key,
    sessionCount: sessionIds.length,
    invalidSelection,
    invalidReason: invalidSelection
      ? "選択した対話の一部が見つかりません。"
      : null,
    concept: {
      summary: conceptSummary,
      sessions: conceptSessions,
      needsProcessingCount,
      coveredCount,
    },
    review: {
      summary: reviewCopy.summary,
      detail: reviewCopy.detail,
      minimumSessionsRequired: 2,
    },
    canExecute,
    executeDisabledReason,
    allUpToDate,
    footnote: "この操作では選択した対話だけを処理します。",
  };
}

export function buildProcessingExecutionPresentation(
  result: DualPipelineOrchestratorExecutionResult,
  sessionTitles?: ReadonlyMap<string, string>,
): ProcessingExecutionPresentation {
  const conceptExecuted = result.summary.conceptExecutedCount;
  const conceptCompleted = result.concept.sessions.filter(
    (row) =>
      row.processorStatus === "completed" ||
      row.processorStatus === "already_covered" ||
      (row.action === "not_needed" && row.planState === "covered"),
  ).length;
  const conceptFailed = result.summary.conceptFailedCount;
  const conceptFailures: ProcessingConceptFailurePresentation[] =
    result.concept.sessions.flatMap((row) => {
      if (
        !row.failureDiagnostic ||
        (row.processorStatus !== "blocked" && row.processorStatus !== "failed")
      ) {
        return [];
      }
      return [
        {
          sessionId: row.sessionId,
          title: sessionTitles?.get(row.sessionId) ?? null,
          status: row.processorStatus,
          executionMode: row.executionMode,
          ...row.failureDiagnostic,
        },
      ];
    });

  let conceptSummary: string | null = null;
  if (conceptExecuted > 0) {
    conceptSummary =
      conceptFailed > 0
        ? `テーマの観測: ${conceptCompleted}件を更新しました（一部未完了）`
        : `テーマの観測: ${conceptCompleted}件を更新しました`;
  } else if (
    result.concept.sessions.some((row) => row.action === "not_needed")
  ) {
    conceptSummary = "テーマの観測: 更新済み";
  }

  let reviewSummary: string | null = null;
  if (result.review.resolvedAction === "not_needed") {
    reviewSummary = "対話をまたいだ観測: 観測済み";
  } else if (result.review.processorStatus === "completed") {
    reviewSummary = "対話をまたいだ観測: 完了しました";
  } else if (result.review.processorStatus === "projection_failed") {
    reviewSummary = "対話をまたいだ観測: 保存済みですが反映が未完了です";
  } else if (result.review.resolvedAction === "blocked") {
    reviewSummary = "対話をまたいだ観測: 今回は実行できませんでした";
  }

  let headline = "観測を更新しました";
  let detail: string | null = null;
  let recoveryHint: string | null = null;

  if (result.status === "blocked") {
    headline = "実行できませんでした";
    detail = result.reason ?? "選択内容を確認してください。";
  } else if (result.status === "partial") {
    headline = "一部の観測を更新しました";
    if (result.review.processorStatus === "projection_failed") {
      detail =
        "レビューは保存されましたが、観測への反映が完了していません。";
      recoveryHint =
        "もう一度「観測を更新する」を実行すると、保存済みの状態から続けられます。";
    } else if (conceptFailed > 0) {
      detail = "未完了の項目があります。";
      recoveryHint =
        "もう一度「観測を更新する」を実行すると、保存済みの状態から続けられます。";
    }
  } else if (result.status === "failed") {
    headline = "処理に失敗しました";
    detail = "時間をおいて再度お試しください。";
  }

  if (
    result.review.resolvedAction === "resume_projection" &&
    result.review.processorStatus === "completed"
  ) {
    recoveryHint = null;
  }

  return {
    headline,
    detail,
    recoveryHint,
    conceptSummary,
    reviewSummary,
    status: result.status,
    conceptFailures,
  };
}

export function processingSelectionKey(sessionIds: readonly string[]) {
  return selectionKey(sessionIds);
}
