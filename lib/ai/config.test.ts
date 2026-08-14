import assert from "node:assert/strict";
import test from "node:test";
import { getAiConfig, getPublicAiStatus } from "./config";

function restore(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

test("OPENAI_API_KEY が空なら hasApiKey は false", () => {
  const prev = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "   ";
  try {
    const status = getPublicAiStatus();
    assert.equal(status.hasApiKey, false);
    assert.equal(status.message, "OpenAI APIキーが設定されていません");
  } finally {
    restore("OPENAI_API_KEY", prev);
  }
});

test("OPENAI_API_KEY があればキー自体は status に載せない", () => {
  const prev = {
    key: process.env.OPENAI_API_KEY,
    model: process.env.AI_MODEL,
    provider: process.env.AI_PROVIDER,
  };
  process.env.OPENAI_API_KEY = "sk-test-not-a-real-key";
  process.env.AI_MODEL = "test-model";
  process.env.AI_PROVIDER = "openai";
  try {
    const status = getPublicAiStatus();
    const config = getAiConfig();
    assert.equal(status.hasApiKey, true);
    assert.equal(status.ready, true);
    assert.equal(status.message, null);
    assert.equal("apiKey" in status, false);
    assert.doesNotMatch(JSON.stringify(status), /sk-test-not-a-real-key/);
    assert.equal(config.apiKey, "sk-test-not-a-real-key");
  } finally {
    restore("OPENAI_API_KEY", prev.key);
    restore("AI_MODEL", prev.model);
    restore("AI_PROVIDER", prev.provider);
  }
});
