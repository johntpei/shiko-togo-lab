"use client";

import { useActionState } from "react";
import { LoaderCircle, Package } from "lucide-react";
import {
  createContextPackAction,
  type CreateContextPackState,
} from "@/app/(app)/context-packs/actions";

const initialState: CreateContextPackState = { error: null };

export function ContextPackCreateForm({
  reviewId,
  reviewTitle,
  periodLabel,
  sessionCount,
  aiReady,
  aiMessage,
}: {
  reviewId: string;
  reviewTitle: string;
  periodLabel: string;
  sessionCount: number;
  aiReady: boolean;
  aiMessage: string | null;
}) {
  const [state, formAction, pending] = useActionState(
    createContextPackAction,
    initialState,
  );

  return (
    <form action={formAction} className="mt-8 grid gap-5">
      <input type="hidden" name="reviewId" value={reviewId} />
      <section className="rounded-2xl border border-line bg-white p-5 shadow-[0_12px_40px_-30px_rgba(15,23,42,0.45)]">
        <p className="text-[11px] font-bold tracking-[0.16em] text-muted">
          元になるReview
        </p>
        <p className="mt-2 font-bold text-ink">{reviewTitle}</p>
        <p className="mt-2 text-sm text-muted">
          {periodLabel}
          <span className="mx-2 text-line">·</span>
          {sessionCount} Sessions
        </p>
      </section>

      <label className="grid gap-2">
        <span className="text-sm font-bold text-ink">次に相談したいこと</span>
        <span className="text-xs leading-6 text-muted">
          空欄でも汎用Context Packを作れます。入力した場合は原文のまま使います。
        </span>
        <textarea
          name="currentQuestion"
          rows={5}
          placeholder="例：STEP 6以降で、このツール独自の価値をどう作るか相談したい"
          className="rounded-xl border border-line bg-white px-3 py-2.5 text-sm leading-7 text-ink outline-none focus:border-blue-300"
        />
      </label>

      {!aiReady ? (
        <p className="text-sm font-bold text-amber-800">
          {aiMessage ?? "OpenAI APIキーが設定されていません"}
          。過去のContext Packの閲覧はできます。
        </p>
      ) : null}

      {state.error ? (
        <p className="text-sm font-bold text-rose-700">{state.error}</p>
      ) : null}

      <button
        type="submit"
        disabled={!aiReady || pending}
        className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-blue-600/20 hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
      >
        {pending ? (
          <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <Package className="size-4" aria-hidden="true" />
        )}
        {pending ? "生成中…" : "Context Packを作る"}
      </button>
    </form>
  );
}
