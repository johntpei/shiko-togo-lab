export function thoughtDate(input: {
  lastSeenAt: string | null;
  firstSeenAt: string | null;
}) {
  return input.lastSeenAt ?? input.firstSeenAt ?? null;
}

export function thoughtDateSortKey(input: {
  lastSeenAt: string | null;
  firstSeenAt: string | null;
  detectedAt: string;
}) {
  return thoughtDate(input) ?? input.detectedAt;
}

export function formatThoughtDate(value: string | null) {
  if (!value) {
    return null;
  }
  const day = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return null;
  }
  return `${day.slice(0, 4)}/${day.slice(5, 7)}/${day.slice(8, 10)}`;
}
