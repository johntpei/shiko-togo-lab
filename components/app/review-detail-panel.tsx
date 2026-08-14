import type { ReactNode } from "react";
import type {
  StoredReviewItem,
  StoredReviewPayload,
  StoredReviewShiftItem,
} from "@/lib/ai/review-schemas";
import { ReviewEvidenceList } from "@/components/app/review-evidence-list";

const REVIEW_FAILURE_LABELS: Record<string, string> = {
  insufficient_distinct_sessions: "複数Sessionの根拠がありません",
  missing_user_evidence: "本人の発言根拠がありません",
  invalid_chronology: "時系列が逆転しています",
  invalid_evidence_ref: "根拠参照が無効です",
  evidence_role_mismatch: "根拠の発言者が分類に合いません",
  unsupported_cross_session_claim: "複数Sessionをまたぐ根拠になっていません",
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

function visibleItems<T extends { semanticValid?: boolean }>(items: T[]) {
  return items.filter((item) => item.semanticValid !== false);
}

function hiddenItems<T extends { semanticValid?: boolean }>(items: T[]) {
  return items.filter((item) => item.semanticValid === false);
}

function ItemBlock({
  item,
  caption,
  showFailureReasons,
}: {
  item: StoredReviewItem;
  caption?: string;
  showFailureReasons: boolean;
}) {
  return (
    <li>
      <p className="text-sm leading-7 text-ink">{item.text}</p>
      {item.rationale ? (
        <>
          <p className="mt-2 text-[11px] font-bold text-muted">
            なぜそう考えられるか
          </p>
          <p className="mt-1 text-sm leading-7 text-muted">{item.rationale}</p>
        </>
      ) : null}
      {caption ? (
        <p className="mt-1 text-[11px] font-bold text-muted">{caption}</p>
      ) : null}
      <ReviewEvidenceList
        evidence={item.evidence}
        showFailureReasons={showFailureReasons}
      />
    </li>
  );
}

function ShiftBlock({
  item,
  showFailureReasons,
}: {
  item: StoredReviewShiftItem;
  showFailureReasons: boolean;
}) {
  return (
    <li>
      <p className="text-[11px] font-bold text-muted">以前</p>
      <p className="mt-1 text-sm leading-7 text-ink">{item.before}</p>
      <p className="mt-3 text-center text-xs font-bold text-muted">↓</p>
      <p className="mt-3 text-[11px] font-bold text-muted">現在</p>
      <p className="mt-1 text-sm leading-7 text-ink">{item.after}</p>
      <p className="mt-3 text-sm leading-7 text-ink">{item.interpretation}</p>
      <p className="mt-1 text-[11px] font-bold text-muted">
        AIによる横断的な解釈
      </p>
      <ReviewEvidenceList
        evidence={item.evidence}
        showFailureReasons={showFailureReasons}
      />
    </li>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="mt-8">
      <h3 className="border-b border-line pb-2 text-sm font-bold text-ink">
        {title}
      </h3>
      <ul className="mt-3 grid gap-5">{children}</ul>
    </section>
  );
}

export function ReviewDetailPanel({
  title,
  model,
  promptVersion,
  createdAt,
  sessionCount,
  payload,
  showFailureReasons = false,
}: {
  title: string;
  model: string;
  promptVersion: string;
  createdAt: string;
  sessionCount: number;
  payload: StoredReviewPayload;
  showFailureReasons?: boolean;
}) {
  const themes = visibleItems(payload.commonThemes);
  const shifts = visibleItems(payload.shifts);
  const tensions = visibleItems(payload.tensions);
  const insights = visibleItems(payload.crossInsights);
  const hypotheses = visibleItems(payload.hypotheses);
  const openQuestions = visibleItems(payload.openQuestions);
  const nextQuestions = visibleItems(payload.nextQuestions);
  const hidden = [
    ...hiddenItems(payload.commonThemes),
    ...hiddenItems(payload.shifts),
    ...hiddenItems(payload.tensions),
    ...hiddenItems(payload.crossInsights),
    ...hiddenItems(payload.hypotheses),
    ...hiddenItems(payload.openQuestions),
    ...hiddenItems(payload.nextQuestions),
  ];
  const metrics = payload.metrics;

  return (
    <div className="rounded-2xl border border-line bg-white p-5 shadow-[0_12px_40px_-30px_rgba(15,23,42,0.45)] sm:p-6">
      <p className="text-xs font-bold tracking-[0.18em] text-blue-600">
        統合レビュー
      </p>
      <h2 className="mt-2 text-xl font-black tracking-tight text-ink">
        {title}
      </h2>
      <p className="mt-3 text-[11px] text-muted">
        作成 {formatAnalyzedAt(createdAt)}
        <span className="mx-2 text-line">/</span>
        {sessionCount} Sessions
        <span className="mx-2 text-line">/</span>
        使用モデル {model}
        <span className="mx-2 text-line">/</span>
        {promptVersion}
        {metrics && metrics.evidenceCount > 0 ? (
          <>
            <span className="mx-2 text-line">/</span>
            根拠 {metrics.validatedCount}/{metrics.evidenceCount}（
            {formatPercent(metrics.validationRate)}）
          </>
        ) : null}
        {metrics?.semanticItemCount ? (
          <>
            <span className="mx-2 text-line">/</span>
            意味的根拠 {metrics.semanticValidCount}/{metrics.semanticItemCount}
            （{formatPercent(metrics.semanticValidationRate ?? 0)}）
          </>
        ) : null}
      </p>

      <section className="mt-6">
        <h3 className="border-b border-line pb-2 text-sm font-bold text-ink">
          概要
        </h3>
        <p className="mt-3 text-sm leading-7 text-ink">{payload.summary}</p>
      </section>

      {insights.length > 0 ? (
        <Section title="新しく見えたこと">
          {insights.map((item, index) => (
            <ItemBlock
              key={`insight-${index}`}
              item={item}
              caption="AIによる横断的な解釈"
              showFailureReasons={showFailureReasons}
            />
          ))}
        </Section>
      ) : null}

      {shifts.length > 0 ? (
        <Section title="考えの変化">
          {shifts.map((item, index) => (
            <ShiftBlock
              key={`shift-${index}`}
              item={item}
              showFailureReasons={showFailureReasons}
            />
          ))}
        </Section>
      ) : null}

      {themes.length > 0 ? (
        <Section title="共通テーマ">
          {themes.map((item, index) => (
            <ItemBlock
              key={`theme-${index}`}
              item={item}
              showFailureReasons={showFailureReasons}
            />
          ))}
        </Section>
      ) : null}

      {tensions.length > 0 ? (
        <Section title="緊張関係">
          {tensions.map((item, index) => (
            <ItemBlock
              key={`tension-${index}`}
              item={item}
              caption="両立条件を考えるポイント / AIによる横断的な解釈"
              showFailureReasons={showFailureReasons}
            />
          ))}
        </Section>
      ) : null}

      {hypotheses.length > 0 ? (
        <Section title="仮説">
          {hypotheses.map((item, index) => (
            <ItemBlock
              key={`hyp-${index}`}
              item={item}
              caption="仮説（原文にそのまま書いてある事実ではありません）"
              showFailureReasons={showFailureReasons}
            />
          ))}
        </Section>
      ) : null}

      {openQuestions.length > 0 ? (
        <Section title="未解決の問い">
          {openQuestions.map((item, index) => (
            <ItemBlock
              key={`open-${index}`}
              item={item}
              showFailureReasons={showFailureReasons}
            />
          ))}
        </Section>
      ) : null}

      {nextQuestions.length > 0 ? (
        <Section title="次に考える問い">
          {nextQuestions.map((item, index) => (
            <li key={`next-${index}`}>
              <p className="text-sm leading-7 text-ink">
                {index + 1}. {item.text}
              </p>
              <ReviewEvidenceList
                evidence={item.evidence}
                showFailureReasons={showFailureReasons}
              />
            </li>
          ))}
        </Section>
      ) : null}

      {showFailureReasons && hidden.length > 0 ? (
        <details className="mt-8 rounded-xl border border-line bg-canvas px-3 py-2">
          <summary className="cursor-pointer text-[11px] font-bold text-muted">
            Semantic Guardで除外した項目 {hidden.length}件
          </summary>
          <ul className="mt-2 grid gap-2">
            {hidden.map((item, index) => (
              <li key={`hidden-${index}`} className="text-[11px] leading-5 text-muted">
                {item.invalidReason ? (
                  <span className="font-bold">
                    {item.invalidReason}
                    {REVIEW_FAILURE_LABELS[item.invalidReason]
                      ? ` / ${REVIEW_FAILURE_LABELS[item.invalidReason]}`
                      : ""}
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
