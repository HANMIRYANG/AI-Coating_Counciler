// OpenAI (GPT) provider adapter — skeleton.
//
// Honors:
//   - options.abortSignal → real socket cancel on timeout.
//   - options.model → respects the orchestrator's fallback-chain hop. The
//     constructor-supplied default is only used when no per-call model is
//     specified.
//
// Validation:
//   - extractJsonObject() throws JsonParseError on bad JSON; we let it
//     propagate so the orchestrator records schema_invalid with raw text.
//   - On Zod failure we throw SchemaValidationError(raw, parsed) so both the
//     raw text AND the partially-parsed JSON are recorded.
//
// Set USE_MOCK_PROVIDERS=false in `.env` and provide OPENAI_API_KEY to use.

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

export class OpenAiProviderAdapter implements AiProviderAdapter {
  readonly id = "openai" as const;
  readonly displayName = "GPT (OpenAI)";
  readonly model: string;

  constructor(
    model: string = process.env.OPENAI_PRIMARY_MODEL ??
      process.env.OPENAI_MODEL ??
      DEFAULT_MODELS.openai.primary,
  ) {
    this.model = enforceModelPolicy("openai", model);
  }

  private resolveModel(opts: ProviderCallOptions): string {
    return opts.model ?? this.model;
  }

  private async chatJson(
    system: string,
    user: string,
    opts: ProviderCallOptions,
  ): Promise<{ raw: string; parsed: unknown }> {
    const model = this.resolveModel(opts);
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    try {
      const resp = await client.chat.completions.create(
        {
          model,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          response_format: { type: "json_object" },
          temperature: 0.2,
        },
        { signal: opts.abortSignal },
      );
      const text = resp.choices?.[0]?.message?.content ?? "";
      return extractJsonObject(text);
    } catch (err) {
      throw translateOpenAiError(err);
    }
  }

  async generateInitialOpinion(
    input: InitialOpinionInput,
    options: ProviderCallOptions,
  ): Promise<ProviderOpinion> {
    const { system, user } = buildInitialOpinionMessages(this.displayName, input);
    const model = this.resolveModel(options);
    const { raw, parsed } = await this.chatJson(system, user, options);
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
    const { raw, parsed } = await this.chatJson(system, user, options);
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
      const { raw, parsed } = await this.chatJson(system, user, options);
      return validateOrThrow(IdeationFinalAnswerSchema, parsed, raw);
    }
    const { system, user } = buildSynthesisMessages(this.displayName, input);
    const { raw, parsed } = await this.chatJson(system, user, options);
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

function translateOpenAiError(err: unknown): unknown {
  const e = err as { status?: number; headers?: Record<string, string> };
  if (e?.status === 429) {
    const retryAfterRaw =
      e.headers?.["retry-after"] ?? e.headers?.["Retry-After"];
    const retryAfterMs = retryAfterRaw
      ? Math.round(Number(retryAfterRaw) * 1000)
      : undefined;
    return markRateLimited("openai", {
      retryAfterMs: Number.isFinite(retryAfterMs!) ? retryAfterMs : undefined,
      message: "OpenAI 429 rate limit",
    });
  }
  return err;
}
