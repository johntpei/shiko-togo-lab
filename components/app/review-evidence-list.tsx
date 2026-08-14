"use client";

import { useState } from "react";
import { EvidenceLink } from "@/components/app/evidence-link";
import {
  EVIDENCE_FAILURE_LABELS,
  type EvidenceFailureReason,
} from "@/lib/ai/evidence";
import type { StoredReviewEvidence } from "@/lib/ai/review-schemas";
import { formatOccurredAt } from "@/lib/sessions/labels";

function failureLabel(reason: string | null | undefined) {
  if (!reason || !(reason in EVIDENCE_FAILURE_LABELS)) {
    return "参照Messageが見つかりません";
  }
  return EVIDENCE_FAILURE_LABELS[reason as EvidenceFailureReason];
}

function roleLabel(role: StoredReviewEvidence["role"]) {
  if (role === "user") {
    return "本人の発言";
  }
  if (role === "assistant") {
    return "AIの発言";
  }
  return "発言";
}

export function ReviewEvidenceList({
  evidence,
  showFailureReasons = false,
}: {
  evidence: StoredReviewEvidence[];
  showFailureReasons?: boolean;
}) {
  const [open, setOpen] = useState(false);

  if (evidence.length === 0) {
    return null;
  }

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="inline-flex rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-700 hover:bg-blue-100"
      >
        根拠 {evidence.length}件
      </button>
      {open ? (
        <ul className="mt-2 grid gap-2">
          {evidence.map((item, index) => (
            <li
              key={`${item.messageRef}-${index}`}
              className="rounded-xl border border-line bg-canvas px-3 py-2"
            >
              {item.sessionTitle ? (
                <p className="text-[11px] font-bold text-ink">
                  {item.sessionTitle}
                  {item.occurredAt ? (
                    <span className="ml-2 font-normal text-muted">
                      {formatOccurredAt(item.occurredAt)}
                    </span>
                  ) : null}
                </p>
              ) : null}
              <p className="mt-0.5 text-[11px] font-bold text-muted">
                {roleLabel(item.role)}
              </p>
              {item.validated && item.quote ? (
                <p className="mt-1 text-sm leading-6 text-ink">
                  「{item.quote}」
                </p>
              ) : (
                <p
                  title={failureLabel(item.reason)}
                  className="mt-1 text-xs font-bold text-amber-800"
                >
                  原文で確認できず
                  {showFailureReasons ? (
                    <span className="ml-1 font-normal">
                      （{failureLabel(item.reason)}）
                    </span>
                  ) : null}
                </p>
              )}
              {item.validated && item.messageId && item.sessionId ? (
                <div className="mt-2">
                  <EvidenceLink
                    sessionId={item.sessionId}
                    messageId={item.messageId}
                    label="元発言を見る"
                  />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
