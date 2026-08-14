export type AnalyzeErrorCode =
  | "not_configured"
  | "unsupported_provider"
  | "too_long"
  | "no_messages"
  | "not_found"
  | "api"
  | "timeout"
  | "schema"
  | "save";

export class AnalyzeSessionError extends Error {
  readonly code: AnalyzeErrorCode;

  constructor(code: AnalyzeErrorCode, message: string) {
    super(message);
    this.name = "AnalyzeSessionError";
    this.code = code;
  }
}

export function userMessageForAnalyzeError(error: unknown): {
  code: AnalyzeErrorCode;
  error: string;
} {
  if (error instanceof AnalyzeSessionError) {
    return { code: error.code, error: error.message };
  }
  return {
    code: "api",
    error: "AI分析に失敗しました。Sessionの原文と発言は変更していません。",
  };
}
