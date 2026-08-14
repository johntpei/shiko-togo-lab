"use client";

import { useActionState } from "react";
import { LoaderCircle, Sparkles } from "lucide-react";
import {
  analyzeSessionAction,
  type AnalyzeSessionState,
} from "@/app/(app)/sessions/actions";

const initialState: AnalyzeSessionState = { error: null };

export function AnalyzeSessionButton({
  sessionId,
  hasAnalysis,
  disabled,
}: {
  sessionId: string;
  hasAnalysis: boolean;
  disabled?: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    analyzeSessionAction,
    initialState,
  );

  return (
    <form action={formAction} className="flex flex-col items-end gap-2">
      <input type="hidden" name="sessionId" value={sessionId} />
      <button
        type="submit"
        disabled={disabled || pending}
        className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
      >
        {pending ? (
          <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <Sparkles className="size-3.5" aria-hidden="true" />
        )}
        {pending ? "分析中…" : hasAnalysis ? "再分析する" : "AIで分析する"}
      </button>
      {state.error ? (
        <p className="max-w-xs text-right text-xs font-bold text-rose-700">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
