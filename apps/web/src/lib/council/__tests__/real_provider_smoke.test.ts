// Real-provider smoke tests — OPT-IN.
//
// These tests make live API calls and cost real money. They run ONLY when
// `REAL_PROVIDER_SMOKE=true` is set in the environment. Per-provider tests
// additionally skip when the corresponding API key is not present.
//
// Run locally with:
//   REAL_PROVIDER_SMOKE=true OPENAI_API_KEY=... npm test --workspace apps/web
//
// What we validate (without burning many tokens):
//   1. The model policy accepts the configured chain head.
//   2. The adapter either returns schema-valid JSON OR throws
//      SchemaValidationError cleanly (no infinite hangs, no uncategorized
//      crashes).
//   3. AbortSignal plumbing actually closes a connection (no hang).
//
// On a CI host without API keys, every per-provider test is skipped with a
// clear reason printed.

import { describe, it, expect } from "vitest";
import { OpenAiProviderAdapter } from "../providers/openai";
import { AnthropicProviderAdapter } from "../providers/anthropic";
import { GeminiProviderAdapter } from "../providers/gemini";
import { resolveModelChain, enforceModelPolicy } from "../models";
import { SchemaValidationError, JsonParseError } from "../prompts";
import { TimeoutError, withTimeout } from "../timeout";
import type { InitialOpinionInput, ProviderCallOptions } from "../types";

const SMOKE_ENABLED = process.env.REAL_PROVIDER_SMOKE === "true";

const INPUT: InitialOpinionInput = {
  userPrompt:
    "테스트용 짧은 입력입니다. summary 한 줄과 confidenceScore만 채워 응답해주세요.",
  taskType: "technical_review",
  evidenceMode: "ai_only",
  domainSafetyPolicySummary: "테스트.",
};

function callOpts(model: string, signal: AbortSignal): ProviderCallOptions {
  return {
    timeoutMs: 30_000,
    retryCount: 0,
    abortSignal: signal,
    sessionId: "smoke",
    round: "initial",
    model,
  };
}

describe("Real provider smoke runner status", () => {
  it("reports whether REAL_PROVIDER_SMOKE is enabled (informational)", () => {
    // Always passes; surfaces the toggle in CI logs.
    expect(
      ["true", "false", undefined].includes(process.env.REAL_PROVIDER_SMOKE),
    ).toBe(true);
  });
});

describe.skipIf(!SMOKE_ENABLED)("Real provider smoke (opt-in)", () => {
  describe.skipIf(!process.env.OPENAI_API_KEY)("OpenAI", () => {
    it("model chain is policy-accepted", () => {
      const chain = resolveModelChain("openai", "default");
      expect(chain.length).toBeGreaterThan(0);
      for (const m of chain) expect(enforceModelPolicy("openai", m)).toBe(m);
    });

    it(
      "returns schema-valid JSON or schema_invalid cleanly",
      async () => {
        const adapter = new OpenAiProviderAdapter();
        const chain = resolveModelChain("openai", "default");
        const controller = new AbortController();
        try {
          const opinion = await adapter.generateInitialOpinion(
            INPUT,
            callOpts(chain[0], controller.signal),
          );
          expect(opinion.summary).toBeTruthy();
        } catch (err) {
          // Acceptable failure modes that the orchestrator handles:
          expect(
            err instanceof SchemaValidationError ||
              err instanceof JsonParseError ||
              err instanceof TimeoutError,
          ).toBe(true);
        }
      },
      45_000,
    );

    it(
      "respects abort signal (does not hang past withTimeout deadline)",
      async () => {
        const adapter = new OpenAiProviderAdapter();
        const chain = resolveModelChain("openai", "default");
        const controller = new AbortController();
        const t0 = Date.now();
        await expect(
          withTimeout(
            () =>
              adapter.generateInitialOpinion(
                INPUT,
                callOpts(chain[0], controller.signal),
              ),
            { timeoutMs: 50, abortController: controller },
          ),
        ).rejects.toBeDefined();
        expect(Date.now() - t0).toBeLessThan(2_000);
      },
      10_000,
    );
  });

  describe.skipIf(!process.env.ANTHROPIC_API_KEY)("Anthropic", () => {
    it("model chain is policy-accepted", () => {
      const chain = resolveModelChain("anthropic", "default");
      expect(chain.length).toBeGreaterThan(0);
      for (const m of chain) expect(enforceModelPolicy("anthropic", m)).toBe(m);
    });

    it(
      "returns schema-valid JSON or schema_invalid cleanly",
      async () => {
        const adapter = new AnthropicProviderAdapter();
        const chain = resolveModelChain("anthropic", "default");
        const controller = new AbortController();
        try {
          const opinion = await adapter.generateInitialOpinion(
            INPUT,
            callOpts(chain[0], controller.signal),
          );
          expect(opinion.summary).toBeTruthy();
        } catch (err) {
          expect(
            err instanceof SchemaValidationError ||
              err instanceof JsonParseError ||
              err instanceof TimeoutError,
          ).toBe(true);
        }
      },
      45_000,
    );

    it(
      "respects abort signal",
      async () => {
        const adapter = new AnthropicProviderAdapter();
        const chain = resolveModelChain("anthropic", "default");
        const controller = new AbortController();
        const t0 = Date.now();
        await expect(
          withTimeout(
            () =>
              adapter.generateInitialOpinion(
                INPUT,
                callOpts(chain[0], controller.signal),
              ),
            { timeoutMs: 50, abortController: controller },
          ),
        ).rejects.toBeDefined();
        expect(Date.now() - t0).toBeLessThan(2_000);
      },
      10_000,
    );
  });

  describe.skipIf(!process.env.GEMINI_API_KEY)("Gemini", () => {
    it("model chain is policy-accepted", () => {
      const chain = resolveModelChain("gemini", "default");
      expect(chain.length).toBeGreaterThan(0);
      for (const m of chain) expect(enforceModelPolicy("gemini", m)).toBe(m);
    });

    it(
      "returns schema-valid JSON or schema_invalid cleanly",
      async () => {
        const adapter = new GeminiProviderAdapter();
        const chain = resolveModelChain("gemini", "default");
        const controller = new AbortController();
        try {
          const opinion = await adapter.generateInitialOpinion(
            INPUT,
            callOpts(chain[0], controller.signal),
          );
          expect(opinion.summary).toBeTruthy();
        } catch (err) {
          expect(
            err instanceof SchemaValidationError ||
              err instanceof JsonParseError ||
              err instanceof TimeoutError,
          ).toBe(true);
        }
      },
      45_000,
    );
  });
});
