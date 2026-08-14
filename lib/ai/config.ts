export type AiConfig = {
  apiKey: string | null;
  provider: string;
  model: string | null;
};

export type PublicAiStatus = {
  hasApiKey: boolean;
  hasModel: boolean;
  provider: string;
  ready: boolean;
  message: string | null;
};

function readEnv(name: string): string | null {
  // ブラケット参照にする。
  // process.env.OPENAI_API_KEY のような静的参照は、Next.js / Turbopack が
  // 非 NEXT_PUBLIC_ 変数をクライアント漏洩防止のため undefined に置換することがある。
  const value = process.env[name];
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function getAiConfig(): AiConfig {
  return {
    apiKey: readEnv("OPENAI_API_KEY"),
    provider: (readEnv("AI_PROVIDER") || "openai").toLowerCase(),
    model: readEnv("AI_MODEL"),
  };
}

export function getPublicAiStatus(): PublicAiStatus {
  const config = getAiConfig();
  const hasApiKey = Boolean(config.apiKey);
  const hasModel = Boolean(config.model);
  const supported = config.provider === "openai";

  let message: string | null = null;
  if (!hasApiKey) {
    message = "OpenAI APIキーが設定されていません";
  } else if (!supported) {
    message = "未対応のAIプロバイダです";
  } else if (!hasModel) {
    message = "AI_MODEL が設定されていません";
  }

  return {
    hasApiKey,
    hasModel,
    provider: config.provider,
    ready: hasApiKey && hasModel && supported,
    message,
  };
}
