import type { z } from "zod";
import { AnalyzeSessionError } from "./errors";
import { getAiConfig } from "./config";
import { createOpenAiProvider } from "./providers/openai";

export type StructuredGenerateRequest = {
  model: string;
  system: string;
  user: string;
  schema: z.ZodType;
  schemaName: string;
  timeoutMs?: number;
};

export type StructuredGenerateUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
};

export function addStructuredUsage(
  current: StructuredGenerateUsage | null,
  next: StructuredGenerateUsage | null,
): StructuredGenerateUsage | null {
  if (!current && !next) {
    return null;
  }
  const sum = (a: number | null | undefined, b: number | null | undefined) => {
    if (a == null && b == null) {
      return null;
    }
    return (a ?? 0) + (b ?? 0);
  };
  return {
    inputTokens: sum(current?.inputTokens, next?.inputTokens),
    outputTokens: sum(current?.outputTokens, next?.outputTokens),
    totalTokens: sum(current?.totalTokens, next?.totalTokens),
  };
}

export type StructuredGenerateResult = {
  parsed: unknown;
  model: string;
  usage?: StructuredGenerateUsage;
};

export type AiProvider = {
  generateStructured(
    request: StructuredGenerateRequest,
  ): Promise<StructuredGenerateResult>;
};

export function getAiProvider(): AiProvider {
  const { provider } = getAiConfig();
  if (provider !== "openai") {
    throw new AnalyzeSessionError(
      "unsupported_provider",
      "未対応のAIプロバイダです",
    );
  }
  return createOpenAiProvider();
}
