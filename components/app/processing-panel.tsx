"use client";

import { useActionState, useMemo } from "react";
import { LoaderCircle, Sparkles } from "lucide-react";
import {
  executeProcessingAction,
  loadProcessingPlanAction,
  type ExecuteProcessingState,
  type LoadProcessingPlanState,
} from "@/app/(app)/reviews/processing-actions";
import { processingSelectionKey } from "@/lib/processing-orchestrator/presentation";

const initialPlanState: LoadProcessingPlanState = { plan: null, error: null };
const initialExecuteState: ExecuteProcessingState = { result: null, error: null };

export function ProcessingPanel({
  selectedSessionIds,
  aiReady,
  aiMessage,
}: {
  selectedSessionIds: string[];
  aiReady: boolean;
  aiMessage: string | null;
}) {
  const selectionKey = useMemo(
    () => processingSelectionKey(selectedSessionIds),
    [selectedSessionIds],
  );
  const [planState, loadPlanAction, planPending] = useActionState(
    loadProcessingPlanAction,
    initialPlanState,
  );
  const [executeState, executeAction, executePending] = useActionState(
    executeProcessingAction,
    initialExecuteState,
  );

  const freshPlan =
    planState.plan && planState.plan.selectionKey === selectionKey
      ? planState.plan
      : null;
  const planStale =
    planState.plan !== null && planState.plan.selectionKey !== selectionKey;

  const canLoadPlan = selectedSessionIds.length > 0 && !planPending;
  const canExecute =
    aiReady &&
    !executePending &&
    !planPending &&
    freshPlan !== null &&
    freshPlan.canExecute;

  return (
    <section className="rounded-2xl border border-blue-100 bg-brand-soft/40 p-5">
      <p className="text-[11px] font-bold tracking-[0.14em] text-blue-700">
        観測を更新
      </p>
      <p className="mt-2 text-sm leading-7 text-muted">
        選んだ対話から、テーマの観測と対話をまたいだ観測を更新します。実行内容は事前に確認できます。
      </p>

      {selectedSessionIds.length === 0 ? (
        <p className="mt-4 text-sm text-muted">
          対話を1件以上選ぶと、実行内容を確認して観測を更新できます。
        </p>
      ) : (
        <>
          <form action={loadPlanAction} className="mt-4">
            {selectedSessionIds.map((id) => (
              <input key={id} type="hidden" name="sessionIds" value={id} />
            ))}
            <button
              type="submit"
              disabled={!canLoadPlan}
              className="rounded-xl border border-line bg-white px-4 py-2 text-sm font-bold text-ink hover:border-blue-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {planPending ? "確認中…" : "実行内容を確認する"}
            </button>
          </form>

          {planStale ? (
            <p className="mt-3 text-xs font-bold text-amber-800">
              選択が変わったため、もう一度「実行内容を確認する」を押してください。
            </p>
          ) : null}

          {planState.error ? (
            <p className="mt-3 text-xs font-bold text-rose-700">{planState.error}</p>
          ) : null}

          {freshPlan && !executeState.result ? (
            <div className="mt-4 grid gap-3 rounded-xl border border-line bg-white p-4 text-sm">
              <div>
                <p className="text-xs font-bold text-muted">テーマの観測</p>
                <p className="mt-1 font-bold text-ink">{freshPlan.concept.summary}</p>
                {freshPlan.concept.sessions.length > 0 ? (
                  <ul className="mt-2 grid gap-1 text-xs text-muted">
                    {freshPlan.concept.sessions.map((session) => (
                      <li key={session.sessionId}>
                        {session.title ?? "選択した対話"} — {session.stateLabel}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
              <div>
                <p className="text-xs font-bold text-muted">対話をまたいだ観測</p>
                <p className="mt-1 text-xs leading-5 text-muted">
                  選んだ複数の対話をまとめて見たときの変化やつながりを観測します。
                </p>
                <p className="mt-2 font-bold text-ink">{freshPlan.review.summary}</p>
                {freshPlan.review.detail ? (
                  <p className="mt-1 text-xs text-muted">{freshPlan.review.detail}</p>
                ) : null}
              </div>
              <p className="text-xs text-muted">{freshPlan.footnote}</p>
              {freshPlan.allUpToDate ? (
                <p className="text-xs font-bold text-emerald-800">
                  更新が必要な項目はありません。
                </p>
              ) : null}
            </div>
          ) : null}

          <form action={executeAction} className="mt-4">
            {selectedSessionIds.map((id) => (
              <input key={`exec-${id}`} type="hidden" name="sessionIds" value={id} />
            ))}
            {!aiReady ? (
              <p className="text-sm font-bold text-amber-800">
                {aiMessage ?? "OpenAI APIキーが設定されていません"}
              </p>
            ) : (
              <button
                type="submit"
                disabled={!canExecute}
                className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {executePending ? (
                  <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Sparkles className="size-4" aria-hidden="true" />
                )}
                {executePending ? "処理中…" : "観測を更新する"}
              </button>
            )}
            {!canExecute && freshPlan?.executeDisabledReason ? (
              <p className="mt-2 text-xs text-muted">
                {freshPlan.executeDisabledReason}
              </p>
            ) : null}
          </form>
        </>
      )}

      {executeState.error ? (
        <p className="mt-3 text-xs font-bold text-rose-700">{executeState.error}</p>
      ) : null}

      {executeState.result ? (
        <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm">
          <p className="font-bold text-emerald-900">{executeState.result.headline}</p>
          {executeState.result.detail ? (
            <p className="mt-1 text-emerald-900/80">{executeState.result.detail}</p>
          ) : null}
          {executeState.result.conceptSummary ? (
            <p className="mt-2 text-emerald-900/90">
              {executeState.result.conceptSummary}
            </p>
          ) : null}
          {executeState.result.reviewSummary ? (
            <p className="mt-1 text-emerald-900/90">
              {executeState.result.reviewSummary}
            </p>
          ) : null}
          {executeState.result.recoveryHint ? (
            <p className="mt-2 text-xs text-emerald-900/80">
              {executeState.result.recoveryHint}
            </p>
          ) : null}
          <p className="mt-3 text-xs text-emerald-900/70">
            最新の状態を確認するには、もう一度「実行内容を確認する」を押してください。
          </p>
        </div>
      ) : null}
    </section>
  );
}
