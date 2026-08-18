import Link from "next/link";
import { ContextPackCreateForm } from "@/components/app/context-pack-create-form";
import { getPublicAiStatus } from "@/lib/ai/config";
import { parseStoredReviewPayload } from "@/lib/ai/review-schemas";
import {
  getReviewById,
  listReviewsWithSessionCount,
  listSessionsByReviewId,
} from "@/lib/db/queries";
import { formatOccurredAt } from "@/lib/sessions/labels";

export const metadata = {
  title: "Context Packを作る",
};

export const dynamic = "force-dynamic";

function periodLabel(occurredAts: string[]) {
  const dates = [...occurredAts].filter(Boolean).sort();
  const min = dates[0];
  const max = dates[dates.length - 1];
  if (min && max && min !== max) {
    return `${formatOccurredAt(min)}〜${formatOccurredAt(max)}`;
  }
  if (min) {
    return formatOccurredAt(min);
  }
  return "期間不明";
}

export default async function NewContextPackPage({
  searchParams,
}: {
  searchParams: Promise<{ reviewId?: string }>;
}) {
  const params = await searchParams;
  const reviewId = params.reviewId?.trim() ?? "";
  const aiStatus = getPublicAiStatus();

  if (!reviewId) {
    const reviews = listReviewsWithSessionCount();
    return (
      <div className="mx-auto max-w-3xl px-5 py-10 sm:px-8 sm:py-14">
        <p className="text-xs font-bold tracking-[0.18em] text-blue-600">
          NEW CONTEXT PACK
        </p>
        <h1 className="mt-2 text-2xl font-black tracking-tight text-ink sm:text-3xl">
          Context Packを作る
        </h1>
        <p className="mt-3 text-sm leading-7 text-muted">
          まず元になる統合レビューを選んでください。
        </p>
        {reviews.length === 0 ? (
          <p className="mt-8 text-sm text-muted">
            まだReviewがありません。
            <Link href="/reviews/new" className="ml-1 font-bold text-blue-600 hover:underline">
              統合レビューする
            </Link>
          </p>
        ) : (
          <div className="mt-8 grid gap-3">
            {reviews.map((review) => (
              <Link
                key={review.id}
                href={`/context-packs/new?reviewId=${review.id}`}
                className="block rounded-2xl border border-line bg-white p-5 shadow-[0_12px_40px_-30px_rgba(15,23,42,0.45)] hover:border-blue-200 hover:bg-brand-soft"
              >
                <span className="block font-bold text-ink">{review.title}</span>
                <span className="mt-2 block text-xs text-muted">
                  Session {review.sessionCount}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    );
  }

  const review = getReviewById(reviewId);
  const payload = review ? parseStoredReviewPayload(review.payload) : null;
  const sessions = review ? listSessionsByReviewId(review.id) : [];

  if (!review || !payload) {
    return (
      <div className="mx-auto max-w-3xl px-5 py-10 sm:px-8 sm:py-14">
        <h1 className="text-2xl font-black text-ink">Context Packを作る</h1>
        <p className="mt-4 text-sm font-bold text-rose-700">
          Reviewが見つからないか、読み込めませんでした。
        </p>
        <Link href="/reviews" className="mt-4 inline-block text-sm font-bold text-blue-600">
          Review一覧へ
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-5 py-10 sm:px-8 sm:py-14">
      <p className="text-xs font-bold tracking-[0.18em] text-blue-600">
        NEW CONTEXT PACK
      </p>
      <h1 className="mt-2 text-2xl font-black tracking-tight text-ink sm:text-3xl">
        Context Packを作る
      </h1>
      <p className="mt-3 text-sm leading-7 text-muted">
        検証済みのReview情報から、次の相談に必要な前提だけを選びます。新しい分析はしません。
      </p>
      <ContextPackCreateForm
        reviewId={review.id}
        reviewTitle={review.title}
        periodLabel={periodLabel(sessions.map((session) => session.occurredAt))}
        sessionCount={sessions.length}
        aiReady={aiStatus.ready}
        aiMessage={aiStatus.message}
      />
    </div>
  );
}
