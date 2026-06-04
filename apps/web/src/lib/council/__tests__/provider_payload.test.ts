import { beforeEach, describe, expect, it, vi } from "vitest";
import { AnthropicProviderAdapter } from "../providers/anthropic";
import { GeminiProviderAdapter } from "../providers/gemini";
import type { InitialOpinionInput, ProviderCallOptions } from "../types";

const sdk = vi.hoisted(() => ({
  anthropicCreate: vi.fn(),
  geminiGenerateContent: vi.fn(),
  geminiGetGenerativeModel: vi.fn(),
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = {
      create: sdk.anthropicCreate,
    };
  },
}));

vi.mock("@google/generative-ai", () => ({
  GoogleGenerativeAI: class MockGoogleGenerativeAI {
    getGenerativeModel(args: unknown) {
      return sdk.geminiGetGenerativeModel(args);
    }
  },
}));

const INPUT: InitialOpinionInput = {
  userPrompt: "HE-850A 적용 가능성을 간단히 검토해줘.",
  taskType: "technical_review",
  evidenceMode: "ai_only",
  domainSafetyPolicySummary: "테스트 정책",
};

function opts(model: string): ProviderCallOptions {
  return {
    timeoutMs: 10_000,
    retryCount: 0,
    sessionId: "payload-test",
    round: "initial",
    model,
  };
}

function opinionJson(): string {
  return JSON.stringify({
    summary: "테스트 요약",
    recommendedAnswer: "테스트 답변",
    confidenceScore: 0.5,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
  process.env.GEMINI_API_KEY = "test-gemini-key";
  delete process.env.ANTHROPIC_MAX_TOKENS;

  sdk.anthropicCreate.mockResolvedValue({
    content: [{ type: "text", text: opinionJson() }],
  });
  sdk.geminiGenerateContent.mockResolvedValue({
    response: { text: () => opinionJson() },
  });
  sdk.geminiGetGenerativeModel.mockReturnValue({
    generateContent: sdk.geminiGenerateContent,
  });
});

describe("provider request payloads", () => {
  it("does not send pinned temperature to Anthropic", async () => {
    const adapter = new AnthropicProviderAdapter();

    await adapter.generateInitialOpinion(INPUT, opts("claude-opus-4-8"));

    expect(sdk.anthropicCreate).toHaveBeenCalledTimes(1);
    const [payload, requestOptions] = sdk.anthropicCreate.mock.calls[0];
    expect(payload).toMatchObject({
      model: "claude-opus-4-8",
      max_tokens: 4096,
    });
    expect(payload).not.toHaveProperty("temperature");
    expect(requestOptions).toHaveProperty("signal", undefined);
  });

  it("allows Anthropic max_tokens to be increased by env", async () => {
    process.env.ANTHROPIC_MAX_TOKENS = "8192";
    const adapter = new AnthropicProviderAdapter();

    await adapter.generateInitialOpinion(INPUT, opts("claude-opus-4-8"));

    const [payload] = sdk.anthropicCreate.mock.calls[0];
    expect(payload).toMatchObject({
      model: "claude-opus-4-8",
      max_tokens: 8192,
    });
  });

  it("does not send pinned temperature to Gemini", async () => {
    const adapter = new GeminiProviderAdapter();

    await adapter.generateInitialOpinion(INPUT, opts("gemini-2.5-flash"));

    expect(sdk.geminiGetGenerativeModel).toHaveBeenCalledTimes(1);
    const [modelArgs] = sdk.geminiGetGenerativeModel.mock.calls[0];
    expect(modelArgs).toMatchObject({
      model: "gemini-2.5-flash",
      generationConfig: {
        responseMimeType: "application/json",
      },
    });
    expect(modelArgs.generationConfig).not.toHaveProperty("temperature");
  });
});
