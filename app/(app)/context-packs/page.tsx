import Link from "next/link";
import { Package } from "lucide-react";
import { ContextPackCard } from "@/components/app/context-pack-card";
import { listContextPacksWithSessionCount } from "@/lib/db/queries";

export const metadata = {
  title: "Context Pack",
};

export const dynamic = "force-dynamic";

export default function ContextPacksPage() {
  const packs = listContextPacksWithSessionCount();

  return (
    <div className="mx-auto max-w-3xl px-5 py-10 sm:px-8 sm:py-14">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-bold tracking-[0.18em] text-blue-600">
            CONTEXT PACKS
          </p>
          <h1 className="mt-2 text-2xl font-black tracking-tight text-ink sm:text-3xl">
            Context Pack
          </h1>
          <p className="mt-3 text-sm leading-7 text-muted">
            検証済みの知見から、次のAI対話へ持ち運べる短い前提を作ります。
          </p>
        </div>
        <Link
          href="/reviews"
          className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-blue-600/20 hover:bg-blue-700"
        >
          <Package className="size-4" aria-hidden="true" />
          Reviewから作る
        </Link>
      </div>

      {packs.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-line bg-white p-8 text-center shadow-[0_12px_40px_-30px_rgba(15,23,42,0.45)]">
          <p className="font-bold text-ink">まだ Context Pack がありません</p>
          <p className="mt-2 text-sm text-muted">
            統合レビューの詳細から作成できます。
          </p>
          <Link
            href="/reviews"
            className="mt-5 inline-flex items-center gap-2 text-sm font-bold text-blue-600 hover:underline"
          >
            Review一覧へ
          </Link>
        </div>
      ) : (
        <div className="mt-8 grid gap-3">
          {packs.map((pack) => (
            <ContextPackCard key={pack.id} pack={pack} />
          ))}
        </div>
      )}
    </div>
  );
}
