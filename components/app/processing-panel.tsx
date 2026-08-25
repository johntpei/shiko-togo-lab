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
          {executeState.result.conceptFailures.length > 0 ? (
            <div className="mt-3 border-t border-emerald-200 pt-3 text-xs text-emerald-950/80">
              <p className="font-bold">未完了のテーマの観測</p>
              <ul className="mt-2 grid gap-2">
                {executeState.result.conceptFailures.map((failure) => (
                  <li key={failure.sessionId}>
                    <p>
                      {failure.title ?? "選択した対話"} — 処理段階:{" "}
                      {failure.failureStage ?? "特定できません"}
                    </p>
                    <details className="mt-1">
                      <summary className="cursor-pointer font-bold">
                        処理診断を確認
                      </summary>
                      <dl className="mt-1 grid gap-1 pl-3">
                        {failure.failureReason ? (
                          <div>
                            <dt className="inline font-bold">理由: </dt>
                            <dd className="inline">{failure.failureReason}</dd>
                          </div>
                        ) : null}
                        {failure.failureCode ? (
                          <div>
                            <dt className="inline font-bold">コード: </dt>
                            <dd className="inline">{failure.failureCode}</dd>
                          </div>
                        ) : null}
                        <div>
                          <dt className="inline font-bold">呼び出し回数: </dt>
                          <dd className="inline">
                            抽出 {failure.extractionCalls} / 判定{" "}
                            {failure.assessmentCalls}
                          </dd>
                        </div>
                      </dl>
                    </details>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {executeState.result.reviewFailure ? (
            <div className="mt-3 border-t border-emerald-200 pt-3 text-xs text-emerald-950/80">
              <p className="font-bold">未完了の対話をまたいだ観測</p>
              <p className="mt-1">{executeState.result.reviewFailure.message}</p>
              <details className="mt-2">
                <summary className="cursor-pointer font-bold">
                  処理診断を確認
                </summary>
                <dl className="mt-1 grid gap-1 pl-3">
                  {executeState.result.reviewFailure.failureReason ? (
                    <div>
                      <dt className="inline font-bold">理由: </dt>
                      <dd className="inline">
                        {executeState.result.reviewFailure.failureReason}
                      </dd>
                    </div>
                  ) : null}
                  {executeState.result.reviewFailure.failureCode ? (
                    <div>
                      <dt className="inline font-bold">コード: </dt>
                      <dd className="inline">
                        {executeState.result.reviewFailure.failureCode}
                      </dd>
                    </div>
                  ) : null}
                  <div>
                    <dt className="inline font-bold">AI呼び出し回数: </dt>
                    <dd className="inline">
                      {executeState.result.reviewFailure.llmCalls}
                    </dd>
                  </div>
                  {executeState.result.reviewFailure.groundingDiagnostic ? (
                    <div>
                      <dt className="font-bold">根拠確認（件数のみ）:</dt>
                      <dd className="mt-1 pl-3">
                        参照試行 {executeState.result.reviewFailure.groundingDiagnostic.aliasAttemptCount}
                        件 / 一致 {executeState.result.reviewFailure.groundingDiagnostic.resolvedAliasCount}
                        件 / 利用可能 {executeState.result.reviewFailure.groundingDiagnostic.usableValidatedEvidenceCount}
                        件
                        <br />
                        文字数不一致 {executeState.result.reviewFailure.groundingDiagnostic.aliasDiagnostics.unexpectedLengthCount}
                        件 / 使用不可文字 {executeState.result.reviewFailure.groundingDiagnostic.aliasDiagnostics.nonBase62Count}
                        件 / 前後空白 {executeState.result.reviewFailure.groundingDiagnostic.aliasDiagnostics.leadingOrTrailingWhitespaceCount}
                        件 / 旧形式 {executeState.result.reviewFailure.groundingDiagnostic.aliasDiagnostics.legacyEvidenceRefShapeCount}
                        件 / wrapper形状 {executeState.result.reviewFailure.groundingDiagnostic.aliasDiagnostics.wrapperShapeCount}
                        件
                        <br />
                        長さ分布 {Object.entries(
                          executeState.result.reviewFailure.groundingDiagnostic.aliasDiagnostics.returnedAliasLengthHistogram,
                        )
                          .filter(([, count]) => count > 0)
                          .map(([bucket, count]) => `${bucket}文字:${count}件`)
                          .join(" / ") || "なし"}
                        {executeState.result.reviewFailure.groundingDiagnostic.aliasDiagnostics.uniformReturnedAliasLength !== null
                          ? ` / 全件同じ長さ: ${executeState.result.reviewFailure.groundingDiagnostic.aliasDiagnostics.uniformReturnedAliasLength}文字`
                          : ""}
                        <br />
                        SessionRef形状 {executeState.result.reviewFailure.groundingDiagnostic.aliasDiagnostics.sessionRefShapeCount}
                        件（既知token一致 {executeState.result.reviewFailure.groundingDiagnostic.aliasDiagnostics.knownSessionRefCount}
                        件） / MessageRef形状 {executeState.result.reviewFailure.groundingDiagnostic.aliasDiagnostics.messageRefShapeCount}
                        件（既知token一致 {executeState.result.reviewFailure.groundingDiagnostic.aliasDiagnostics.knownMessageRefCount}
                        件）
                      </dd>
                    </div>
                  ) : null}
                </dl>
              </details>
            </div>
          ) : null}
          <p className="mt-3 text-xs text-emerald-900/70">
            最新の状態を確認するには、もう一度「実行内容を確認する」を押してください。
          </p>
        </div>
      ) : null}
    </section>
  );
}
