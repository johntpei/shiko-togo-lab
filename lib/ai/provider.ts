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

export type StructuredGenerateResult = {
  parsed: unknown;
  model: string;
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
