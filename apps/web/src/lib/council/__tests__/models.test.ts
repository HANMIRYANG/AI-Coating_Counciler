import { describe, it, expect, afterEach } from "vitest";
import {
  enforceModelPolicy,
  ModelPolicyError,
  inferAccuracyMode,
  resolveModelChain,
  readChainFromEnv,
  DEFAULT_MODELS,
} from "../models";

afterEach(() => {
  // Per-role env keys are tunable per test; reset everything to avoid leaks.
  for (const k of [
    "OPENAI_PRIMARY_MODEL",
    "OPENAI_FALLBACK_MODEL",
    "OPENAI_FAST_FALLBACK_MODEL",
    "OPENAI_HIGH_ACCURACY_MODEL",
    "OPENAI_MODEL",
    "ANTHROPIC_PRIMARY_MODEL",
    "ANTHROPIC_FALLBACK_MODEL",
    "ANTHROPIC_FAST_FALLBACK_MODEL",
    "ANTHROPIC_HIGH_ACCURACY_MODEL",
    "ANTHROPIC_MODEL",
    "GEMINI_PRIMARY_MODEL",
    "GEMINI_FALLBACK_MODEL",
    "GEMINI_FAST_FALLBACK_MODEL",
    "GEMINI_HIGH_ACCURACY_MODEL",
    "GEMINI_MODEL",
  ]) {
    delete process.env[k];
  }
});

describe("enforceModelPolicy — substring-based rejection", () => {
  it("accepts pinned stable model names", () => {
    expect(enforceModelPolicy("openai", "gpt-5.5")).toBe("gpt-5.5");
    expect(enforceModelPolicy("openai", "gpt-5.4")).toBe("gpt-5.4");
    expect(enforceModelPolicy("openai", "gpt-5.4-mini")).toBe("gpt-5.4-mini");
    expect(enforceModelPolicy("anthropic", "claude-sonnet-4-6")).toBe(
      "claude-sonnet-4-6",
    );
    expect(enforceModelPolicy("anthropic", "claude-haiku-4-5")).toBe(
      "claude-haiku-4-5",
    );
    expect(enforceModelPolicy("gemini", "gemini-3.5-flash")).toBe(
      "gemini-3.5-flash",
    );
    expect(enforceModelPolicy("gemini", "gemini-2.5-pro")).toBe(
      "gemini-2.5-pro",
    );
  });

  it("rejects any name CONTAINING 'preview' (not just suffix)", () => {
    // Closes the loophole where a model like "gpt-preview-stable" would
    // sneak past suffix-only checks.
    expect(() =>
      enforceModelPolicy("openai", "gpt-preview-stable"),
    ).toThrow(ModelPolicyError);
    expect(() =>
      enforceModelPolicy("gemini", "gemini-3.1-pro-preview"),
    ).toThrow(ModelPolicyError);
    expect(() =>
      enforceModelPolicy("openai", "gpt-5.5-preview"),
    ).toThrow(ModelPolicyError);
  });

  it("rejects any name CONTAINING 'experimental' (not just suffix)", () => {
    expect(() =>
      enforceModelPolicy("anthropic", "claude-experimental-build"),
    ).toThrow(ModelPolicyError);
    expect(() =>
      enforceModelPolicy("openai", "gpt-experimental"),
    ).toThrow(ModelPolicyError);
  });

  it("rejects any name CONTAINING 'latest' by default", () => {
    expect(() =>
      enforceModelPolicy("gemini", "gemini-latest-pro"),
    ).toThrow(ModelPolicyError);
    expect(() =>
      enforceModelPolicy("anthropic", "claude-3-latest"),
    ).toThrow(ModelPolicyError);
    expect(() =>
      enforceModelPolicy("openai", "gpt-5.5-latest"),
    ).toThrow(ModelPolicyError);
  });

  it("allows preview only when allowPreview opt-in is set (experimental remains rejected)", () => {
    expect(
      enforceModelPolicy("gemini", "gemini-3-flash-preview", {
        allowPreview: true,
      }),
    ).toBe("gemini-3-flash-preview");
    expect(
      enforceModelPolicy("openai", "gpt-preview-stable", {
        allowPreview: true,
      }),
    ).toBe("gpt-preview-stable");
    // experimental still blocked
    expect(() =>
      enforceModelPolicy("openai", "gpt-experimental-stable", {
        allowPreview: true,
      }),
    ).toThrow(ModelPolicyError);
  });

  it("allows experimental only when allowExperimental opt-in is set (preview remains rejected)", () => {
    expect(
      enforceModelPolicy("openai", "gpt-experimental", {
        allowExperimental: true,
      }),
    ).toBe("gpt-experimental");
    expect(() =>
      enforceModelPolicy("openai", "gpt-5.5-preview", {
        allowExperimental: true,
      }),
    ).toThrow(ModelPolicyError);
  });

  it("allows '*-latest' ONLY when the dedicated allowLatest flag is set", () => {
    // allowPreview/allowExperimental do not unlock latest.
    expect(() =>
      enforceModelPolicy("openai", "gpt-5.5-latest", {
        allowPreview: true,
        allowExperimental: true,
      }),
    ).toThrow(ModelPolicyError);

    expect(
      enforceModelPolicy("gemini", "gemini-latest-pro", {
        allowLatest: true,
      }),
    ).toBe("gemini-latest-pro");
  });
});

