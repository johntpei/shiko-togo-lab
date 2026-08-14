import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ArrowLeft } from "lucide-react";
import { AnalyzeSessionButton } from "@/components/app/analyze-session-button";
import { HashScroll } from "@/components/app/hash-scroll";
import { MessageThread } from "@/components/app/message-thread";
import { ReparseButton } from "@/components/app/reparse-button";
import { SessionAnalysisPanel } from "@/components/app/session-analysis-panel";
import { getPublicAiStatus } from "@/lib/ai/config";
import {
  ANALYZE_SESSION_MAX_INPUT_CHARS,
  isAnalyzeInputTooLong,
} from "@/lib/ai/limits";
import { parseStoredAnalysisPayload } from "@/lib/ai/schemas";
import { buildEvidenceAnalyzeInput } from "@/lib/ai/session-input";
import {
  getLatestSessionAnalysis,
  getSessionById,
  listMessagesBySessionId,
} from "@/lib/db/queries";
import { SOURCE_LABELS, formatOccurredAt } from "@/lib/sessions/labels";
import type { SessionSource } from "@/lib/sessions/constants";

export const metadata = {
  title: "Session詳細",
};

export const dynamic = "force-dynamic";

export default async function SessionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await connection();
  const { id } = await params;
  const session = getSessionById(id);

  if (!session) {
    notFound();
  }

  const sessionMessages = listMessagesBySessionId(session.id);
  const sourceLabel =
    SOURCE_LABELS[session.source as SessionSource] ?? session.source;
  const aiStatus = getPublicAiStatus();
  const analyzeInput = buildEvidenceAnalyzeInput(sessionMessages);
  const tooLong = isAnalyzeInputTooLong(analyzeInput.labeledTranscript);
  const latestAnalysis = getLatestSessionAnalysis(session.id);
  const analysisPayload = latestAnalysis
    ? parseStoredAnalysisPayload(latestAnalysis.payload)
    : null;

  return (
    <div className="mx-auto max-w-3xl px-5 py-10 sm:px-8 sm:py-14">
      <HashScroll />
      <Link
        href="/sessions"
        className="inline-flex items-center gap-1.5 text-sm font-bold text-muted hover:text-blue-700"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        一覧へ戻る
      </Link>

      <p className="mt-6 text-xs font-bold tracking-[0.18em] text-blue-600">
        SESSION
      </p>
      <h1 className="mt-2 text-2xl font-black tracking-tight text-ink sm:text-3xl">
        {session.title}
      </h1>

      <dl className="mt-5 grid gap-3 rounded-2xl border border-line bg-white p-5 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs font-bold tracking-[0.12em] text-muted">
            対話日
          </dt>
          <dd className="mt-1 font-bold text-ink">
            {formatOccurredAt(session.occurredAt)}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-bold tracking-[0.12em] text-muted">
            元サービス
          </dt>
          <dd className="mt-1 font-bold text-ink">{sourceLabel}</dd>
        </div>
        <div>
          <dt className="text-xs font-bold tracking-[0.12em] text-muted">
            カテゴリ
          </dt>
          <dd className="mt-1 font-bold text-ink">
            {session.category || "未設定"}
          </dd>
        </div>
      </dl>

      <section className="mt-8">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-ink">AI分析</h2>
            <p className="mt-1 text-xs text-muted">
              この Session の発言だけを根拠に整理します。分析は履歴として残ります。
            </p>
          </div>
          {aiStatus.ready && !tooLong && analyzeInput.analyzableCount > 0 ? (
            <AnalyzeSessionButton
              sessionId={session.id}
              hasAnalysis={Boolean(latestAnalysis)}
            />
          ) : null}
        </div>

        <div className="grid gap-3">
          {!aiStatus.hasApiKey ? (
            <p className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm font-bold text-amber-900">
              OpenAI APIキーが設定されていません
            </p>
          ) : aiStatus.message ? (
            <p className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm font-bold text-amber-900">
              {aiStatus.message}
            </p>
          ) : tooLong ? (
            <p className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm font-bold text-amber-900">
              このSessionは現在のMVPで分析できる上限を超えています
              <span className="mt-1 block font-normal text-amber-800">
                上限は {ANALYZE_SESSION_MAX_INPUT_CHARS.toLocaleString()}{" "}
                字です（現在{" "}
                {analyzeInput.labeledTranscript.length.toLocaleString()} 字）。
              </span>
            </p>
          ) : analyzeInput.analyzableCount === 0 ? (
            <p className="rounded-2xl border border-line bg-white px-5 py-4 text-sm text-muted">
              分析できる User / Assistant の発言がありません。
            </p>
          ) : null}

          {latestAnalysis && analysisPayload ? (
            <SessionAnalysisPanel
              sessionId={session.id}
              model={latestAnalysis.model}
              promptVersion={latestAnalysis.promptVersion}
              createdAt={latestAnalysis.createdAt}
              payload={analysisPayload}
              showFailureReasons={process.env.NODE_ENV !== "production"}
            />
          ) : latestAnalysis && !analysisPayload ? (
            <p className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900">
              保存された分析を読み込めませんでした。再分析できます。
            </p>
          ) : aiStatus.ready &&
            !tooLong &&
            analyzeInput.analyzableCount > 0 ? (
            <p className="rounded-2xl border border-line bg-white px-5 py-4 text-sm text-muted">
              まだ分析していません。「AIで分析する」を押すと、この Session
              の発言だけを送ります。
            </p>
          ) : null}
        </div>
      </section>

      <section className="mt-8">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-ink">発言</h2>
            <p className="mt-1 text-xs text-muted">
              原文から分割した発言単位です。内容の要約や修正はしていません。
            </p>
          </div>
          {session.importSource === "chatgpt_export" ? (
            <p className="rounded-xl border border-line bg-white px-3 py-2 text-xs text-muted">
              ChatGPT Exportから取り込みました。原文は現在branchのスナップショットです。
            </p>
          ) : (
            <ReparseButton sessionId={session.id} />
          )}
        </div>
        <MessageThread messages={sessionMessages} />
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-bold text-ink">原文</h2>
        <p className="mt-1 text-xs text-muted">
          登録時の対話本文です。内容は変更していません。
        </p>
        <details className="mt-3 rounded-2xl border border-line bg-white shadow-[0_12px_40px_-30px_rgba(15,23,42,0.45)]">
          <summary className="cursor-pointer px-5 py-4 text-sm font-bold text-ink">
            原文全文を表示
          </summary>
          <div className="border-t border-line px-5 py-5 sm:px-6">
            <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-7 text-ink">
              {session.rawContent}
            </pre>
          </div>
        </details>
      </section>
    </div>
  );
}
