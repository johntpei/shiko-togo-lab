import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { ContextPackDetailPanel } from "@/components/app/context-pack-detail-panel";
import { SessionCard } from "@/components/app/session-card";
import { parseStoredContextPackPayload } from "@/lib/context-pack/schema";
import {
  getContextPackById,
  getReviewById,
  listSessionsByContextPackId,
} from "@/lib/db/queries";

export const metadata = {
  title: "Context Pack詳細",
};

export const dynamic = "force-dynamic";

export default async function ContextPackDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const pack = getContextPackById(id);
  if (!pack) {
    notFound();
  }

  const payload = parseStoredContextPackPayload(pack.payload);
  const sessions = listSessionsByContextPackId(pack.id);
  const review = pack.sourceReviewId
    ? getReviewById(pack.sourceReviewId)
    : null;

  return (
    <div className="mx-auto max-w-3xl px-5 py-10 sm:px-8 sm:py-14">
      <Link
        href="/context-packs"
        className="inline-flex items-center gap-1.5 text-sm font-bold text-muted hover:text-blue-700"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        一覧へ戻る
      </Link>

      {payload ? (
        <div className="mt-6">
          <ContextPackDetailPanel
            title={pack.title}
            model={pack.model}
            promptVersion={pack.promptVersion}
            createdAt={pack.createdAt}
            currentQuestion={pack.currentQuestion}
            sourceReviewTitle={review?.title ?? null}
            sourceReviewId={pack.sourceReviewId}
            markdown={pack.markdown}
            payload={payload}
          />
        </div>
      ) : (
        <p className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900">
          保存されたContext Packを読み込めませんでした。
        </p>
      )}

      {sessions.length > 0 ? (
        <section className="mt-10">
          <h2 className="text-sm font-bold text-ink">出典 Session</h2>
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
