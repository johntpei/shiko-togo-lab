import type { AnalysisKind, StoredAnalysisPayload } from "@/lib/ai/schemas";
import { EVIDENCE_FAILURE_LABELS } from "@/lib/ai/evidence";
import { EvidenceList } from "@/components/app/evidence-list";

const KIND_ORDER: AnalysisKind[] = [
  "fact",
  "insight",
  "hypothesis",
  "decision",
  "open_question",
  "action",
];

const KIND_LABELS: Record<AnalysisKind, string> = {
  fact: "事実",
  insight: "気づき",
  hypothesis: "仮説",
  decision: "決定",
  action: "次の行動",
  open_question: "未解決の問い",
};

const SEMANTIC_FAILURE_LABELS: Record<string, string> = {
  missing_user_evidence: "本人の発言根拠がありません",
  invalid_evidence_ref: "根拠参照が無効です",
  evidence_role_mismatch: "根拠の発言者（本人/AI）が分類に合いません",
  unsupported_subject_kind: "subject と kind の組み合わせが不正です",
};

function formatAnalyzedAt(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatPercent(rate: number) {
  return `${Math.round(rate * 100)}%`;
}

function formatQuality(payload: StoredAnalysisPayload) {
  const metrics = payload.metrics;
  if (!metrics) {
    return [];
  }
  const lines: string[] = [];
  if (metrics.evidenceCount > 0) {
    lines.push(
      `根拠 ${metrics.validatedCount}/${metrics.evidenceCount}（${formatPercent(metrics.validationRate)}）`,
    );
  }
  if (
    metrics.semanticItemCount != null &&
    metrics.semanticValidCount != null &&
    metrics.semanticValidationRate != null &&
    metrics.semanticItemCount > 0
  ) {
    lines.push(
      `意味的根拠 ${metrics.semanticValidCount}/${metrics.semanticItemCount}（${formatPercent(metrics.semanticValidationRate)}）`,
    );
  }
  return lines;
}

function isDisplayedItem(
  item: StoredAnalysisPayload["items"][number],
) {
  return item.semanticValid !== false;
}

function isInterpretiveInsight(
  item: StoredAnalysisPayload["items"][number],
) {
  if (item.kind !== "insight") {
    return false;
  }
  if (item.subject === "interpretation") {
    return true;
  }
  return item.subject == null && item.evidence.length >= 2;
}

export function SessionAnalysisPanel({
  sessionId,
  model,
  promptVersion,
  createdAt,
  payload,
  showFailureReasons = false,
}: {
  sessionId: string;
  model: string;
  promptVersion?: string;
  createdAt: string;
  payload: StoredAnalysisPayload;
  showFailureReasons?: boolean;
}) {
  const qualityLabels = formatQuality(payload);
  const visibleItems = payload.items.filter(isDisplayedItem);
  const hiddenItems = payload.items.filter((item) => !isDisplayedItem(item));

  return (
    <div className="rounded-2xl border border-line bg-white p-5 shadow-[0_12px_40px_-30px_rgba(15,23,42,0.45)] sm:p-6">
      <p className="text-[11px] text-muted">
        分析日時 {formatAnalyzedAt(createdAt)}
        <span className="mx-2 text-line">/</span>
        使用モデル {model}
        {promptVersion ? (
          <>
            <span className="mx-2 text-line">/</span>
            {promptVersion}
          </>
        ) : null}
        {qualityLabels.map((label) => (
          <span key={label}>
            <span className="mx-2 text-line">/</span>
            {label}
          </span>
        ))}
      </p>

      <h3 className="mt-4 text-sm font-bold text-ink">概要</h3>
      <p className="mt-2 text-sm leading-7 text-ink">{payload.summary}</p>

      {KIND_ORDER.map((kind) => {
        const items = visibleItems.filter((item) => item.kind === kind);
        if (items.length === 0) {
          return null;
        }
        return (
          <section key={kind} className="mt-6">
            <h3 className="border-b border-line pb-2 text-sm font-bold text-ink">
              {KIND_LABELS[kind]}
            </h3>
            <ul className="mt-3 grid gap-4">
              {items.map((item, index) => (
                <li key={`${kind}-${index}`}>
                  <p className="text-sm leading-7 text-ink">{item.text}</p>
                  {isInterpretiveInsight(item) ? (
                    <p className="mt-1 text-[11px] font-bold text-muted">
                      AIによる統合的な解釈
                    </p>
                  ) : null}
                  {kind === "hypothesis" ? (
                    <p className="mt-1 text-[11px] font-bold text-muted">
                      仮説（原文にそのまま書いてある事実ではありません）
                    </p>
                  ) : null}
                  {item.evidence.length > 0 ? (
                    <EvidenceList
                      sessionId={sessionId}
                      evidence={item.evidence}
                      showFailureReasons={showFailureReasons}
                    />
                  ) : item.unsupportedClaim ? (
                    <p
                      title={EVIDENCE_FAILURE_LABELS.unsupported_claim}
                      className="mt-2 text-xs text-amber-800"
                    >
                      原文で確認できず
                    </p>
                  ) : null}
                  {item.unsupportedClaim &&
                  (kind === "decision" || kind === "action") &&
                  item.evidence.length > 0 ? (
                    <p className="mt-1 text-[11px] text-amber-800">
                      本人の発言根拠が確認できません
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      {showFailureReasons && hiddenItems.length > 0 ? (
        <details className="mt-6 rounded-xl border border-line bg-canvas px-3 py-2">
          <summary className="cursor-pointer text-[11px] font-bold text-muted">
            Semantic Guardで除外した項目 {hiddenItems.length}件
          </summary>
          <ul className="mt-2 grid gap-2">
            {hiddenItems.map((item, index) => (
              <li
                key={`hidden-${item.kind}-${index}`}
                className="text-[11px] leading-5 text-muted"
              >
                <span className="font-bold">
                  {KIND_LABELS[item.kind]}
                  {item.subject ? ` / ${item.subject}` : ""}
                </span>
                {item.invalidReason ? (
                  <span className="ml-1">
                    ({item.invalidReason}
                    {SEMANTIC_FAILURE_LABELS[item.invalidReason]
                      ? ` / ${SEMANTIC_FAILURE_LABELS[item.invalidReason]}`
                      : ""}
                    )
                  </span>
                ) : null}
                <span className="mt-0.5 block">{item.text}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
