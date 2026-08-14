import Link from "next/link";
import { ScanSearch } from "lucide-react";
import type { ReviewListItem } from "@/lib/db/queries";

function formatCreatedAt(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function ReviewCard({ review }: { review: ReviewListItem }) {
  return (
    <Link
      href={`/reviews/${review.id}`}
      className="block rounded-2xl border border-line bg-white p-5 shadow-[0_12px_40px_-30px_rgba(15,23,42,0.45)] hover:border-blue-200 hover:bg-brand-soft"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 ring-1 ring-emerald-100">
          <ScanSearch className="size-4" aria-hidden="true" />
        </span>
        <span className="min-w-0">
          <span className="block font-bold text-ink">{review.title}</span>
          <span className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
            <span>
              作成{" "}
              <span className="font-bold text-ink">
                {formatCreatedAt(review.createdAt)}
              </span>
            </span>
            <span>
              Session{" "}
              <span className="font-bold text-ink">{review.sessionCount}</span>
            </span>
            <span>
              モデル{" "}
              <span className="font-bold text-ink">{review.model}</span>
            </span>
            <span>
              <span className="font-bold text-ink">{review.promptVersion}</span>
            </span>
          </span>
        </span>
      </div>
    </Link>
  );
}
