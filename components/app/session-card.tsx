import Link from "next/link";
import type { SessionRecord } from "@/lib/db/schema";
import { SOURCE_LABELS, formatOccurredAt } from "@/lib/sessions/labels";

export function SessionCard({ session }: { session: SessionRecord }) {
  return (
    <Link
      href={`/sessions/${session.id}`}
      className="block rounded-2xl border border-line bg-white p-5 shadow-[0_12px_40px_-30px_rgba(15,23,42,0.45)] hover:border-blue-200 hover:bg-brand-soft"
    >
      <h2 className="text-base font-bold text-ink">{session.title}</h2>
      <dl className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <div>
          <dt className="inline">日付 </dt>
          <dd className="inline font-bold text-ink">
            {formatOccurredAt(session.occurredAt)}
          </dd>
        </div>
        <div>
          <dt className="inline">元 </dt>
          <dd className="inline font-bold text-ink">
            {SOURCE_LABELS[session.source as keyof typeof SOURCE_LABELS] ??
              session.source}
          </dd>
        </div>
        <div>
          <dt className="inline">カテゴリ </dt>
          <dd className="inline font-bold text-ink">
            {session.category || "未設定"}
          </dd>
        </div>
      </dl>
    </Link>
  );
}
