// Model policy.
//
// This project is designed for FREQUENT production use against external AI
// APIs. Preview / experimental / `*-latest` aliases drift, change behavior,
// and surprise users. We therefore:
//
//   1. Maintain a pinned model for each role per provider:
//      - primary       — default workhorse
//      - fallback      — optional middle hop (used between primary and fast
//                        fallback when 429 / quota pressure hits)
//      - fastFallback  — cheapest / fastest model to keep the council moving
//      - highAccuracy  — reserved for high-risk coating prompts
//   2. `resolveModelChain` returns the walk order:
//        default:        [primary, fallback?, fastFallback]
//        high_accuracy:  [highAccuracy, primary, fallback?, fastFallback]
//      Dedup preserves order; the high-accuracy head is NEVER overridden by
//      a legacy primary env var.
//   3. Reject any model name containing "preview", "experimental", or
//      "latest" unless the operator explicitly opts in.
//
// Per-role env overrides (recommended):
//   OPENAI_PRIMARY_MODEL / OPENAI_FALLBACK_MODEL /
//   OPENAI_FAST_FALLBACK_MODEL / OPENAI_HIGH_ACCURACY_MODEL
//   (and the analogous ANTHROPIC_*, GEMINI_* keys)
//
// Legacy env vars (backward-compatible primary-only override):
//   OPENAI_MODEL / ANTHROPIC_MODEL / GEMINI_MODEL
//   These ONLY affect `primary`. They never override `highAccuracy`,
//   `fallback`, or `fastFallback`.

import type { ProviderId, TaskType } from "./types";

export type AccuracyMode = "default" | "high_accuracy";

export type ModelChain = {
  primary: string;
  /** Optional middle hop. Set when a provider has a stable mid-tier model. */
  fallback?: string;
  fastFallback: string;
  highAccuracy: string;
};

// ─── Pinned production defaults ────────────────────────────────────────
// Update this map (and bump deploy version) to roll forward to a new model.
// Never reference "-preview", "-experimental", or "-latest" here.
export const DEFAULT_MODELS: Record<ProviderId, ModelChain> = {
  openai: {
    primary: "gpt-5.5",
    fallback: "gpt-5.4",
    fastFallback: "gpt-5.4-mini",
    highAccuracy: "gpt-5.5",
  },
  anthropic: {
    primary: "claude-sonnet-4-6",
    fastFallback: "claude-haiku-4-5",
    highAccuracy: "claude-opus-4-7",
  },
  gemini: {
    primary: "gemini-3.5-flash",
    fastFallback: "gemini-2.5-flash",
    highAccuracy: "gemini-2.5-pro",
  },
};

// ─── Validation ────────────────────────────────────────────────────────

export class ModelPolicyError extends Error {
  constructor(message: string, public providerId?: ProviderId) {
    super(message);
    this.name = "ModelPolicyError";
  }
}

export type ModelPolicyOptions = {
  allowPreview?: boolean;
  allowExperimental?: boolean;
  /**
   * `*-latest` style moving aliases drift silently and break reproducibility.
   * Default policy: REJECT unless this flag is explicitly true. The flag is
   * supported for operators who knowingly accept the drift risk; we
   * recommend leaving it unset.
   */
  allowLatest?: boolean;
};

export function readModelPolicyOptionsFromEnv(): ModelPolicyOptions {
  return {
    allowPreview:
      (process.env.ALLOW_PREVIEW_MODELS ?? "false").toLowerCase() === "true",
    allowExperimental:
      (process.env.ALLOW_EXPERIMENTAL_MODELS ?? "false").toLowerCase() ===
      "true",
    allowLatest:
      (process.env.ALLOW_LATEST_MODELS ?? "false").toLowerCase() === "true",
  };
}

/**
 * Substring-style enforcement:
 *
 *   - any name containing "preview"      → rejected unless allowPreview
 *   - any name containing "experimental" → rejected unless allowExperimental
 *   - any name containing "latest"       → rejected unless allowLatest
 *
 * Substring (not suffix) matching closes loopholes like `gpt-preview-stable`,
 * `gemini-latest-pro`, `claude-experimental-build` — names that are still
 * unpinned but evade suffix-only checks.
 *
 * Returns the model name unchanged on success so the caller can inline it.
 */
export function enforceModelPolicy(
  providerId: ProviderId,
  model: string,
  opts: ModelPolicyOptions = readModelPolicyOptionsFromEnv(),
): string {
  const containsPreview = /preview/i.test(model);
  const containsExperimental = /experimental/i.test(model);
  const containsLatest = /latest/i.test(model);

  if (containsLatest && !opts.allowLatest) {
    throw new ModelPolicyError(
      `Model "${model}" uses a moving "latest" alias; pin to a versioned name (or set ALLOW_LATEST_MODELS=true to override, NOT recommended).`,
      providerId,
    );
  }
  if (containsPreview && !opts.allowPreview) {
    throw new ModelPolicyError(
      `Model "${model}" is a preview build. Set ALLOW_PREVIEW_MODELS=true to opt in (not recommended for production).`,
      providerId,
    );
  }
  if (containsExperimental && !opts.allowExperimental) {
    throw new ModelPolicyError(
      `Model "${model}" is an experimental build. Set ALLOW_EXPERIMENTAL_MODELS=true to opt in (not recommended for production).`,
      providerId,
    );
  }
  return model;
}

