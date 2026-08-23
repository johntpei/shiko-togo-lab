import { createHash } from "node:crypto";

export function canonicalizeJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeJsonValue(item));
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort((left, right) =>
      left.localeCompare(right),
    )) {
      out[key] = canonicalizeJsonValue(record[key]);
    }
    return out;
  }
  return value;
}

export function canonicalJson(value: unknown) {
  return JSON.stringify(canonicalizeJsonValue(value));
}

export function sha256Utf8(text: string) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function hashJsonContent(value: unknown) {
  return sha256Utf8(canonicalJson(value));
}

export function hashArtifactText(text: string) {
  return sha256Utf8(text);
}
