"use client";

import { useState } from "react";
import Link from "next/link";
import { EvidenceLink } from "@/components/app/evidence-link";
import type { StoredContextPackItem } from "@/lib/context-pack/schema";

export function ContextPackSourceList({
  item,
  reviewId,
}: {
  item: StoredContextPackItem;
  reviewId?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const evidence = (item.evidence ?? []).filter(
    (entry) => entry.sessionId && entry.messageId,
  );

  if (!reviewId && evidence.length === 0) {
    return null;
  }

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="inline-flex rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-700 hover:bg-blue-100"
      >
        出典を見る
      </button>
      {open ? (
        <div className="mt-2 grid gap-2">
          {reviewId ? (
            <Link
              href={`/reviews/${reviewId}`}
              className="text-xs font-bold text-blue-700 hover:underline"
            >
              元Reviewを見る
            </Link>
          ) : null}
          {evidence.map((entry, index) => (
            <div
              key={`${entry.messageId}-${index}`}
              className="rounded-xl border border-line bg-canvas px-3 py-2"
            >
              {entry.sessionTitle ? (
                <p className="text-[11px] font-bold text-ink">
                  {entry.sessionTitle}
                </p>
              ) : null}
              {entry.sessionId && entry.messageId ? (
                <div className="mt-2">
                  <EvidenceLink
                    sessionId={entry.sessionId}
                    messageId={entry.messageId}
                    label="元発言を見る"
                  />
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
