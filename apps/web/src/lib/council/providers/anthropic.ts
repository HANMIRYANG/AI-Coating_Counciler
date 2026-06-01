// Anthropic (Claude) provider adapter.
//
// Same contract as the OpenAI adapter (see openai.ts comments): respects
// options.model for fallback-chain hops, propagates JsonParseError on bad
// JSON, and throws SchemaValidationError on Zod failure with the raw text
// attached.

import { ZodError } from "zod";
import type { AiProviderAdapter } from "../provider";
import type {
  CritiqueInput,
  InitialOpinionInput,
  ProviderCallOptions,
  SynthesisInput,
} from "../types";
import {
  FinalAnswerSchema,
  IdeationFinalAnswerSchema,
  ProviderCritiqueSchema,
  ProviderOpinionSchema,
  type ProviderCritique,
  type ProviderOpinion,
  type SynthesisResult,
} from "../schemas";
import {
  buildCritiqueMessages,
  buildIdeationSynthesisMessages,
  buildInitialOpinionMessages,
  buildSynthesisMessages,
  extractJsonObject,
  SchemaValidationError,
} from "../prompts";
import { DEFAULT_MODELS, enforceModelPolicy } from "../models";
import { markRateLimited } from "../rateLimiter";

export class AnthropicProviderAdapter implements AiProviderAdapter {
  readonly id = "anthropic" as const;
  readonly displayName = "Claude (Anthropic)";
  readonly model: string;

  constructor(
    model: string = process.env.ANTHROPIC_PRIMARY_MODEL ??
      process.env.ANTHROPIC_MODEL ??
      DEFAULT_MODELS.anthropic.primary,
  ) {
    this.model = enforceModelPolicy("anthropic", model);
  }

  private resolveModel(opts: ProviderCallOptions): string {
    return opts.model ?? this.model;
  }

  private async messageJson(
    system: string,
    user: string,
    opts: ProviderCallOptions,
  ): Promise<{ raw: string; parsed: unknown }> {
    const model = this.resolveModel(opts);
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    try {
      const resp = await client.messages.create(
        {
          model,
          system,
          max_tokens: 2048,
          temperature: 0.2,
          messages: [{ role: "user", content: user }],
        },
        { signal: opts.abortSignal },
      );
      const block = resp.content?.[0];
      const text =
        block && "text" in block ? (block as { text: string }).text : "";
      return extractJsonObject(text);
    } catch (err) {
      throw translateAnthropicError(err);
    }
  }

  async generateInitialOpinion(
    input: InitialOpinionInput,
    options: ProviderCallOptions,
  ): Promise<ProviderOpinion> {
    const { system, user } = buildInitialOpinionMessages(this.displayName, input);
    const model = this.resolveModel(options);
    const { raw, parsed } = await this.messageJson(system, user, options);
    return validateOrThrow(
      ProviderOpinionSchema,
      { ...((parsed as object) ?? {}), providerId: this.id, model },
      raw,
    );
  }

  async generateCritique(
    input: CritiqueInput,
    options: ProviderCallOptions,
  ): Promise<ProviderCritique> {
    const { system, user } = buildCritiqueMessages(this.displayName, input);
    const model = this.resolveModel(options);
    const { raw, parsed } = await this.messageJson(system, user, options);
    return validateOrThrow(
      ProviderCritiqueSchema,
      { ...((parsed as object) ?? {}), providerId: this.id, model },
      raw,
    );
  }

  async generateSynthesis(
    input: SynthesisInput,
    options: ProviderCallOptions,
  ): Promise<SynthesisResult> {
    // Ideation mode (docs/23) produces a distinct synthesis shape.
    if (input.taskType === "application_ideas") {
      const { system, user } = buildIdeationSynthesisMessages(
        this.displayName,
        input,
      );
      const { raw, parsed } = await this.messageJson(system, user, options);
      return validateOrThrow(IdeationFinalAnswerSchema, parsed, raw);
    }
    const { system, user } = buildSynthesisMessages(this.displayName, input);
    const { raw, parsed } = await this.messageJson(system, user, options);
    return validateOrThrow(FinalAnswerSchema, parsed, raw);
  }
}

function validateOrThrow<T>(
  schema: { parse: (x: unknown) => T },
  parsed: unknown,
  raw: string,
): T {
  try {
    return schema.parse(parsed);
  } catch (err) {
    if (err instanceof ZodError) {
      throw new SchemaValidationError(
        err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
        raw,
        parsed,
        err,
      );
    }
    throw err;
  }
}

function translateAnthropicError(err: unknown): unknown {
  const e = err as { status?: number; headers?: Record<string, string> };
  if (e?.status === 429) {
    const retryAfterRaw =
      e.headers?.["retry-after"] ?? e.headers?.["Retry-After"];
    const retryAfterMs = retryAfterRaw
      ? Math.round(Number(retryAfterRaw) * 1000)
      : undefined;
    return markRateLimited("anthropic", {
      retryAfterMs: Number.isFinite(retryAfterMs!) ? retryAfterMs : undefined,
      message: "Anthropic 429 rate limit",
    });
  }
  return err;
}
