import type { StoredAnalysisPayload } from "./schemas";
import type { MessageRecord, SessionRecord } from "@/lib/db/schema";
import { ANALYZE_SESSION_PROMPT_V4 } from "./prompts/analyze-session";
import {
  splitMessageIntoEvidenceUnits,
  toEvidenceRef,
  toEvidenceRole,
  toMessageRef,
  toSessionRef,
  type EvidenceUnit,
} from "./evidence-units";
import { formatOccurredAt } from "@/lib/sessions/labels";
import { APP_NAME } from "@/lib/app/identity";

const ANALYZABLE_ROLES = new Set(["user", "assistant"]);

export type ReviewAnalyzeMessage = Pick<
  MessageRecord,
  "id" | "role" | "content" | "attachmentsJson"
>;

export type ReviewSessionSource = {
  session: Pick<
    SessionRecord,
    "id" | "title" | "occurredAt" | "source" | "category" | "createdAt"
  >;
  messages: ReviewAnalyzeMessage[];
  analysis?: {
    promptVersion: string;
    payload: StoredAnalysisPayload;
  } | null;
};

export type ReviewSessionMeta = {
  sessionId: string;
  sessionRef: string;
  title: string;
  occurredAt: string;
};

export type IntegratedReviewInput = {
  labeledTranscript: string;
  units: EvidenceUnit[];
  unitsByRef: Map<string, EvidenceUnit>;
  contentByMessageId: Map<string, string>;
  sessions: ReviewSessionMeta[];
  sessionIdByRef: Map<string, string>;
  selectedSessionIds: string[];
  analyzableSessionCount: number;
};

function hasAttachments(json: string | null) {
  if (!json) {
    return false;
  }
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) && parsed.length > 0;
  } catch {
    return false;
  }
}

function analyzableMessages(messages: ReviewAnalyzeMessage[]) {
  return messages.filter((message) => ANALYZABLE_ROLES.has(message.role));
}

function formatAuxiliaryAnalysis(payload: StoredAnalysisPayload) {
  const items = payload.items.filter((item) => item.semanticValid !== false);
  const lines = [`summary: ${payload.summary}`];
  for (const item of items.slice(0, 20)) {
    const subject = item.subject ? `/${item.subject}` : "";
    lines.push(`- [${item.kind}${subject}] ${item.text}`);
  }
  return lines.join("\n");
}

export function sortReviewSessions<T extends ReviewSessionSource>(sources: T[]) {
  return [...sources].sort((left, right) => {
    const byDate = left.session.occurredAt.localeCompare(right.session.occurredAt);
    if (byDate !== 0) {
      return byDate;
    }
    const byCreated = left.session.createdAt.localeCompare(right.session.createdAt);
    if (byCreated !== 0) {
      return byCreated;
    }
    return left.session.id.localeCompare(right.session.id);
  });
}

/**
 * 選択された Session だけを、S01 / S02 ... 付き Evidence Units へ変換する。
 * ローカル ref（M003:E02）は map に入れない。複数Sessionで衝突するため。
 */
export function buildIntegratedReviewInput(
  sources: ReviewSessionSource[],
): IntegratedReviewInput {
  const selectedSessionIds = sources.map((source) => source.session.id);
  const ordered = sortReviewSessions(sources).filter(
    (source) => analyzableMessages(source.messages).length > 0,
  );

  const units: EvidenceUnit[] = [];
  const unitsByRef = new Map<string, EvidenceUnit>();
  const contentByMessageId = new Map<string, string>();
  const sessions: ReviewSessionMeta[] = [];
  const sessionIdByRef = new Map<string, string>();
  const blocks: string[] = [];

  for (const [sessionIndex, source] of ordered.entries()) {
    const sessionRef = toSessionRef(sessionIndex);
    const analyzable = analyzableMessages(source.messages);
    sessions.push({
      sessionId: source.session.id,
      sessionRef,
      title: source.session.title,
      occurredAt: source.session.occurredAt,
    });
    sessionIdByRef.set(sessionRef, source.session.id);

    blocks.push("====================");
    blocks.push(`SESSION ${sessionRef}`);
    blocks.push("===========");
    blocks.push("");
    blocks.push("Title:");
    blocks.push(source.session.title);
    blocks.push("");
    blocks.push("Date:");
    blocks.push(formatOccurredAt(source.session.occurredAt));
    blocks.push("");

    for (const [messageIndex, message] of analyzable.entries()) {
      contentByMessageId.set(message.id, message.content);
      const slices = splitMessageIntoEvidenceUnits(message.content);
      const role = toEvidenceRole(message.role);
      const roleLabel = role.toUpperCase();
      const messageRef = toMessageRef(messageIndex);

      for (const [unitIndex, slice] of slices.entries()) {
        const ref = toEvidenceRef({ sessionIndex, messageIndex, unitIndex });
        const unit: EvidenceUnit = {
          ...slice,
          ref,
          messageRef,
          messageId: message.id,
          role,
          sessionId: source.session.id,
          sessionTitle: source.session.title,
          sessionOccurredAt: source.session.occurredAt,
        };
        units.push(unit);
        unitsByRef.set(ref, unit);
        blocks.push(`[${ref}][${roleLabel}]`);
        blocks.push(slice.text);
        blocks.push("");
      }

      if (hasAttachments(message.attachmentsJson)) {
        blocks.push("（添付ファイルあり）");
        blocks.push("");
      }
    }

    if (
      source.analysis?.promptVersion === ANALYZE_SESSION_PROMPT_V4 &&
      source.analysis.payload
    ) {
      blocks.push("----- SessionAnalysis (reference only / NOT evidence) -----");
      blocks.push(`promptVersion: ${source.analysis.promptVersion}`);
      blocks.push(formatAuxiliaryAnalysis(source.analysis.payload));
      blocks.push("");
    }
  }

  return {
    labeledTranscript: blocks.join("\n").trim(),
    units,
    unitsByRef,
    contentByMessageId,
    sessions,
    sessionIdByRef,
    selectedSessionIds,
    analyzableSessionCount: ordered.length,
  };
}

export function buildReviewCurrentContextNote(sessions: ReviewSessionMeta[]) {
  const newest = sessions[sessions.length - 1];
  const oldest = sessions[0];
  const newestLine = newest
    ? `最も新しいSessionは ${newest.sessionRef}（${formatOccurredAt(newest.occurredAt)} / ${newest.title}）。`
    : "";
  const oldestLine =
    oldest && newest && oldest.sessionRef !== newest.sessionRef
      ? `最も古いSessionは ${oldest.sessionRef}（${formatOccurredAt(oldest.occurredAt)} / ${oldest.title}）。`
      : "";
  return [
    `現在のプロジェクト名は「${APP_NAME}」です。古いSession内の別名称を現在名として使わないでください。`,
    "明示的なUSER Decisionは、新しいSessionを古いSessionより優先してください。",
    newestLine,
    oldestLine,
  ]
    .filter(Boolean)
    .join("\n");
}
