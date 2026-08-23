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
  title: "観測を更新する",
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
        OBSERVATION UPDATE
      </p>
      <h1 className="mt-2 text-2xl font-black tracking-tight text-ink sm:text-3xl">
        観測を更新する
      </h1>
      <p className="mt-3 text-sm leading-7 text-muted">
        選んだ対話から、テーマの観測と対話をまたいだ観測を更新できます。実行内容は確認してから始められます。下の「統合レビューのみ実行」は、レビューだけを行う従来の操作です。期間や検索は候補を探すためで、対象はチェックで決めます。
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
