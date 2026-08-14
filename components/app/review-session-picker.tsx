"use client";

import { useActionState, useMemo, useState } from "react";
import { LoaderCircle, ScanSearch } from "lucide-react";
import {
  createIntegratedReviewAction,
  type CreateReviewState,
} from "@/app/(app)/reviews/actions";
import { INTEGRATED_REVIEW_MAX_INPUT_CHARS } from "@/lib/ai/limits";
import {
  canRunIntegratedReviewSelection,
  emptyPickerSelection,
  estimatedReviewChars,
  filterPickerCandidates,
  formatReviewInputEstimate,
  reviewSelectionHint,
  selectVisibleAnalyzable,
  selectedCandidatesOf,
  togglePickerSelection,
  type SessionPickerCandidate,
  type SessionPickerRanges,
} from "@/lib/reviews/session-picker";
import {
  SOURCE_LABELS,
  formatOccurredAt,
  type ReviewDatePreset,
} from "@/lib/sessions/labels";

export type ReviewPickerCandidate = SessionPickerCandidate;

const PRESET_OPTIONS: Array<{ id: ReviewDatePreset; label: string }> = [
  { id: "this-week", label: "今週" },
  { id: "last-week", label: "先週" },
  { id: "last-7-days", label: "過去7日" },
  { id: "last-30-days", label: "過去30日" },
  { id: "all", label: "すべて表示" },
];

const initialState: CreateReviewState = { error: null };

