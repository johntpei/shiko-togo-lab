export type MessageRole = "user" | "assistant" | "unknown";

export type ParsedMessage = {
  index: number;
  role: MessageRole;
  content: string;
  charStart: number;
  charEnd: number;
};

type SpeakerLabel = {
  role: Exclude<MessageRole, "unknown">;
  text: string;
};

const SPEAKER_LABELS: SpeakerLabel[] = [
  { text: "You said:", role: "user" },
  { text: "ChatGPT said:", role: "assistant" },
  { text: "User said:", role: "user" },
  { text: "Assistant said:", role: "assistant" },
  { text: "ユーザー:", role: "user" },
  { text: "ユーザー：", role: "user" },
  { text: "アシスタント:", role: "assistant" },
  { text: "アシスタント：", role: "assistant" },
  { text: "あなた:", role: "user" },
  { text: "あなた：", role: "user" },
  { text: "User:", role: "user" },
  { text: "Assistant:", role: "assistant" },
  { text: "Human:", role: "user" },
  { text: "ChatGPT:", role: "assistant" },
  { text: "You:", role: "user" },
];

type FoundLabel = {
  lineStart: number;
  bodyStart: number;
  role: Exclude<MessageRole, "unknown">;
};

function startsWithInsensitive(line: string, label: string) {
  return line.slice(0, label.length).toLowerCase() === label.toLowerCase();
}

function matchSpeakerLabel(
  line: string,
  lineStart: number,
): FoundLabel | null {
  let offset = 0;
  while (offset < line.length && (line[offset] === " " || line[offset] === "\t")) {
    offset += 1;
  }

  const rest = line.slice(offset);

  for (const label of SPEAKER_LABELS) {
    const matchesAscii = /^[\x00-\x7F]+$/.test(label.text)
      ? startsWithInsensitive(rest, label.text)
      : rest.startsWith(label.text);

    if (!matchesAscii) {
      continue;
    }

    let bodyStartInLine = offset + label.text.length;
    while (
      bodyStartInLine < line.length &&
      (line[bodyStartInLine] === " " || line[bodyStartInLine] === "\t")
    ) {
      bodyStartInLine += 1;
    }

    let bodyStart = lineStart + bodyStartInLine;
    if (line[bodyStartInLine] === undefined) {
      bodyStart = lineStart + line.length;
    }

    return {
      lineStart,
      bodyStart,
      role: label.role,
    };
  }

  return null;
}

function findLineStartLabels(rawContent: string) {
  const labels: FoundLabel[] = [];
  let lineStart = 0;

  while (lineStart <= rawContent.length) {
    const newlineAt = rawContent.indexOf("\n", lineStart);
    const lineEnd = newlineAt === -1 ? rawContent.length : newlineAt;
    const line =
      lineEnd > lineStart && rawContent[lineEnd - 1] === "\r"
        ? rawContent.slice(lineStart, lineEnd - 1)
        : rawContent.slice(lineStart, lineEnd);
    const found = matchSpeakerLabel(line, lineStart);
    if (found) {
      let bodyStart = found.bodyStart;
      if (bodyStart === lineEnd && newlineAt !== -1) {
        bodyStart = newlineAt + 1;
      }
      labels.push({ ...found, bodyStart });
    }

    if (newlineAt === -1) {
      break;
    }
    lineStart = newlineAt + 1;
  }

  return labels;
}

function parseLabeled(rawContent: string, labels: FoundLabel[]): ParsedMessage[] {
  const messages: ParsedMessage[] = [];
  let index = 0;

  if (labels[0].lineStart > 0) {
    const preamble = sliceMessage(rawContent, 0, labels[0].lineStart, "unknown", index);
    if (preamble) {
      messages.push(preamble);
      index += 1;
    }
  }

  for (let i = 0; i < labels.length; i += 1) {
    const current = labels[i];
    const nextLineStart = labels[i + 1]?.lineStart ?? rawContent.length;
    const parsed = sliceMessage(
      rawContent,
      current.bodyStart,
      nextLineStart,
      current.role,
      index,
    );
    if (parsed) {
      messages.push(parsed);
      index += 1;
    }
  }

  return messages;
}

function parseUnknownParagraphs(rawContent: string): ParsedMessage[] {
  const messages: ParsedMessage[] = [];
  const boundary = /\n{2,}/g;
  let index = 0;
  let lastEnd = 0;
  let match: RegExpExecArray | null;

  while ((match = boundary.exec(rawContent)) !== null) {
    const block = sliceMessage(rawContent, lastEnd, match.index, "unknown", index);
    if (block) {
      messages.push(block);
      index += 1;
    }
    lastEnd = match.index + match[0].length;
  }

  const tail = sliceMessage(
    rawContent,
    lastEnd,
    rawContent.length,
    "unknown",
    index,
  );
  if (tail) {
    messages.push(tail);
  }

  if (messages.length === 0) {
    return [
      {
        index: 0,
        role: "unknown",
        content: rawContent,
        charStart: 0,
        charEnd: rawContent.length,
      },
    ];
  }

  return messages;
}

function sliceMessage(
  rawContent: string,
  start: number,
  end: number,
  role: MessageRole,
  index: number,
): ParsedMessage | null {
  if (end <= start) {
    return null;
  }

  const content = rawContent.slice(start, end);
  if (!/\S/.test(content)) {
    return null;
  }

  return {
    index,
    role,
    content,
    charStart: start,
    charEnd: end,
  };
}

export function parseTranscript(rawContent: string): ParsedMessage[] {
  if (rawContent.length === 0) {
    return [];
  }

  const labels = findLineStartLabels(rawContent);
  if (labels.length > 0) {
    const labeled = parseLabeled(rawContent, labels);
    if (labeled.length > 0) {
      return labeled;
    }
  }

  return parseUnknownParagraphs(rawContent);
}

export function assertMessageAnchors(rawContent: string, messages: ParsedMessage[]) {
  for (const message of messages) {
    const slice = rawContent.slice(message.charStart, message.charEnd);
    if (slice !== message.content) {
      throw new Error(
        `anchor mismatch at index ${message.index}: slice !== content`,
      );
    }
    if (message.charStart < 0 || message.charEnd > rawContent.length) {
      throw new Error(`anchor out of range at index ${message.index}`);
    }
  }

  const ordered = [...messages].sort((a, b) => a.charStart - b.charStart);
  for (let i = 1; i < ordered.length; i += 1) {
    if (ordered[i - 1].charEnd > ordered[i].charStart) {
      throw new Error("message ranges overlap");
    }
  }
}
