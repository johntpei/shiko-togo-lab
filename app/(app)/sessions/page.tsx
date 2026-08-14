import Link from "next/link";
import { MessageSquarePlus } from "lucide-react";
import { SessionCard } from "@/components/app/session-card";
import { listSessions } from "@/lib/db/queries";

export const metadata = {
  title: "Session",
};

export const dynamic = "force-dynamic";

export default function SessionsPage() {
  const sessions = listSessions();

  return (
    <div className="mx-auto max-w-3xl px-5 py-10 sm:px-8 sm:py-14">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-bold tracking-[0.18em] text-blue-600">
            SESSIONS
          </p>
          <h1 className="mt-2 text-2xl font-black tracking-tight text-ink sm:text-3xl">
            Session
          </h1>
          <p className="mt-3 text-sm leading-7 text-muted">
            登録した対話の一覧です。カードを開くと原文を確認できます。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/sessions/new"
            className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-blue-600/20 hover:bg-blue-700"
          >
            <MessageSquarePlus className="size-4" aria-hidden="true" />
            追加する
          </Link>
          <Link
            href="/imports/chatgpt"
            className="inline-flex items-center gap-2 rounded-xl border border-line bg-white px-4 py-2.5 text-sm font-bold text-ink hover:border-blue-200"
          >
            ChatGPT読込
          </Link>
        </div>
      </div>

      {sessions.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-line bg-white p-8 text-center shadow-[0_12px_40px_-30px_rgba(15,23,42,0.45)]">
          <p className="font-bold text-ink">まだ Session がありません</p>
          <p className="mt-2 text-sm text-muted">
            対話を1件登録すると、ここに表示されます。
          </p>
          <Link
            href="/sessions/new"
            className="mt-5 inline-flex items-center gap-2 text-sm font-bold text-blue-600 hover:underline"
          >
            Sessionを追加する
          </Link>
        </div>
      ) : (
        <div className="mt-8 grid gap-3">
          {sessions.map((session) => (
            <SessionCard key={session.id} session={session} />
          ))}
        </div>
      )}
    </div>
  );
}