export function ReviewSessionPicker({
  candidates,
  ranges,
  initialPreset,
  categories,
  aiReady,
  aiMessage,
}: {
  candidates: ReviewPickerCandidate[];
  ranges: SessionPickerRanges;
  initialPreset: ReviewDatePreset;
  categories: string[];
  aiReady: boolean;
  aiMessage: string | null;
}) {
  const [preset, setPreset] = useState<ReviewDatePreset>(initialPreset);
  const [titleQuery, setTitleQuery] = useState("");
  const [category, setCategory] = useState("");
  const [selected, setSelected] = useState<Set<string>>(emptyPickerSelection);
  const [state, formAction, pending] = useActionState(
    createIntegratedReviewAction,
    initialState,
  );

  const visible = useMemo(
    () =>
      filterPickerCandidates(candidates, {
        preset,
        ranges,
        titleQuery,
        category,
      }),
    [candidates, category, preset, ranges, titleQuery],
  );

  const selectedCandidates = selectedCandidatesOf(candidates, selected);
  const selectedCount = selectedCandidates.length;
  const estimatedChars = estimatedReviewChars(selectedCandidates);
  const overLimit = estimatedChars > INTEGRATED_REVIEW_MAX_INPUT_CHARS;
  const selectionHint = reviewSelectionHint(selectedCount);
  const canSubmit =
    aiReady &&
    !pending &&
    canRunIntegratedReviewSelection(selectedCount, overLimit);

  return (
    <form action={formAction} className="mt-8 grid gap-5">
      <input type="hidden" name="preset" value={preset} />
      {[...selected].map((id) => (
        <input key={id} type="hidden" name="sessionIds" value={id} />
      ))}

      <div>
        <p className="text-[11px] font-bold text-muted">期間・検索・カテゴリで探す</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {PRESET_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setPreset(option.id)}
              className={`rounded-xl px-3 py-1.5 text-xs font-bold ${
                preset === option.id
                  ? "bg-blue-600 text-white"
                  : "border border-line bg-white text-muted hover:border-blue-200 hover:text-ink"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-xs font-bold text-muted">
          タイトル検索
          <input
            type="search"
            value={titleQuery}
            onChange={(event) => setTitleQuery(event.target.value)}
            placeholder="Session名"
            className="rounded-xl border border-line bg-white px-3 py-2 text-sm font-normal text-ink"
          />
        </label>
        <label className="grid gap-1 text-xs font-bold text-muted">
          カテゴリ
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            className="rounded-xl border border-line bg-white px-3 py-2 text-sm font-normal text-ink"
          >
            <option value="">すべて</option>
            {categories.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="rounded-2xl border border-line bg-white px-4 py-3 text-sm">
        <p className="font-bold text-ink">選択中：{selectedCount} Session</p>
        <p className="mt-1 text-muted">
          入力予定：{formatReviewInputEstimate(estimatedChars)}
        </p>
        {selectionHint ? (
          <p className="mt-2 text-xs font-bold text-amber-800">{selectionHint}</p>
        ) : null}
        {overLimit ? (
          <p className="mt-2 text-xs font-bold text-amber-800">
            選択したSessionの合計が、現在のMVPでレビューできる上限を超えています。Sessionを減らしてください。
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs font-bold text-muted">
          表示中 {visible.length}件
          <span className="mx-2 text-line">｜</span>
          選択中 {selectedCount}件
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setSelected(selectVisibleAnalyzable(visible))}
            className="rounded-xl border border-line bg-white px-3 py-1.5 text-xs font-bold text-ink hover:border-blue-200 hover:bg-brand-soft"
          >
            表示中を全選択
          </button>
          <button
            type="button"
            onClick={() => setSelected(emptyPickerSelection())}
            className="rounded-xl px-3 py-1.5 text-xs font-bold text-muted hover:text-ink"
          >
            選択をすべて解除
          </button>
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="rounded-2xl border border-line bg-white px-5 py-6 text-sm text-muted">
          条件に合う Session がありません。
        </p>
      ) : (
        <ul className="grid gap-2">
          {visible.map((candidate) => {
            const checked = selected.has(candidate.id);
            return (
              <li key={candidate.id}>
                <label
                  className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-4 ${
                    checked
                      ? "border-blue-300 bg-brand-soft ring-1 ring-blue-100"
                      : "border-line bg-white"
                  } ${candidate.analyzable ? "" : "cursor-not-allowed opacity-60"}`}
                >
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={checked}
                    disabled={!candidate.analyzable}
                    onChange={() =>
                      setSelected((current) =>
                        togglePickerSelection(
                          current,
                          candidate.id,
                          candidate.analyzable,
                        ),
                      )
                    }
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block font-bold text-ink">
                      {candidate.title}
                    </span>
                    <span className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                      <span>
                        日付{" "}
                        <span className="font-bold text-ink">
                          {formatOccurredAt(candidate.occurredAt)}
                        </span>
                      </span>
                      <span>
                        元{" "}
                        <span className="font-bold text-ink">
                          {SOURCE_LABELS[
                            candidate.source as keyof typeof SOURCE_LABELS
                          ] ?? candidate.source}
                        </span>
                      </span>
                      <span>
                        カテゴリ{" "}
                        <span className="font-bold text-ink">
                          {candidate.category || "未設定"}
                        </span>
                      </span>
                      <span>
                        Message{" "}
                        <span className="font-bold text-ink">
                          {candidate.messageCount}
                        </span>
                      </span>
                      <span>
                        文字数{" "}
                        <span className="font-bold text-ink">
                          約 {candidate.charCount.toLocaleString()}
                        </span>
                      </span>
                    </span>
                    {!candidate.analyzable ? (
                      <span className="mt-2 block text-xs font-bold text-amber-800">
                        MessageがないためReview対象外です
                      </span>
                    ) : null}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}

      <div className="sticky bottom-4 rounded-2xl border border-line bg-white p-4 shadow-[0_12px_40px_-30px_rgba(15,23,42,0.45)]">
        {!aiReady ? (
          <p className="text-sm font-bold text-amber-800">
            {aiMessage ?? "OpenAI APIキーが設定されていません"}
          </p>
        ) : (
          <button
            type="submit"
            disabled={!canSubmit}
            className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {pending ? (
              <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <ScanSearch className="size-4" aria-hidden="true" />
            )}
            {pending ? "統合レビュー中…" : "選択したSessionを統合レビュー"}
          </button>
        )}
        <p className="mt-2 text-xs text-muted">
          Session数：{selectedCount}件
          <span className="mx-2 text-line">/</span>
          入力：{formatReviewInputEstimate(estimatedChars)}
        </p>
        {state.error ? (
          <p className="mt-2 text-xs font-bold text-rose-700">{state.error}</p>
        ) : null}
      </div>
    </form>
  );
}
