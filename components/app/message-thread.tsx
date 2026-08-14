import type { MessageRecord } from "@/lib/db/schema";
import type { MessageRole } from "@/lib/ingest/parse-transcript";
import type { AttachmentMeta } from "@/lib/import/chatgpt/types";

function readAttachments(json: string | null): AttachmentMeta[] {
  if (!json) {
    return [];
  }
  try {
    const parsed = JSON.parse(json) as AttachmentMeta[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const roleStyles: Record<MessageRole, { label: string; className: string }> = {
  user: {
    label: "USER",
    className: "border-blue-100 bg-blue-50/70",
  },
  assistant: {
    label: "ASSISTANT",
    className: "border-line bg-white",
  },
  unknown: {
    label: "UNKNOWN",
    className: "border-amber-100 bg-amber-50/70",
  },
};

const roleLabelClass: Record<MessageRole, string> = {
  user: "text-blue-700",
  assistant: "text-slate-600",
  unknown: "text-amber-800",
};

export function MessageThread({ messages }: { messages: MessageRecord[] }) {
  if (messages.length === 0) {
    return (
      <p className="rounded-2xl border border-line bg-white px-5 py-4 text-sm text-muted">
        まだ発言へ分割されていません。「発言を再解析」を押すと、原文から生成します。
      </p>
    );
  }

  return (
    <div className="grid gap-3">
      {messages.map((message) => {
        const role = message.role as MessageRole;
        const style = roleStyles[role] ?? roleStyles.unknown;
        const attachments = readAttachments(message.attachmentsJson);
        return (
          <article
            key={message.id}
            id={`message-${message.id}`}
            className={`scroll-mt-6 rounded-2xl border p-4 shadow-[0_12px_40px_-30px_rgba(15,23,42,0.45)] sm:p-5 ${style.className}`}
          >
            <div className="mb-2 flex items-center justify-between gap-3">
              <p
                className={`text-[11px] font-bold tracking-[0.14em] ${roleLabelClass[role] ?? roleLabelClass.unknown}`}
              >
                {style.label}
              </p>
              <p className="text-[11px] text-muted">#{message.index + 1}</p>
            </div>
            <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-7 text-ink">
              {message.content}
            </pre>
            {attachments.length > 0 ? (
              <div className="mt-3 rounded-xl border border-line bg-white/80 px-3 py-2 text-xs text-muted">
                <p className="font-bold text-ink">添付</p>
                <ul className="mt-1 grid gap-1">
                  {attachments.map((item, index) => (
                    <li key={`${item.id ?? item.assetPointer ?? item.name ?? index}`}>
                      {item.name || "名称不明"}
                      {item.mimeType ? ` / ${item.mimeType}` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}
