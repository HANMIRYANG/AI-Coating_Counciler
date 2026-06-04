// Gemini provider adapter.
//
// Same contract as the OpenAI / Anthropic adapters: respects options.model
// for fallback-chain hops, propagates JsonParseError on bad JSON, and
// throws SchemaValidationError on Zod failure with the raw text attached.

import { ZodError } from "zod";
import type { AiProviderAdapter } from "../provider";
import type {
  CritiqueInput,
  InitialOpinionInput,
  ProviderCallOptions,
  SynthesisInput,
} from "../types";
import {
  CertificationChecklistFinalAnswerSchema,
  FinalAnswerSchema,
  IdeationFinalAnswerSchema,
  ProviderCritiqueSchema,
  ProviderOpinionSchema,
  type ProviderCritique,
  type ProviderOpinion,
  type SynthesisResult,
} from "../schemas";
import {
  buildChecklistSynthesisMessages,
  buildCritiqueMessages,
  buildIdeationSynthesisMessages,
  buildInitialOpinionMessages,
  buildSynthesisMessages,
  extractJsonObject,
  SchemaValidationError,
} from "../prompts";
import { DEFAULT_MODELS, enforceModelPolicy } from "../models";
import { markRateLimited } from "../rateLimiter";

export class GeminiProviderAdapter implements AiProviderAdapter {
  readonly id = "gemini" as const;
  readonly displayName = "Gemini (Google)";
  readonly model: string;

  constructor(
    model: string = process.env.GEMINI_PRIMARY_MODEL ??
      process.env.GEMINI_MODEL ??
      DEFAULT_MODELS.gemini.primary,
  ) {
    this.model = enforceModelPolicy("gemini", model);
  }

  private resolveModel(opts: ProviderCallOptions): string {
    return opts.model ?? this.model;
  }

  private async chatJson(
    system: string,
    user: string,
    opts: ProviderCallOptions,
  ): Promise<{ raw: string; parsed: unknown }> {
    const modelName = this.resolveModel(opts);
    const { GoogleGenerativeAI } = await import("@google/generative-ai");
    if (!process.env.GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY is not set");
    }
    const client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = client.getGenerativeModel({
      model: modelName,
      systemInstruction: system,
      generationConfig: {
        // Keep generation parameters minimal. Some model families reject
        // pinned sampling knobs; JSON output is enforced by MIME type.
        responseMimeType: "application/json",
      },
    });
    try {
      const resp = await model.generateContent(
        user,
        opts.abortSignal ? { signal: opts.abortSignal } : undefined,
      );
      const text = resp.response.text();
      return extractJsonObject(text);
    } catch (err) {
      throw translateGeminiError(err);
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
    if (input.taskType === "certification_checklist") {
      const { system, user } = buildChecklistSynthesisMessages(
        this.displayName,
        input,
      );
      const { raw, parsed } = await this.chatJson(system, user, options);
      return validateOrThrow(
        CertificationChecklistFinalAnswerSchema,
        parsed,
        raw,
      );
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

function translateGeminiError(err: unknown): unknown {
  const e = err as {
    status?: number;
    code?: number | string;
    message?: string;
  };
  const msg = e?.message ?? "";
  const isQuota =
    e?.status === 429 ||
    e?.code === 429 ||
    /quota|rate limit|RESOURCE_EXHAUSTED/i.test(msg);
  if (isQuota) {
    return markRateLimited("gemini", { message: "Gemini quota/rate limit" });
  }
  return err;
}
