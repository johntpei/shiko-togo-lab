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
  open_question: "未解決の問い",
  action: "次の行動",
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

function formatValidationRate(payload: StoredAnalysisPayload) {
  const metrics = payload.metrics;
  if (!metrics || metrics.evidenceCount === 0) {
    return null;
  }
  const percent = Math.round(metrics.validationRate * 100);
  return `根拠一致 ${metrics.validatedCount}/${metrics.evidenceCount}（${percent}%）`;
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
  const rateLabel = formatValidationRate(payload);

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
        {rateLabel ? (
          <>
            <span className="mx-2 text-line">/</span>
            {rateLabel}
          </>
        ) : null}
      </p>

      <h3 className="mt-4 text-sm font-bold text-ink">概要</h3>
      <p className="mt-2 text-sm leading-7 text-ink">{payload.summary}</p>

      {KIND_ORDER.map((kind) => {
        const items = payload.items.filter((item) => item.kind === kind);
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
                  {kind === "insight" && item.evidence.length >= 2 ? (
                    <p className="mt-1 text-[11px] font-bold text-muted">
                      AIによる統合的な解釈
                    </p>
                  ) : null}
                  {kind === "hypothesis" ? (
                    <p className="mt-1 text-[11px] font-bold text-muted">
                      Evidenceから導いた仮説（原文にそのまま書いてある事実ではありません）
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
    </div>
  );
}
