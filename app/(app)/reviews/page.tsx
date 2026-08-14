import Link from "next/link";
import { ScanSearch } from "lucide-react";
import { ReviewCard } from "@/components/app/review-card";
import { listReviewsWithSessionCount } from "@/lib/db/queries";

export const metadata = {
  title: "レビュー",
};

export const dynamic = "force-dynamic";

export default function ReviewsPage() {
  const reviews = listReviewsWithSessionCount();

  return (
    <div className="mx-auto max-w-3xl px-5 py-10 sm:px-8 sm:py-14">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-bold tracking-[0.18em] text-blue-600">
            REVIEWS
          </p>
          <h1 className="mt-2 text-2xl font-black tracking-tight text-ink sm:text-3xl">
            レビュー
          </h1>
          <p className="mt-3 text-sm leading-7 text-muted">
            複数 Session を横断した統合レビューの履歴です。
          </p>
        </div>
        <Link
          href="/reviews/new"
          className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-blue-600/20 hover:bg-blue-700"
        >
          <ScanSearch className="size-4" aria-hidden="true" />
          統合レビューする
        </Link>
      </div>

      {reviews.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-line bg-white p-8 text-center shadow-[0_12px_40px_-30px_rgba(15,23,42,0.45)]">
          <p className="font-bold text-ink">まだ Review がありません</p>
          <p className="mt-2 text-sm text-muted">
            2件以上の Session を選ぶと、横断レビューを残せます。
          </p>
          <Link
            href="/reviews/new"
            className="mt-5 inline-flex items-center gap-2 text-sm font-bold text-blue-600 hover:underline"
          >
            統合レビューを始める
          </Link>
        </div>
      ) : (
        <div className="mt-8 grid gap-3">
          {reviews.map((review) => (
            <ReviewCard key={review.id} review={review} />
          ))}
        </div>
      )}
    </div>
  );
}
