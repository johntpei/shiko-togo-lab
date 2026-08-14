import { ReviewSessionPicker } from "@/components/app/review-session-picker";
import { getPublicAiStatus } from "@/lib/ai/config";
import { listSessionReviewCandidates } from "@/lib/db/queries";
import {
  isReviewDatePreset,
  lastDaysRange,
  lastWeekRange,
  currentWeekRange,
  type ReviewDatePreset,
} from "@/lib/sessions/labels";

export const metadata = {
  title: "統合レビュー",
};

export const dynamic = "force-dynamic";

export default async function NewReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ preset?: string }>;
}) {
  const params = await searchParams;
  const initialPreset: ReviewDatePreset = isReviewDatePreset(params.preset ?? "")
    ? (params.preset as ReviewDatePreset)
    : "all";
  const candidates = listSessionReviewCandidates();
  const categories = [
    ...new Set(
      candidates
        .map((session) => session.category)
        .filter((value) => value.length > 0),
    ),
  ].sort();
  const aiStatus = getPublicAiStatus();
  const ranges = {
    "this-week": currentWeekRange(),
    "last-week": lastWeekRange(),
    "last-7-days": lastDaysRange(7),
    "last-30-days": lastDaysRange(30),
  };

  return (
    <div className="mx-auto max-w-3xl px-5 py-10 sm:px-8 sm:py-14">
      <p className="text-xs font-bold tracking-[0.18em] text-blue-600">
        NEW REVIEW
      </p>
      <h1 className="mt-2 text-2xl font-black tracking-tight text-ink sm:text-3xl">
        統合レビュー
      </h1>
      <p className="mt-3 text-sm leading-7 text-muted">
        複数の Session を選び、対話の間にあるつながりを見つけます。新規レビューは integrated-review-v4 です。過去の v1 / v2 / v3 レビューはそのまま残ります。期間や検索は候補を探すためで、Review対象はチェックで決めます。実行はボタンを押したときだけです。
      </p>
      <ReviewSessionPicker
        candidates={candidates}
        ranges={ranges}
        initialPreset={initialPreset}
        categories={categories}
        aiReady={aiStatus.ready}
        aiMessage={aiStatus.message}
      />
    </div>
  );
}
