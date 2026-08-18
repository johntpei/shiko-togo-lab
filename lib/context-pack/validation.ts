import type { ContextCandidate } from "./schema";
import { toStoredPackItem } from "./candidates";
import type { StoredContextPackItem } from "./schema";

export type InvalidSourceRef = {
  ref: string;
  reason: "invalid_source_ref";
};

export function resolveSourceRefs(
  refs: string[],
  byRef: Map<string, ContextCandidate>,
) {
  const items: StoredContextPackItem[] = [];
  const invalid: InvalidSourceRef[] = [];
  const seen = new Set<string>();
  for (const raw of refs) {
    const ref = raw.trim();
    if (!ref || seen.has(ref)) {
      continue;
    }
    seen.add(ref);
    const candidate = byRef.get(ref);
    if (!candidate) {
      invalid.push({ ref, reason: "invalid_source_ref" });
      continue;
    }
    items.push(toStoredPackItem(candidate));
  }
  return { items, invalid };
}

export function forceCurrentContext(
  items: StoredContextPackItem[],
  byRef: Map<string, ContextCandidate>,
) {
  const forced = ["C:PROJECT_NAME", "C:CORE_PURPOSE"].flatMap((ref) => {
    const candidate = byRef.get(ref);
    return candidate ? [toStoredPackItem(candidate)] : [];
  });
  const rest = items.filter(
    (item) => item.sourceRef !== "C:PROJECT_NAME" && item.sourceRef !== "C:CORE_PURPOSE",
  );
  return [...forced, ...rest];
}
