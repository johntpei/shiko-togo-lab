"use client";

import { useState } from "react";

export function CopyMarkdownButton({ markdown }: { markdown: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={async () => {
          await navigator.clipboard.writeText(markdown);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 2000);
        }}
        className="inline-flex items-center rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-blue-600/20 hover:bg-blue-700"
      >
        Markdownをコピー
      </button>
      {copied ? (
        <span className="text-xs font-bold text-emerald-700">コピーしました</span>
      ) : null}
    </div>
  );
}
