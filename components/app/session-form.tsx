"use client";

import { FileUp } from "lucide-react";
import { useActionState, useRef, useState } from "react";
import {
  createSession,
  type CreateSessionState,
} from "@/app/(app)/sessions/actions";
import {
  CATEGORY_SUGGESTIONS,
  SOURCE_LABELS,
  localTodayIsoDate,
} from "@/lib/sessions/labels";
import { SESSION_SOURCES } from "@/lib/sessions/constants";

const initialState: CreateSessionState = { error: null };

export function SessionForm() {
  const [state, formAction, pending] = useActionState(
    createSession,
    initialState,
  );
  const [fileNote, setFileNote] = useState<string | null>(null);
  const rawContentRef = useRef<HTMLTextAreaElement>(null);

  function loadFile(file: File) {
    const name = file.name.toLowerCase();
    if (!name.endsWith(".md") && !name.endsWith(".txt")) {
      setFileNote(".md または .txt ファイルを選んでください。");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === "string" ? reader.result : "";
      if (rawContentRef.current) {
        rawContentRef.current.value = text;
      }
      setFileNote(`${file.name} を本文へ読み込みました。`);
    };
    reader.onerror = () => {
      setFileNote("ファイルを読み込めませんでした。");
    };
    reader.readAsText(file);
  }

  return (
    <form action={formAction} className="space-y-6">
      <label className="block">
        <span className="text-sm font-bold text-ink">タイトル</span>
        <input
          name="title"
          required
          className="mt-2 w-full rounded-xl border border-line bg-white px-4 py-3 text-sm text-ink outline-none ring-blue-600/20 focus:border-blue-300 focus:ring-4"
          placeholder="例: 今週の仕事の進め方について"
        />
      </label>

      <div className="grid gap-6 sm:grid-cols-2">
        <label className="block">
          <span className="text-sm font-bold text-ink">対話日</span>
          <input
            type="date"
            name="occurredAt"
            required
            defaultValue={localTodayIsoDate()}
            className="mt-2 w-full rounded-xl border border-line bg-white px-4 py-3 text-sm text-ink outline-none ring-blue-600/20 focus:border-blue-300 focus:ring-4"
          />
        </label>

        <label className="block">
          <span className="text-sm font-bold text-ink">元サービス</span>
          <select
            name="source"
            defaultValue="chatgpt"
            className="mt-2 w-full rounded-xl border border-line bg-white px-4 py-3 text-sm text-ink outline-none ring-blue-600/20 focus:border-blue-300 focus:ring-4"
          >
            {SESSION_SOURCES.map((source) => (
              <option key={source} value={source}>
                {SOURCE_LABELS[source]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="block">
        <span className="text-sm font-bold text-ink">カテゴリ</span>
        <input
          name="category"
          list="category-suggestions"
          className="mt-2 w-full rounded-xl border border-line bg-white px-4 py-3 text-sm text-ink outline-none ring-blue-600/20 focus:border-blue-300 focus:ring-4"
          placeholder="自由入力（仕事、学習 など）"
        />
        <datalist id="category-suggestions">
          {CATEGORY_SUGGESTIONS.map((item) => (
            <option key={item} value={item} />
          ))}
        </datalist>
      </label>

      <div>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <label className="text-sm font-bold text-ink" htmlFor="rawContent">
            対話本文
          </label>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-line bg-white px-3 py-2 text-xs font-bold text-muted hover:border-blue-200 hover:text-blue-700">
            <FileUp className="size-4" aria-hidden="true" />
            .md / .txt を読み込む
            <input
              type="file"
              accept=".md,.txt,text/markdown,text/plain"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  loadFile(file);
                }
                event.target.value = "";
              }}
            />
          </label>
        </div>
        {fileNote ? (
          <p className="mt-2 text-xs text-muted">{fileNote}</p>
        ) : null}
        <textarea
          id="rawContent"
          name="rawContent"
          ref={rawContentRef}
          required
          rows={18}
          className="mt-2 w-full rounded-2xl border border-line bg-white px-4 py-4 text-sm leading-7 text-ink outline-none ring-blue-600/20 focus:border-blue-300 focus:ring-4"
          placeholder="ChatGPTとの一連の対話を、そのまま貼り付けてください。"
        />
        <p className="mt-2 text-xs leading-6 text-muted">
          原文はそのまま保存します。要約や自動修正は行いません。
        </p>
      </div>

      {state.error ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-900">
          {state.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-blue-600/20 hover:bg-blue-700 disabled:opacity-60"
      >
        {pending ? "保存しています…" : "Sessionを登録する"}
      </button>
    </form>
  );
}
