// Provider factory: returns real or mock providers based on env config.
//
// In MVP mode (USE_MOCK_PROVIDERS=true, default) no API keys are required.
// Real providers are only constructed when their API key is present; if a key
// is missing we automatically fall back to the mock for that provider so the
// app stays runnable.

import type { AiProviderAdapter } from "../provider";
import type { ProviderId } from "../types";
import { MockProviderAdapter } from "./mock";
import { OpenAiProviderAdapter } from "./openai";
import { AnthropicProviderAdapter } from "./anthropic";
import { GeminiProviderAdapter } from "./gemini";

export type ProviderRegistry = Record<ProviderId, AiProviderAdapter>;

export function buildProviderRegistry(): ProviderRegistry {
  const useMock =
    (process.env.USE_MOCK_PROVIDERS ?? "true").toLowerCase() !== "false";

  if (useMock) {
    return {
      gemini: new MockProviderAdapter("gemini"),
      anthropic: new MockProviderAdapter("anthropic"),
      openai: new MockProviderAdapter("openai"),
    };
  }

  return {
    gemini: process.env.GEMINI_API_KEY
      ? new GeminiProviderAdapter()
      : new MockProviderAdapter("gemini"),
    anthropic: process.env.ANTHROPIC_API_KEY
      ? new AnthropicProviderAdapter()
      : new MockProviderAdapter("anthropic"),
    openai: process.env.OPENAI_API_KEY
      ? new OpenAiProviderAdapter()
      : new MockProviderAdapter("openai"),
  };
}

export const PROVIDER_IDS: ProviderId[] = ["gemini", "anthropic", "openai"];
