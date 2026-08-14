import OpenAI, { APIConnectionTimeoutError, APIError } from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { getAiConfig } from "../config";
import { AnalyzeSessionError } from "../errors";
import { ANALYZE_SESSION_TIMEOUT_MS } from "../limits";
import type { AiProvider, StructuredGenerateRequest } from "../provider";

export function createOpenAiProvider(): AiProvider {
  return {
    async generateStructured(request: StructuredGenerateRequest) {
      const config = getAiConfig();
      if (!config.apiKey) {
        throw new AnalyzeSessionError(
          "not_configured",
          "OpenAI APIキーが設定されていません",
        );
      }

      const client = new OpenAI({
        apiKey: config.apiKey,
        timeout: ANALYZE_SESSION_TIMEOUT_MS,
      });

      try {
        const response = await client.responses.parse({
          model: request.model,
          store: false,
          instructions: request.system,
          input: request.user,
          text: {
            format: zodTextFormat(request.schema, request.schemaName),
          },
        });

        if (response.output_parsed == null) {
          throw new AnalyzeSessionError(
            "schema",
            "分析結果の形式が不正だったため保存しませんでした。",
          );
        }

        return {
          parsed: response.output_parsed,
          model: response.model || request.model,
        };
      } catch (error) {
        if (error instanceof AnalyzeSessionError) {
          throw error;
        }
        if (error instanceof APIConnectionTimeoutError) {
          throw new AnalyzeSessionError(
            "timeout",
            "分析が時間内に終わりませんでした。Sessionの原文と発言は変更していません。",
          );
        }
        if (error instanceof APIError) {
          console.error("openai responses.parse failed", {
            status: error.status,
            type: error.type,
          });
        } else {
          console.error("openai responses.parse failed");
        }
        throw new AnalyzeSessionError(
          "api",
          "AI分析に失敗しました。Sessionの原文と発言は変更していません。",
        );
      }
    },
  };
}
