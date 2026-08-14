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
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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

function toIsoDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
