import Link from "next/link";
import { Package } from "lucide-react";
import type { ContextPackListItem } from "@/lib/db/queries";

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

function questionPreview(question: string) {
  const trimmed = question.trim();
  if (!trimmed) {
    return "汎用Context Pack";
  }
  return trimmed.length > 48 ? `${trimmed.slice(0, 48)}…` : trimmed;
}

export function ContextPackCard({ pack }: { pack: ContextPackListItem }) {
  return (
    <Link
      href={`/context-packs/${pack.id}`}
      className="block rounded-2xl border border-line bg-white p-5 shadow-[0_12px_40px_-30px_rgba(15,23,42,0.45)] hover:border-blue-200 hover:bg-brand-soft"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-violet-600 ring-1 ring-violet-100">
          <Package className="size-4" aria-hidden="true" />
        </span>
        <span className="min-w-0">
          <span className="block font-bold text-ink">{pack.title}</span>
          <span className="mt-2 block text-sm leading-6 text-muted">
            {questionPreview(pack.currentQuestion)}
          </span>
          <span className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
            <span>
              作成{" "}
              <span className="font-bold text-ink">
                {formatCreatedAt(pack.createdAt)}
              </span>
            </span>
            <span>
              Session{" "}
              <span className="font-bold text-ink">{pack.sessionCount}</span>
            </span>
            {pack.sourceReviewTitle ? (
              <span>
                Review{" "}
                <span className="font-bold text-ink">
                  {pack.sourceReviewTitle}
                </span>
              </span>
            ) : null}
          </span>
        </span>
      </div>
    </Link>
  );
}
