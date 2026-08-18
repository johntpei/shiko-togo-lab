import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Package } from "lucide-react";
import { ReviewDetailPanel } from "@/components/app/review-detail-panel";
import { SessionCard } from "@/components/app/session-card";
import { parseStoredReviewPayload } from "@/lib/ai/review-schemas";
import {
  getReviewById,
  listSessionsByReviewId,
} from "@/lib/db/queries";

export const metadata = {
  title: "統合レビュー詳細",
};

export const dynamic = "force-dynamic";

export default async function ReviewDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const review = getReviewById(id);
  if (!review) {
    notFound();
  }

  const sessions = listSessionsByReviewId(review.id);
  const payload = parseStoredReviewPayload(review.payload);

  return (
    <div className="mx-auto max-w-3xl px-5 py-10 sm:px-8 sm:py-14">
      <Link
        href="/reviews"
        className="inline-flex items-center gap-1.5 text-sm font-bold text-muted hover:text-blue-700"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        一覧へ戻る
      </Link>

      <div className="mt-4">
        <Link
          href={`/context-packs/new?reviewId=${review.id}`}
          className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-blue-600/20 hover:bg-blue-700"
        >
          <Package className="size-4" aria-hidden="true" />
          Context Packを作る
        </Link>
      </div>

      {payload ? (
        <div className="mt-6">
          <ReviewDetailPanel
            title={review.title}
            model={review.model}
            promptVersion={review.promptVersion}
            createdAt={review.createdAt}
            sessionCount={sessions.length}
            payload={payload}
            showFailureReasons={process.env.NODE_ENV !== "production"}
          />
        </div>
      ) : (
        <p className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900">
          保存されたレビューを読み込めませんでした。
        </p>
      )}

      {sessions.length > 0 ? (
        <section className="mt-10">
          <h2 className="text-sm font-bold text-ink">対象 Session</h2>
          <div className="mt-3 grid gap-3">
            {sessions.map((session) => (
              <SessionCard key={session.id} session={session} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
