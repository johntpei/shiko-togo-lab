export const EVIDENCE_UNIT_MIN_CHARS = 20;
export const EVIDENCE_UNIT_MAX_CHARS = 250;
export const MAX_EVIDENCE_REFS_PER_ITEM = 3;

export type EvidenceUnitSlice = {
  text: string;
  charStartInMessage: number;
  charEndInMessage: number;
};

export type EvidenceUnit = EvidenceUnitSlice & {
  ref: string;
  messageRef: string;
  messageId: string;
  role: string;
};

export function toMessageRef(index: number) {
  return `M${String(index + 1).padStart(3, "0")}`;
}

export function toSessionRef(index: number) {
  return `S${String(index + 1).padStart(2, "0")}`;
}

export function toUnitSuffix(index: number) {
  return `E${String(index + 1).padStart(2, "0")}`;
}

export function toEvidenceRef(input: {
  messageIndex: number;
  unitIndex: number;
  sessionIndex?: number;
}) {
  const local = `${toMessageRef(input.messageIndex)}:${toUnitSuffix(input.unitIndex)}`;
  if (input.sessionIndex == null) {
    return local;
  }
  return `${toSessionRef(input.sessionIndex)}:${local}`;
}

export function parseEvidenceRef(ref: string): {
  sessionIndex: number | null;
  messageIndex: number;
  unitIndex: number;
} | null {
  const full = /^S(\d+):M(\d+):E(\d+)$/i.exec(ref.trim());
  if (full) {
    return {
      sessionIndex: Number(full[1]) - 1,
      messageIndex: Number(full[2]) - 1,
      unitIndex: Number(full[3]) - 1,
    };
  }
  const local = /^M(\d+):E(\d+)$/i.exec(ref.trim());
  if (local) {
    return {
      sessionIndex: null,
      messageIndex: Number(local[1]) - 1,
      unitIndex: Number(local[2]) - 1,
    };
  }
  return null;
}

function isDecimalDot(content: string, index: number) {
  return (
    content[index] === "." &&
    index > 0 &&
    index + 1 < content.length &&
    /\d/.test(content[index - 1]!) &&
    /\d/.test(content[index + 1]!)
  );
}

function collectBreakOffsets(content: string) {
  const breaks = new Set<number>();
  for (let i = 0; i < content.length; i += 1) {
    const ch = content[i]!;
    if (ch === "\r") {
      continue;
    }
    if (ch === "\n") {
      breaks.add(i + 1);
      continue;
    }
    if (ch === "。" || ch === "！" || ch === "？") {
      breaks.add(i + 1);
      continue;
    }
    if ((ch === "." || ch === "!" || ch === "?") && !isDecimalDot(content, i)) {
      let end = i + 1;
      while (end < content.length && content[end] === " ") {
        end += 1;
      }
      breaks.add(end);
    }
  }
  breaks.add(content.length);
  return [...breaks].filter((offset) => offset > 0).sort((a, b) => a - b);
}

function trimRange(content: string, start: number, end: number) {
  let from = start;
  let to = end;
  while (from < to && /\s/.test(content[from]!)) {
    from += 1;
  }
  while (to > from && /\s/.test(content[to - 1]!)) {
    to -= 1;
  }
  return { from, to };
}

/**
 * Message.content を Evidence Unit へ分割する。
 * 原文の連続部分文字列だけを使い、要約・Markdown削除などはしない。
 */
export function splitMessageIntoEvidenceUnits(content: string): EvidenceUnitSlice[] {
  if (!content) {
    return [];
  }

  const breaks = collectBreakOffsets(content);
  const units: EvidenceUnitSlice[] = [];
  let cursor = 0;

  while (cursor < content.length) {
    while (cursor < content.length && /\s/.test(content[cursor]!)) {
      cursor += 1;
    }
    if (cursor >= content.length) {
      break;
    }

    const minEnd = cursor + EVIDENCE_UNIT_MIN_CHARS;
    const maxEnd = cursor + EVIDENCE_UNIT_MAX_CHARS;
    const laterBreaks = breaks.filter((offset) => offset > cursor);
    const firstLongEnough = laterBreaks.find((offset) => offset >= minEnd);
    const lastWithinMax = [...laterBreaks]
      .reverse()
      .find((offset) => offset <= maxEnd);

    let chosen: number;
    if (firstLongEnough != null && firstLongEnough <= maxEnd) {
      chosen = firstLongEnough;
    } else if (lastWithinMax != null && lastWithinMax >= minEnd) {
      chosen = lastWithinMax;
    } else if (firstLongEnough != null) {
      chosen = firstLongEnough;
    } else {
      chosen = content.length;
    }

    if (chosen <= cursor) {
      chosen = content.length;
    }

    const range = trimRange(content, cursor, chosen);
    if (range.to > range.from) {
      units.push({
        text: content.slice(range.from, range.to),
        charStartInMessage: range.from,
        charEndInMessage: range.to,
      });
    }
    cursor = Math.max(chosen, range.to);
  }

  return units;
}

export function assertUnitAnchors(content: string, units: EvidenceUnitSlice[]) {
  for (const unit of units) {
    const slice = content.slice(unit.charStartInMessage, unit.charEndInMessage);
    if (slice !== unit.text) {
      throw new Error("Evidence Unit is not an exact substring of Message.content");
    }
  }
}
