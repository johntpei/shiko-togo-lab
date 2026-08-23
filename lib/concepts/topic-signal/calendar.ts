/**
 * Calendar date for Topic Signal buckets.
 * Reuses the stored-prefix convention from formatThoughtDate:
 * first 10 characters of occurredAt as YYYY-MM-DD.
 * Not a timezone conversion and not wall-clock `new Date()`.
 */
export function calendarDateFromOccurredAt(occurredAt: string): string | null {
  const day = occurredAt.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return null;
  }
  return day;
}

export function addCalendarDays(date: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) {
    throw new Error(`invalid calendar date: ${date}`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return new Date(Date.UTC(year, month - 1, day + days))
    .toISOString()
    .slice(0, 10);
}

export type TopicSignalWindowDates = {
  recentStart: string;
  recentEnd: string;
  previousStart: string;
  previousEnd: string;
};

/** asOf date inclusive 7 calendar days, then the 7 days immediately before. */
export function topicSignalWindowDates(asOfDate: string): TopicSignalWindowDates {
  return {
    recentStart: addCalendarDays(asOfDate, -6),
    recentEnd: asOfDate,
    previousStart: addCalendarDays(asOfDate, -13),
    previousEnd: addCalendarDays(asOfDate, -7),
  };
}

export function isCalendarDateInInclusiveRange(
  date: string,
  start: string,
  end: string,
) {
  return date >= start && date <= end;
}

/** Inclusive calendar-day distance. Same day = 0. */
export function calendarDayDistance(startDate: string, endDate: string): number {
  const start = calendarDateFromOccurredAt(startDate);
  const end = calendarDateFromOccurredAt(endDate);
  if (!start || !end) {
    throw new Error(`invalid calendar date distance: ${startDate} .. ${endDate}`);
  }
  const startMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(start);
  const endMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(end);
  if (!startMatch || !endMatch) {
    throw new Error(`invalid calendar date distance: ${startDate} .. ${endDate}`);
  }
  const startUtc = Date.UTC(
    Number(startMatch[1]),
    Number(startMatch[2]) - 1,
    Number(startMatch[3]),
  );
  const endUtc = Date.UTC(
    Number(endMatch[1]),
    Number(endMatch[2]) - 1,
    Number(endMatch[3]),
  );
  return Math.round((endUtc - startUtc) / 86_400_000);
}
