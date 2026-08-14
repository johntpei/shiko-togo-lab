import {
  SESSION_SOURCES,
  type SessionSource,
} from "@/lib/sessions/constants";

export const SOURCE_LABELS: Record<SessionSource, string> = {
  chatgpt: "ChatGPT",
  claude: "Claude",
  gemini: "Gemini",
  other: "その他",
};

export const CATEGORY_SUGGESTIONS = [
  "仕事",
  "学習",
  "自己理解",
  "健康",
  "制作",
  "その他",
] as const;

export { SESSION_SOURCES, type SessionSource };

export function formatOccurredAt(isoDate: string) {
  const [year, month, day] = isoDate.split("-");
  if (!year || !month || !day) {
    return isoDate;
  }
  return `${year}/${month}/${day}`;
}

export function localTodayIsoDate() {
  return toIsoDate(new Date());
}

export function currentWeekRange(now = new Date()) {
  const day = now.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + mondayOffset);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  return {
    start: toIsoDate(monday),
    end: toIsoDate(sunday),
  };
}

export function lastWeekRange(now = new Date()) {
  const current = currentWeekRange(now);
  return {
    start: addDaysToIsoDate(current.start, -7),
    end: addDaysToIsoDate(current.end, -7),
  };
}

export function lastDaysRange(days: number, now = new Date()) {
  const end = toIsoDate(now);
  return {
    start: addDaysToIsoDate(end, -(days - 1)),
    end,
  };
}

export const REVIEW_DATE_PRESETS = [
  "this-week",
  "last-week",
  "last-7-days",
  "last-30-days",
  "all",
] as const;

export type ReviewDatePreset = (typeof REVIEW_DATE_PRESETS)[number];

export function isReviewDatePreset(value: string): value is ReviewDatePreset {
  return (REVIEW_DATE_PRESETS as readonly string[]).includes(value);
}

export function rangeForReviewPreset(
  preset: ReviewDatePreset,
  now = new Date(),
) {
  if (preset === "this-week") {
    return currentWeekRange(now);
  }
  if (preset === "last-week") {
    return lastWeekRange(now);
  }
  if (preset === "last-7-days") {
    return lastDaysRange(7, now);
  }
  if (preset === "last-30-days") {
    return lastDaysRange(30, now);
  }
  return { start: "", end: "" };
}

export function sessionInDateRange(
  occurredAt: string,
  range: { start: string; end: string },
) {
  if (range.start && occurredAt < range.start) {
    return false;
  }
  if (range.end && occurredAt > range.end) {
    return false;
  }
  return true;
}

export function buildIntegratedReviewTitle(input: {
  preset?: string;
  sessionOccurredAts: string[];
  now?: Date;
}) {
  if (input.preset === "this-week") {
    const week = currentWeekRange(input.now);
    return `今週の統合レビュー ${formatOccurredAt(week.start)}〜${formatOccurredAt(week.end)}`;
  }
  const dates = [...input.sessionOccurredAts].filter(Boolean).sort();
  const min = dates[0];
  const max = dates[dates.length - 1];
  if (min && max && min !== max) {
    return `統合レビュー — ${formatOccurredAt(min)}〜${formatOccurredAt(max)}`;
  }
  if (min) {
    return `統合レビュー — ${formatOccurredAt(min)}`;
  }
  return `統合レビュー — ${formatOccurredAt(toIsoDate(input.now ?? new Date()))}`;
}

function addDaysToIsoDate(isoDate: string, days: number) {
  const date = fromIsoDate(isoDate);
  date.setDate(date.getDate() + days);
  return toIsoDate(date);
}

function fromIsoDate(isoDate: string) {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1);
}

function toIsoDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
