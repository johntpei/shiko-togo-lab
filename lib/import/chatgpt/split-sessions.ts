import type { GapHours, VisibleMessage } from "./types";

export { DEFAULT_SESSION_GAP_HOURS, SESSION_GAP_PRESETS } from "./types";

export function splitByTimeGap(
  messages: VisibleMessage[],
  gapHours: GapHours,
): VisibleMessage[][] {
  if (messages.length === 0) {
    return [];
  }
  if (gapHours == null || gapHours <= 0) {
    return [messages];
  }

  const gapSeconds = gapHours * 60 * 60;
  const groups: VisibleMessage[][] = [[messages[0]]];

  for (let i = 1; i < messages.length; i += 1) {
    const previous = messages[i - 1];
    const current = messages[i];
    const prevTime = previous.sourceCreatedAt;
    const currentTime = current.sourceCreatedAt;
    const shouldSplit =
      prevTime != null &&
      currentTime != null &&
      currentTime - prevTime >= gapSeconds;

    if (shouldSplit) {
      groups.push([current]);
    } else {
      groups[groups.length - 1].push(current);
    }
  }

  return groups;
}
