import { ChatGptImportForm } from "@/components/app/chatgpt-import-form";
import { listChatGptExternalIds } from "@/lib/db/import-chatgpt";

export const metadata = {
  title: "ChatGPTデータを読み込む",
};

export const dynamic = "force-dynamic";

export default function ChatGptImportPage() {
  const importedIds = listChatGptExternalIds();

  return (
    <div className="mx-auto max-w-6xl px-5 py-10 sm:px-8 sm:py-14">
      <p className="text-xs font-bold tracking-[0.18em] text-blue-600">
        IMPORT
      </p>
      <h1 className="mt-2 text-2xl font-black tracking-tight text-ink sm:text-3xl">
        ChatGPTデータを読み込む
      </h1>
      <p className="mt-3 max-w-2xl text-sm leading-7 text-muted">
        公式エクスポートの conversations-*.json から、現在の会話経路を Session として取り込みます。ファイルはサーバーへ丸ごと送らず、選んだConversationだけ保存します。
      </p>
      <div className="mt-8">
        <ChatGptImportForm initialImportedIds={importedIds} />
      </div>
    </div>
  );
}
