"use client";

import { usePathname } from "next/navigation";

export function EvidenceLink({
  sessionId,
  messageId,
  label = "根拠を見る",
}: {
  sessionId: string;
  messageId: string;
  label?: string;
}) {
  const pathname = usePathname();
  const href = `/sessions/${sessionId}#message-${messageId}`;
  const samePage = pathname === `/sessions/${sessionId}`;

  return (
    <a
      href={href}
      className="inline-flex rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-700 hover:bg-blue-100"
      onClick={(event) => {
        if (!samePage) {
          return;
        }
        event.preventDefault();
        window.history.replaceState(null, "", href);
        document
          .getElementById(`message-${messageId}`)
          ?.scrollIntoView({ block: "start" });
      }}
    >
      {label}
    </a>
  );
}
