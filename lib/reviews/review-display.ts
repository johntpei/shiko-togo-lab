import type { ReviewSupportType } from "@/lib/ai/review-schemas";

export type ReviewDisplayKind =
  | "shift"
  | "theme"
  | "tension"
  | "insight"
  | "hypothesis"
  | "openQuestion"
  | "nextQuestion";

type EvidenceMetrics = {
  evidenceCount: number;
  validatedCount: number;
  validationRate: number;
};

type GuardMetrics = {
  hardItemCount?: number;
  hardValidCount?: number;
  hardExcludedCount?: number;
  interpretationItemCount?: number;
  interpretationValidCount?: number;
  interpretationValidationRate?: number;
};

export function supportTypeLabel(
  kind: ReviewDisplayKind,
  supportType?: ReviewSupportType,
): string | null {
  if (!supportType || kind === "nextQuestion") {
    return null;
  }
  if (kind === "openQuestion" && supportType === "direct") {
    return "過去Sessionで確認された問い";
  }
  if (kind === "shift" && supportType === "direct") {
    return "元発言から確認";
  }
  if (supportType === "cross_session_interpretation") {
    return "AIによる横断的な解釈";
  }
  if (supportType === "hypothesis") {
    return "まだ確認されていない仮説";
  }
  if (supportType === "direct") {
    return "元発言から確認";
  }
  return null;
}

function formatPercent(rate: number) {
  return `${Math.round(rate * 100)}%`;
}

export function formatEvidenceMetric(metrics?: EvidenceMetrics | null) {
  if (!metrics || metrics.evidenceCount <= 0) {
    return null;
  }
  return `根拠 ${metrics.validatedCount}/${metrics.evidenceCount}（${formatPercent(metrics.validationRate)}）`;
}

export function formatInterpretationMetric(metrics?: GuardMetrics | null) {
  if (typeof metrics?.interpretationItemCount !== "number") {
    return null;
  }
  const total = metrics.interpretationItemCount;
  const valid = metrics.interpretationValidCount ?? 0;
  const rate =
    typeof metrics.interpretationValidationRate === "number"
      ? metrics.interpretationValidationRate
      : total === 0
        ? 0
        : valid / total;
  return `横断解釈 ${valid}/${total}（${formatPercent(rate)}）`;
}

export function hardGuardExcludedCount(metrics?: GuardMetrics | null) {
  if (typeof metrics?.hardExcludedCount === "number") {
    return metrics.hardExcludedCount;
  }
  if (
    typeof metrics?.hardItemCount === "number" &&
    typeof metrics?.hardValidCount === "number"
  ) {
    return metrics.hardItemCount - metrics.hardValidCount;
  }
  return null;
}

export function formatHardGuardExcluded(metrics?: GuardMetrics | null) {
  const excluded = hardGuardExcludedCount(metrics);
  if (excluded == null) {
    return null;
  }
  return `Hard Guard除外 ${excluded}件`;
}
