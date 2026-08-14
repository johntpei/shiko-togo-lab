import type { MessageRecord } from "@/lib/db/schema";
import {
  splitMessageIntoEvidenceUnits,
  toEvidenceRef,
  toMessageRef,
  type EvidenceUnit,
} from "./evidence-units";

export { toMessageRef };

const ANALYZABLE_ROLES = new Set(["user", "assistant"]);

export type AnalyzeMessage = Pick<
  MessageRecord,
  "id" | "role" | "content" | "attachmentsJson"
>;

export type AnalyzeInput = {
  labeledTranscript: string;
  refToMessageId: Map<string, string>;
  contentByMessageId: Map<string, string>;
  analyzableCount: number;
};

export type EvidenceAnalyzeInput = {
  labeledTranscript: string;
  units: EvidenceUnit[];
  unitsByRef: Map<string, EvidenceUnit>;
  contentByMessageId: Map<string, string>;
  analyzableCount: number;
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

export function buildAnalyzeInput(messages: AnalyzeMessage[]): AnalyzeInput {
  const analyzable = messages.filter((message) =>
    ANALYZABLE_ROLES.has(message.role),
  );
  const refToMessageId = new Map<string, string>();
  const contentByMessageId = new Map<string, string>();

  const blocks = analyzable.map((message, index) => {
    const ref = toMessageRef(index);
    refToMessageId.set(ref, message.id);
    contentByMessageId.set(message.id, message.content);
    const role = message.role.toUpperCase();
    const attachmentNote = hasAttachments(message.attachmentsJson)
      ? "\n（添付ファイルあり）"
      : "";
    return `[S1:${ref}][${role}]\n${message.content}${attachmentNote}`;
  });

  return {
    labeledTranscript: blocks.join("\n\n"),
    refToMessageId,
    contentByMessageId,
    analyzableCount: analyzable.length,
  };
}

export function buildEvidenceAnalyzeInput(
  messages: AnalyzeMessage[],
  sessionIndex?: number,
): EvidenceAnalyzeInput {
  const analyzable = messages.filter((message) =>
    ANALYZABLE_ROLES.has(message.role),
  );
  const contentByMessageId = new Map<string, string>();
  const units: EvidenceUnit[] = [];
  const unitsByRef = new Map<string, EvidenceUnit>();
  const blocks: string[] = [];

  for (const [messageIndex, message] of analyzable.entries()) {
    const messageRef = toMessageRef(messageIndex);
    contentByMessageId.set(message.id, message.content);
    const slices = splitMessageIntoEvidenceUnits(message.content);
    blocks.push(`[${message.role.toUpperCase()} MESSAGE ${messageRef}]`);

    for (const [unitIndex, slice] of slices.entries()) {
      const localRef = toEvidenceRef({ messageIndex, unitIndex });
      const ref = toEvidenceRef({ messageIndex, unitIndex, sessionIndex });
      const unit: EvidenceUnit = {
        ...slice,
        ref,
        messageRef,
        messageId: message.id,
        role: message.role,
      };
      units.push(unit);
      unitsByRef.set(localRef, unit);
      unitsByRef.set(ref, unit);
      blocks.push(`[${localRef}]\n${slice.text}`);
    }

    if (hasAttachments(message.attachmentsJson)) {
      blocks.push("（添付ファイルあり）");
    }
  }

  return {
    labeledTranscript: blocks.join("\n\n"),
    units,
    unitsByRef,
    contentByMessageId,
    analyzableCount: analyzable.length,
  };
}
