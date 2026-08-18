import {
  CalendarRange,
  MessageSquarePlus,
  MessagesSquare,
  ScanSearch,
  Upload,
} from "lucide-react";
import Link from "next/link";
import { ContextPackCard } from "@/components/app/context-pack-card";
import { ObservationCard } from "@/components/app/observation-card";
import { ReviewCard } from "@/components/app/review-card";
import { SessionCard } from "@/components/app/session-card";
import type { ContextPackListItem, ReviewListItem } from "@/lib/db/queries";
import type { SessionRecord } from "@/lib/db/schema";
import { HOME_DATA_ACTIONS } from "@/lib/observations/home";
import type { ObservatoryHomeModel } from "@/lib/observations/home";
import type { ObservationCardModel } from "@/lib/observations/display";

const ACTION_ICONS = {
  "/sessions/new": MessageSquarePlus,
  "/imports/chatgpt": Upload,
  "/reviews/new?preset=this-week": CalendarRange,
} as const;

function EmptyNote({ children }: { children: string }) {
  return (
    <p className="rounded-2xl border border-dashed border-line bg-white px-5 py-4 text-sm leading-7 text-muted">
      {children}
    </p>
  );
}

function ObservationSection({
  title,
  items,
  empty,
}: {
  title: string;
  items: ObservationCardModel[];
  empty: string;
}) {
  return (
    <section className="mt-10">
      <h2 className="text-lg font-black text-ink">{title}</h2>
      <div className="mt-4 grid gap-3">
        {items.length > 0 ? (
          items.map((observation) => (
            <ObservationCard key={observation.id} observation={observation} />
          ))
        ) : (
          <EmptyNote>{empty}</EmptyNote>
        )}
      </div>
    </section>
  );
}

export function ObservatoryHome({
  model,
  week,
  weekCount,
  reviewCount,
  recentReviews,
  recentPacks,
  recentSessions,
}: {
  model: ObservatoryHomeModel;
  week: { start: string; end: string };
  weekCount: number;
  reviewCount: number;
  recentReviews: ReviewListItem[];
  recentPacks: ContextPackListItem[];
  recentSessions: SessionRecord[];
}) {
  return (
    <div className="mx-auto max-w-6xl px-5 py-10 sm:px-8 sm:py-14">
      <p className="text-xs font-bold tracking-[0.18em] text-blue-600">
        観測
      </p>
      <h1 className="mt-2 text-3xl font-black tracking-tight text-ink sm:text-4xl">
        今、思考に何が起きているか
      </h1>
      <p className="mt-3 max-w-2xl text-sm leading-7 text-muted sm:text-base">
        複数の対話から、根拠のある変化・接続・緊張関係だけを観測します。
      </p>

      {model.totalCount === 0 ? (
        <div className="mt-8 rounded-2xl border border-line bg-white p-5 shadow-[0_12px_40px_-30px_rgba(15,23,42,0.45)] sm:p-6">
          <p className="font-bold text-ink">まだ観測できるデータがありません</p>
          <p className="mt-2 text-sm leading-7 text-muted">
            ChatGPTの対話を取り込み、統合レビューすると、変化やつながりの観測がここに現れます。
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link
              href="/imports/chatgpt"
              className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-700"
            >
              ChatGPTデータを読み込む
            </Link>
            <Link
              href="/reviews/new"
              className="rounded-xl border border-line px-4 py-2.5 text-sm font-bold text-ink hover:bg-canvas"
            >
              レビューする
            </Link>
          </div>
        </div>
      ) : (
        <>
          {model.spotlight ? (
            <section className="mt-8">
              <ObservationCard observation={model.spotlight} featured />
            </section>
          ) : null}
          <ObservationSection
            title="最近の変化"
            items={model.shifts}
            empty="まだ十分な根拠のある変化は見つかっていません"
          />
          <ObservationSection
            title="最近生まれた接続"
            items={model.connections}
            empty="まだ十分な根拠のある接続は見つかっていません"
          />
          <ObservationSection
            title="まだ揺れていること"
            items={model.tensions}
            empty="まだ十分な根拠のある緊張関係は見つかっていません"
          />
        </>
      )}

      <section className="mt-16 border-t border-line pt-10">
        <h2 className="text-lg font-black text-ink">データを追加・分析する</h2>
        <p className="mt-2 text-sm leading-7 text-muted">
          観測の原料になる対話とレビューを、ここから追加できます。
        </p>
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <div className="grid gap-3">
            {HOME_DATA_ACTIONS.slice(0, 2).map((action) => {
              const Icon = ACTION_ICONS[action.href];
              return (
                <Link
                  key={action.href}
                  href={action.href}
                  className="flex items-start gap-4 rounded-2xl border border-line bg-white p-5 shadow-[0_12px_40px_-30px_rgba(15,23,42,0.45)] hover:border-blue-200 hover:bg-brand-soft"
                >
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600 ring-1 ring-blue-100">
                    <Icon className="size-5" aria-hidden="true" />
                  </span>
                  <span>
                    <span className="block font-bold text-ink">{action.title}</span>
                    <span className="mt-1 block text-sm leading-6 text-muted">
                      {action.body}
                    </span>
                  </span>
                </Link>
              );
            })}
          </div>
          {HOME_DATA_ACTIONS.slice(2).map((action) => {
            const Icon = ACTION_ICONS[action.href];
            return (
              <Link
                key={action.href}
                href={action.href}
                className="flex items-start gap-4 rounded-2xl border border-line bg-white p-5 shadow-[0_12px_40px_-30px_rgba(15,23,42,0.45)] hover:border-blue-200 hover:bg-brand-soft"
              >
                <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 ring-1 ring-emerald-100">
                  <Icon className="size-5" aria-hidden="true" />
                </span>
                <span>
                  <span className="block font-bold text-ink">{action.title}</span>
                  <span className="mt-1 block text-sm leading-6 text-muted">
                    {action.body}
                  </span>
                </span>
              </Link>
            );
          })}
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
              <h3 className="text-base font-black text-ink">最近の Review</h3>
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
              <h3 className="text-base font-black text-ink">最近の Context Pack</h3>
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
              <h3 className="text-base font-black text-ink">最近の Session</h3>
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
      </section>
    </div>
  );
}
