import Link from "next/link";
import { SessionForm } from "@/components/app/session-form";

export const metadata = {
  title: "Sessionを追加",
};

export default function NewSessionPage() {
  return (
    <div className="mx-auto max-w-3xl px-5 py-10 sm:px-8 sm:py-14">
      <p className="text-xs font-bold tracking-[0.18em] text-blue-600">
        NEW SESSION
      </p>
      <h1 className="mt-2 text-2xl font-black tracking-tight text-ink sm:text-3xl">
        Sessionを追加
      </h1>
      <p className="mt-3 max-w-2xl text-sm leading-7 text-muted sm:text-base">
        ChatGPTなどとの一連の対話を、原文のまま登録します。公式エクスポートからまとめて取り込む場合は
        <Link href="/imports/chatgpt" className="font-bold text-blue-700 hover:underline">
          ChatGPTデータを読み込む
        </Link>
        を使ってください。
      </p>
      <div className="mt-8 rounded-[2rem] border border-line bg-white p-5 shadow-[0_12px_40px_-30px_rgba(15,23,42,0.45)] sm:p-8">
        <SessionForm />
      </div>
    </div>
  );
}
