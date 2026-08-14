const VISIBLE_CONTENT_TYPES = new Set(["text", "multimodal_text"]);

const EXCLUDED_CONTENT_TYPES = new Set([
  "thoughts",
  "reasoning_recap",
  "reasoning",
  "code",
  "execution_output",
  "system_error",
]);

const VISIBLE_ROLES = new Set(["user", "assistant"]);

export function isVisibleRole(role: string | undefined) {
  return role != null && VISIBLE_ROLES.has(role);
}

export function isExcludedContentType(contentType: string | undefined) {
  return contentType != null && EXCLUDED_CONTENT_TYPES.has(contentType);
}

export function isVisibleContentType(contentType: string | undefined) {
  if (!contentType) {
    return false;
  }
  if (isExcludedContentType(contentType)) {
    return false;
  }
  return VISIBLE_CONTENT_TYPES.has(contentType);
}

export function excludedContentTypes() {
  return [...EXCLUDED_CONTENT_TYPES];
}

export function visibleContentTypes() {
  return [...VISIBLE_CONTENT_TYPES];
}