describe("readChainFromEnv", () => {
  it("uses defaults when no env is set", () => {
    const c = readChainFromEnv("openai");
    expect(c).toEqual(DEFAULT_MODELS.openai);
  });

  it("per-role envs override individual roles", () => {
    process.env.OPENAI_PRIMARY_MODEL = "gpt-5.5";
    process.env.OPENAI_FALLBACK_MODEL = "gpt-5.4";
    process.env.OPENAI_FAST_FALLBACK_MODEL = "gpt-5.4-mini";
    process.env.OPENAI_HIGH_ACCURACY_MODEL = "gpt-5.5";
    expect(readChainFromEnv("openai")).toEqual({
      primary: "gpt-5.5",
      fallback: "gpt-5.4",
      fastFallback: "gpt-5.4-mini",
      highAccuracy: "gpt-5.5",
    });
  });

  it("legacy OPENAI_MODEL only overrides primary, not highAccuracy/fallback/fastFallback", () => {
    process.env.OPENAI_MODEL = "gpt-custom-primary";
    const c = readChainFromEnv("openai");
    expect(c.primary).toBe("gpt-custom-primary");
    expect(c.fallback).toBe(DEFAULT_MODELS.openai.fallback);
    expect(c.fastFallback).toBe(DEFAULT_MODELS.openai.fastFallback);
    expect(c.highAccuracy).toBe(DEFAULT_MODELS.openai.highAccuracy);
  });

  it("OPENAI_PRIMARY_MODEL wins over the legacy OPENAI_MODEL", () => {
    process.env.OPENAI_MODEL = "gpt-legacy";
    process.env.OPENAI_PRIMARY_MODEL = "gpt-new";
    expect(readChainFromEnv("openai").primary).toBe("gpt-new");
  });
});

describe("resolveModelChain", () => {
  it("default mode walks [primary, fallback, fastFallback] when fallback is defined", () => {
    const chain = resolveModelChain("openai", "default", {
      allowPreview: false,
      allowExperimental: false,
    });
    expect(chain).toEqual([
      DEFAULT_MODELS.openai.primary,
      DEFAULT_MODELS.openai.fallback!,
      DEFAULT_MODELS.openai.fastFallback,
    ]);
  });

  it("default mode walks [primary, fastFallback] when fallback is undefined", () => {
    const chain = resolveModelChain("anthropic", "default");
    expect(chain).toEqual([
      DEFAULT_MODELS.anthropic.primary,
      DEFAULT_MODELS.anthropic.fastFallback,
    ]);
  });

  it("high_accuracy mode walks [highAccuracy, primary, fallback?, fastFallback]", () => {
    const chain = resolveModelChain("anthropic", "high_accuracy");
    expect(chain).toEqual([
      DEFAULT_MODELS.anthropic.highAccuracy,
      DEFAULT_MODELS.anthropic.primary,
      DEFAULT_MODELS.anthropic.fastFallback,
    ]);
  });

  it("high_accuracy with OpenAI deduplicates primary===highAccuracy", () => {
    // OpenAI default keeps primary === highAccuracy ('gpt-5.5'), so dedup
    // should collapse the duplicate hop.
    const chain = resolveModelChain("openai", "high_accuracy");
    expect(chain).toEqual([
      DEFAULT_MODELS.openai.primary,
      DEFAULT_MODELS.openai.fallback!,
      DEFAULT_MODELS.openai.fastFallback,
    ]);
  });

  it("legacy OPENAI_MODEL primary override does NOT poison high_accuracy head", () => {
    process.env.ANTHROPIC_MODEL = "claude-test-override";
    const chain = resolveModelChain("anthropic", "high_accuracy");
    // High-accuracy head must remain claude-opus-4-7, not the legacy primary.
    expect(chain[0]).toBe(DEFAULT_MODELS.anthropic.highAccuracy);
    // The override appears later in the chain (as primary), not first.
    expect(chain).toContain("claude-test-override");
    expect(chain.indexOf("claude-test-override")).toBeGreaterThan(0);
  });
});

describe("inferAccuracyMode", () => {
  it("escalates on fire/cert keywords", () => {
    expect(
      inferAccuracyMode("배터리 화재 방지 가능합니까?", "technical_review"),
    ).toBe("high_accuracy");
    expect(
      inferAccuracyMode("UL 94 V-0 등급 인증 자료 정리해줘", "technical_review"),
    ).toBe("high_accuracy");
  });

  it("escalates for high-risk task types regardless of prompt", () => {
    expect(
      inferAccuracyMode("내부 검토 의견 정리", "certification_checklist"),
    ).toBe("high_accuracy");
  });

  it("stays in default mode for benign prompts", () => {
    expect(
      inferAccuracyMode("도료 색상 견본을 정리해주세요", "customer_reply"),
    ).toBe("default");
  });
});

describe("inferAccuracyMode", () => {
  it("escalates on fire/cert keywords", () => {
    expect(
      inferAccuracyMode("배터리 화재 방지 가능합니까?", "technical_review"),
    ).toBe("high_accuracy");
    expect(
      inferAccuracyMode("UL 94 V-0 등급 인증 자료 정리해줘", "technical_review"),
    ).toBe("high_accuracy");
  });

  it("escalates for high-risk task types regardless of prompt", () => {
    expect(
      inferAccuracyMode("내부 검토 의견 정리", "certification_checklist"),
    ).toBe("high_accuracy");
  });

  it("stays in default mode for benign prompts", () => {
    expect(
      inferAccuracyMode("도료 색상 견본을 정리해주세요", "customer_reply"),
    ).toBe("default");
  });
});
