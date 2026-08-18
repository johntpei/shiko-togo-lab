"use client";

import { useRef } from "react";
import Link from "next/link";
import {
  ObservationContent,
  ObservationThoughtDate,
} from "@/components/app/observation-content";
import { formatThoughtDate } from "@/lib/observations/thought-date";
import type { ObservationCardModel } from "@/lib/observations/display";

export function ObservationCard({
  observation,
  featured = false,
}: {
  observation: ObservationCardModel;
  featured?: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const firstSeen = formatThoughtDate(observation.firstSeenAt);
  const lastSeen = formatThoughtDate(observation.lastSeenAt);

  return (
    <>
      <button
        type="button"
        onClick={() => dialogRef.current?.showModal()}
        className={`w-full rounded-2xl border bg-white p-5 text-left shadow-[0_12px_40px_-30px_rgba(15,23,42,0.45)] hover:border-blue-200 hover:bg-brand-soft ${
          featured ? "border-blue-100" : "border-line"
        }`}
      >
        {featured ? (
          <p className="text-[11px] font-bold tracking-[0.16em] text-blue-600">
            今、見ておきたいこと
          </p>
        ) : null}
        <p
          className={`${featured ? "mt-2 " : ""}text-[11px] font-bold tracking-[0.16em] ${featured ? "text-muted" : "text-blue-600"}`}
        >
          {observation.kindLabel}
        </p>
        {featured ? (
          <p className="mt-2 text-lg font-black tracking-tight text-ink">
            {observation.spotlightLabel}
          </p>
        ) : null}
        <div className={featured ? "mt-4" : "mt-3"}>
          <ObservationContent observation={observation} compact={!featured} />
        </div>
        <div className="mt-3">
          <ObservationThoughtDate observation={observation} />
        </div>
      </button>

      <dialog
        ref={dialogRef}
        className="w-[min(36rem,calc(100vw-2rem))] max-h-[85vh] overflow-auto rounded-2xl border border-line bg-white p-0 shadow-2xl backdrop:bg-slate-900/40"
        onClick={(event) => {
          if (event.target === dialogRef.current) {
            dialogRef.current.close();
          }
        }}
      >
        <div className="p-5 sm:p-6">
          <p className="text-[11px] font-bold tracking-[0.16em] text-blue-600">
            {observation.kindLabel}
          </p>
          <div className="mt-3">
            <ObservationContent observation={observation} />
          </div>
          {(firstSeen || lastSeen) && (
            <p className="mt-4 text-[11px] leading-6 text-muted">
              {firstSeen ? `最初に確認 ${firstSeen}` : null}
              {firstSeen && lastSeen ? " · " : null}
              {lastSeen ? `最近 ${lastSeen}` : null}
            </p>
          )}
          {observation.sessions.length > 0 ? (
            <section className="mt-5">
              <h3 className="text-[11px] font-bold text-muted">関連 Session</h3>
              <ul className="mt-2 grid gap-2">
                {observation.sessions.map((session) => (
                  <li key={session.id}>
                    <Link
                      href={`/sessions/${session.id}`}
                      className="text-sm font-bold text-blue-600 hover:underline"
                    >
                      {session.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <section className="mt-5">
            <h3 className="text-[11px] font-bold text-muted">元のレビュー</h3>
            <Link
              href={`/reviews/${observation.sourceReviewId}`}
              className="mt-2 inline-block text-sm font-bold text-blue-600 hover:underline"
            >
              {observation.sourceReviewTitle ?? "統合レビューを見る"}
            </Link>
          </section>
          <form method="dialog" className="mt-6">
            <button
              type="submit"
              className="rounded-xl border border-line px-4 py-2 text-sm font-bold text-muted hover:bg-canvas hover:text-ink"
            >
              閉じる
            </button>
          </form>
        </div>
      </dialog>
    </>
  );
}