// ─── Per-role env resolution ───────────────────────────────────────────

function envValue(key: string): string | undefined {
  const v = process.env[key];
  return v && v.trim() ? v.trim() : undefined;
}

function envPrefix(providerId: ProviderId): string {
  return providerId.toUpperCase();
}

/**
 * Read the full ModelChain from env, applying these precedence rules:
 *   - primary       = {PREFIX}_PRIMARY_MODEL  > legacy {PREFIX}_MODEL  > default
 *   - fallback      = {PREFIX}_FALLBACK_MODEL > default (may be undefined)
 *   - fastFallback  = {PREFIX}_FAST_FALLBACK_MODEL > default
 *   - highAccuracy  = {PREFIX}_HIGH_ACCURACY_MODEL > default
 *
 * Crucially: the legacy `{PREFIX}_MODEL` env affects ONLY `primary`. It
 * never poisons `highAccuracy`, `fallback`, or `fastFallback`.
 */
export function readChainFromEnv(providerId: ProviderId): ModelChain {
  const defaults = DEFAULT_MODELS[providerId];
  const p = envPrefix(providerId);
  return {
    primary:
      envValue(`${p}_PRIMARY_MODEL`) ??
      envValue(`${p}_MODEL`) ??
      defaults.primary,
    fallback: envValue(`${p}_FALLBACK_MODEL`) ?? defaults.fallback,
    fastFallback:
      envValue(`${p}_FAST_FALLBACK_MODEL`) ?? defaults.fastFallback,
    highAccuracy:
      envValue(`${p}_HIGH_ACCURACY_MODEL`) ?? defaults.highAccuracy,
  };
}

// ─── Chain resolution ──────────────────────────────────────────────────

/**
 * Resolve the ordered walk of models for a single provider call.
 *
 *   default:        [primary, fallback?, fastFallback]
 *   high_accuracy:  [highAccuracy, primary, fallback?, fastFallback]
 *
 * Dedup preserves order (so e.g. OpenAI where `highAccuracy === primary`
 * collapses to a single head). Every model in the chain is validated by
 * `enforceModelPolicy`.
 */
export function resolveModelChain(
  providerId: ProviderId,
  mode: AccuracyMode = "default",
  opts: ModelPolicyOptions = readModelPolicyOptionsFromEnv(),
): string[] {
  const chain = readChainFromEnv(providerId);

  const order: Array<string | undefined> =
    mode === "high_accuracy"
      ? [chain.highAccuracy, chain.primary, chain.fallback, chain.fastFallback]
      : [chain.primary, chain.fallback, chain.fastFallback];

  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const m of order) {
    if (m && !seen.has(m)) {
      seen.add(m);
      ordered.push(m);
    }
  }
  return ordered.map((m) => enforceModelPolicy(providerId, m, opts));
}

// ─── High-accuracy routing ─────────────────────────────────────────────

// Keywords are matched case-insensitively (after toLowerCase on both sides).
// Korean script is unaffected by toLowerCase; ASCII tokens like "ul 94" or
// "msds" must therefore be stored lowercase here.
const HIGH_RISK_KEYWORDS: string[] = [
  // Korean — coating / fire / cert / safety / regulatory domain
  "불연",
  "난연",
  "화재",
  "방염",
  "내화",
  "폭발",
  "열폭주",
  "배터리",
  "리튬",
  "인증",
  "법령",
  "법적",
  "광고",
  "식품",
  "위생",

  // ASCII-tagged Korean references (lowercased for case-insensitive contains)
  "ks f",
  "ul 94",
  "un 38.3",
  "msds",
  "sds",
  "tds",

  // English — same risk categories, expanded for non-Korean prompts.
  "fire prevention",
  "flame retardant",
  "flame retardancy",
  "fire resistant",
  "fire resistance",
  "fire-resistant",
  "battery fire",
  "thermal runaway",
  "explosion",
  "explosive",
  "certification",
  "certified",
  "legal compliance",
  "regulatory compliance",
  "warranty",
  "guaranteed performance",
  "guaranteed",
  "performance claim",
  "performance claims",
  "performance guarantee",
];

const HIGH_RISK_TASK_TYPES: TaskType[] = [
  "risky_phrase_review",
  "certification_checklist",
];

/**
 * Decide whether a prompt should route to the high-accuracy model.
 * Conservative: any high-risk keyword OR a high-risk taskType triggers
 * escalation. Matching is case-insensitive — both prompt and keywords are
 * lowercased before `includes` so prompts in English ("Battery Fire",
 * "Flame retardant", "WARRANTY") all escalate.
 */
export function inferAccuracyMode(
  userPrompt: string,
  taskType: TaskType,
): AccuracyMode {
  if (HIGH_RISK_TASK_TYPES.includes(taskType)) return "high_accuracy";
  const lcPrompt = userPrompt.toLowerCase();
  const hit = HIGH_RISK_KEYWORDS.some((k) => lcPrompt.includes(k));
  return hit ? "high_accuracy" : "default";
}
