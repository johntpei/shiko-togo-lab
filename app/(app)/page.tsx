import {
  CalendarRange,
  MessageSquarePlus,
  MessagesSquare,
  ScanSearch,
  Upload,
} from "lucide-react";
import Link from "next/link";
import { ContextPackCard } from "@/components/app/context-pack-card";
import { ReviewCard } from "@/components/app/review-card";
import { SessionCard } from "@/components/app/session-card";
import {
  countReviews,
  listContextPacksWithSessionCount,
  countSessionsInDateRange,
  listRecentSessions,
  listReviewsWithSessionCount,
} from "@/lib/db/queries";
import { APP_NAME } from "@/lib/app/identity";
import { currentWeekRange } from "@/lib/sessions/labels";

export const dynamic = "force-dynamic";

export default function DashboardPage() {
  const week = currentWeekRange();
  const weekCount = countSessionsInDateRange(week.start, week.end);
  const recentSessions = listRecentSessions(5);
  const reviewCount = countReviews();
  const recentReviews = listReviewsWithSessionCount().slice(0, 3);
  const recentPacks = listContextPacksWithSessionCount().slice(0, 3);

  return (
    <div className="mx-auto max-w-6xl px-5 py-10 sm:px-8 sm:py-14">
      <p className="text-xs font-bold tracking-[0.18em] text-blue-600">
        DASHBOARD
      </p>
      <h1 className="mt-2 text-3xl font-black tracking-tight text-ink sm:text-4xl">
        {APP_NAME}
      </h1>
      <p className="mt-3 max-w-2xl text-sm leading-7 text-muted sm:text-base">
        ChatGPTとの対話を登録し、まとめて振り返り、次の対話へ持ち帰れるようにします。
      </p>

      <div className="mt-8 grid gap-3 sm:grid-cols-2">
        <div className="grid gap-3">
          <Link
            href="/sessions/new"
            className="flex items-start gap-4 rounded-2xl border border-blue-100 bg-white p-5 shadow-[0_12px_40px_-30px_rgba(15,23,42,0.45)] hover:border-blue-200 hover:bg-brand-soft"
          >
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600 ring-1 ring-blue-100">
              <MessageSquarePlus className="size-5" aria-hidden="true" />
            </span>
            <span>
              <span className="block font-bold text-ink">手動で貼り付ける</span>
              <span className="mt-1 block text-sm leading-6 text-muted">
                対話のテキストや .md / .txt を登録する
              </span>
            </span>
          </Link>
          <Link
            href="/imports/chatgpt"
            className="flex items-start gap-4 rounded-2xl border border-line bg-white p-5 shadow-[0_12px_40px_-30px_rgba(15,23,42,0.45)] hover:border-blue-200 hover:bg-brand-soft"
          >
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600 ring-1 ring-blue-100">
              <Upload className="size-5" aria-hidden="true" />
            </span>
            <span>
              <span className="block font-bold text-ink">
                ChatGPTデータを読み込む
              </span>
              <span className="mt-1 block text-sm leading-6 text-muted">
                公式エクスポートの JSON から取り込む
              </span>
            </span>
          </Link>
        </div>
        <Link
          href="/reviews/new?preset=this-week"
          className="flex items-start gap-4 rounded-2xl border border-line bg-white p-5 shadow-[0_12px_40px_-30px_rgba(15,23,42,0.45)] hover:border-blue-200 hover:bg-brand-soft"
        >
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 ring-1 ring-emerald-100">
            <CalendarRange className="size-5" aria-hidden="true" />
          </span>
          <span>
            <span className="block font-bold text-ink">今週をレビューする</span>
            <span className="mt-1 block text-sm leading-6 text-muted">
              複数の Session を選んで統合レビューする
            </span>
          </span>
        </Link>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <article className="rounded-2xl border border-line bg-white p-5 shadow-[0_12px_40px_-30px_rgba(15,23,42,0.45)]">
          <div className="flex items-center gap-2 text-xs font-bold tracking-[0.12em] text-muted">
            <MessagesSquare className="size-4" aria-hidden="true" />
            今週の Session
          </div>
          <p className="mt-3 text-2xl font-black text-ink">{weekCount}</p>
          <p className="mt-1 text-xs text-muted">
            対話日が今週（{week.start.replaceAll("-", "/")} 〜{" "}
            {week.end.replaceAll("-", "/")}）の件数
          </p>
        </article>
        <article className="rounded-2xl border border-line bg-white p-5 shadow-[0_12px_40px_-30px_rgba(15,23,42,0.45)]">
          <div className="flex items-center gap-2 text-xs font-bold tracking-[0.12em] text-muted">
            <ScanSearch className="size-4" aria-hidden="true" />
            最近の Review
          </div>
          <p className="mt-3 text-2xl font-black text-ink">{reviewCount}</p>
          <p className="mt-1 text-xs text-muted">
            {reviewCount === 0
              ? "統合レビューすると履歴が出ます"
              : "保存された統合レビューの件数"}
          </p>
        </article>
      </div>

      {recentReviews.length > 0 ? (
        <section className="mt-10">
          <div className="mb-4 flex items-end justify-between gap-3">
            <h2 className="text-lg font-black text-ink">最近の Review</h2>
            <Link
              href="/reviews"
              className="text-sm font-bold text-blue-600 hover:underline"
            >
              すべて見る
            </Link>
          </div>
          <div className="grid gap-3">
            {recentReviews.map((review) => (
              <div key={review.id} className="grid gap-2">
                <ReviewCard review={review} />
                <Link
                  href={`/context-packs/new?reviewId=${review.id}`}
                  className="text-sm font-bold text-blue-600 hover:underline"
                >
                  Context Packを作る
                </Link>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {recentPacks.length > 0 ? (
        <section className="mt-10">
          <div className="mb-4 flex items-end justify-between gap-3">
            <h2 className="text-lg font-black text-ink">最近の Context Pack</h2>
            <Link
              href="/context-packs"
              className="text-sm font-bold text-blue-600 hover:underline"
            >
              すべて見る
            </Link>
          </div>
          <div className="grid gap-3">
            {recentPacks.map((pack) => (
              <ContextPackCard key={pack.id} pack={pack} />
            ))}
          </div>
        </section>
      ) : null}

      {recentSessions.length > 0 ? (
        <section className="mt-10">
          <div className="mb-4 flex items-end justify-between gap-3">
            <h2 className="text-lg font-black text-ink">最近の Session</h2>
            <Link
              href="/sessions"
              className="text-sm font-bold text-blue-600 hover:underline"
            >
              すべて見る
            </Link>
          </div>
          <div className="grid gap-3">
            {recentSessions.map((session) => (
              <SessionCard key={session.id} session={session} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
