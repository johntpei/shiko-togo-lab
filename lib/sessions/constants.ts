export const SESSION_SOURCES = ["chatgpt", "claude", "gemini", "other"] as const;
export type SessionSource = (typeof SESSION_SOURCES)[number];

export const SESSION_STATUSES = ["draft", "parsed", "analyzed"] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];
