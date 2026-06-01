// Round-based council orchestrator.
//
// Responsibilities:
//   - Persist session state through every state transition.
//   - Run providers IN PARALLEL inside a round (Promise.allSettled).
//   - Enforce per-provider, per-round, AND per-session deadlines.
//   - Tolerate partial provider failures (>=2 → proceed; ==1 → limited; ==0 → fail).
//   - Validate every provider output with Zod before storing.
//   - Detect dangerous Korean phrasing in the synthesized answer and elevate
//     riskLevel accordingly.
//
// Deadline policy (Fix 1):
//   `sessionDeadline = createdAt + SESSION_TIMEOUT_MS` is fixed for the whole
//   run. Each round computes `roundDeadline = min(now + ROUND_TIMEOUT_MS,
//   sessionDeadline)`. Each provider attempt picks an effective timeout =
//   min(PROVIDER_TIMEOUT_MS, round-remaining, session-remaining). Retries
//   and synthesis hops both consult the same budget and bail early when no
//   time is left. If the session deadline elapses, the session is marked
//   `timed_out` (not `failed`) so the UI / log can distinguish the cause.

import { ZodError } from "zod";
import type { AiProviderAdapter } from "./provider";
import type { ProviderRegistry } from "./providers";
import { PROVIDER_IDS } from "./providers";
import {
  type FinalAnswer,
  FinalAnswerSchema,
  type IdeationFinalAnswer,
  IdeationFinalAnswerSchema,
  type ProviderCritique,
  type ProviderOpinion,
  type SynthesisResult,
} from "./schemas";
import {
  computeRiskLevel,
  detectUnsafePhrases,
  DOMAIN_SAFETY_POLICY_SUMMARY,
  FINAL_ANSWER_DISCLAIMER_KO,
  UNSAFE_PHRASES_KO,
  type UnsafePhraseFinding,
} from "./safety";
import { getSessionStore, type SessionRecord } from "./store";
import { TimeoutError, withTimeout } from "./timeout";
import type {
  CritiqueInput,
  InitialOpinionInput,
  NormalizedProviderError,
  ProviderCallOptions,
  ProviderId,
  ProviderStatus,
  RoundKey,
  SessionStatus,
  SynthesisInput,
} from "./types";
import {
  inferAccuracyMode,
  ModelPolicyError,
  resolveModelChain,
  type AccuracyMode,
} from "./models";
import {
  getRateLimiter,
  isRateLimitedError,
  type RateLimitedError,
} from "./rateLimiter";
import { JsonParseError, SchemaValidationError } from "./prompts";
import { EvidenceBundleService } from "@/lib/documents/evidence-bundle";
import { DocumentServiceError } from "@/lib/documents/service";
import {
  evidencePreviewTimeoutMs,
  failedPreview,
  notRequestedPreview,
  previewFromBundle,
  unavailablePreview,
  type SessionEvidencePreview,
} from "./evidencePreview";
import { applyEvidenceUsage } from "./evidenceUsage";

export type TimingConfig = {
  providerTimeoutMs: number;
  roundTimeoutMs: number;
  synthesisTimeoutMs: number;
  sessionTimeoutMs: number;
  maxRetries: number;
  minOpinionsForMeeting: number;
  minCritiquesForSynthesis: number;
};

export function defaultTimingConfig(): TimingConfig {
  const n = (k: string, d: number) => {
    const raw = process.env[k];
    const v = raw === undefined ? d : Number(raw);
    return Number.isFinite(v) ? v : d;
  };
  return {
    providerTimeoutMs: n("PROVIDER_TIMEOUT_MS", 90_000),
    roundTimeoutMs: n("ROUND_TIMEOUT_MS", 120_000),
    synthesisTimeoutMs: n("SYNTHESIS_TIMEOUT_MS", 90_000),
    sessionTimeoutMs: n("SESSION_TIMEOUT_MS", 240_000),
    maxRetries: n("MAX_PROVIDER_RETRIES", 1),
    minOpinionsForMeeting: n("MIN_INITIAL_OPINIONS_FOR_MEETING", 2),
    minCritiquesForSynthesis: n("MIN_CRITIQUES_FOR_SYNTHESIS", 2),
  };
}

// Minimum time a hop needs to make any progress. Below this we bail to
// fallback/failure rather than dispatching a near-zero timeout.
const MIN_HOP_BUDGET_MS = 250;

type RunResult<T> =
  | { ok: true; value: T; latencyMs: number }
  | {
      ok: false;
      error: NormalizedProviderError;
      latencyMs: number;
      status: ProviderStatus;
    };

export class CouncilOrchestrator {
  constructor(
    private readonly providers: ProviderRegistry,
    private readonly cfg: TimingConfig = defaultTimingConfig(),
    private readonly store = getSessionStore(),
    // Optional injection point for the evidence preflight. Left undefined in
    // production: it is lazily constructed only when a non-ai_only session
    // actually needs it, so the ai_only path never touches the documents /
    // Prisma layer. Tests pass a stub to avoid a real database.
    private readonly evidenceService?: EvidenceBundleService,
  ) {}

  /**
   * Drive a session to completion. Designed to be invoked in the background
   * (no `await` from the API route). Never throws — failures are persisted
   * on the session record.
   */
  async run(sessionId: string): Promise<void> {
    try {
      await this.transition(sessionId, "preparing");
      const sess = await this.store.get(sessionId);
      if (!sess) return;

      // Internal evidence retrieval preflight (Step 7). Bounded + timeout-
      // safe. For ai_only it is a no-op (`not_requested`); otherwise it runs
      // the internal evidence bundle once and records status. It NEVER
      // fails the session — any error is captured in the preview and the
      // council proceeds. Candidates are NOT yet injected into prompts.
      const evidencePreview = await this.runEvidencePreflight(sess);
      await this.store.update(sessionId, { evidencePreview });

      // Read-only evidence context passed into every round's prompt (Step 8).
      // ai_only stays undefined → prompts are byte-for-byte unchanged. The
      // preview is computed ONCE here and reused across all three rounds —
      // retrieval is never re-run per round.
      const evidenceContext =
        sess.evidenceMode === "ai_only" ? undefined : evidencePreview;

      // Single fixed point of reference for the whole session.
      const sessionDeadline = sess.deadlineAt;

      // High-accuracy routing for high-risk coating prompts.
      const accuracyMode: AccuracyMode = inferAccuracyMode(
        sess.userPrompt,
        sess.taskType,
      );

      // ─── Round 1: Independent opinions ───────────────────────────────
      if (this.isPastDeadline(sessionDeadline)) {
        await this.markTimedOut(sessionId, "session deadline exceeded before Round 1");
        return;
      }
      await this.transition(sessionId, "round1_running", "initial");

      const opinionInput: InitialOpinionInput = {
        userPrompt: sess.userPrompt,
        taskType: sess.taskType,
        evidenceMode: sess.evidenceMode,
        domainSafetyPolicySummary: DOMAIN_SAFETY_POLICY_SUMMARY,
        evidenceContext,
      };

      const r1 = await this.runRound<ProviderOpinion>({
        sessionId,
        round: "initial",
        accuracyMode,
        call: (p, opts) => p.generateInitialOpinion(opinionInput, opts),
        onSuccess: (op) => this.store.appendOpinion(sessionId, op),
        sessionDeadline,
      });

      const r1ok = r1.successes.length;
      if (r1ok === 3) await this.transition(sessionId, "round1_completed");
      else if (r1ok === 2) await this.transition(sessionId, "round1_partial");
      else if (r1ok === 1) await this.transition(sessionId, "round1_limited");
      else {
        await this.transition(sessionId, "failed", undefined, {
          errorMessage: "Round 1: 모든 Provider 호출 실패",
          completedAt: Date.now(),
        });
        return;
      }

      // ─── Round 2: Cross critique ────────────────────────────────────
      if (this.isPastDeadline(sessionDeadline)) {
        await this.markTimedOut(sessionId, "session deadline exceeded before Round 2");
        return;
      }
      await this.transition(sessionId, "round2_running", "critique");

      const critiqueInput: CritiqueInput = {
        userPrompt: sess.userPrompt,
        taskType: sess.taskType,
        opinions: r1.successes.map((o) => ({
          providerId: o.providerId,
          summary: o.summary,
          recommendedAnswer: o.recommendedAnswer,
          evidenceBackedClaims: o.evidenceBackedClaims,
          assumptions: o.assumptions,
          missingEvidence: o.missingEvidence,
          unsafePhrases: o.unsafePhrases.map((p) => p.phrase),
        })),
        knownDangerousPhrases: UNSAFE_PHRASES_KO,
        evidenceContext,
      };

      const r2 = await this.runRound<ProviderCritique>({
        sessionId,
        round: "critique",
        accuracyMode,
        call: (p, opts) => p.generateCritique(critiqueInput, opts),
        onSuccess: (c) => this.store.appendCritique(sessionId, c),
        sessionDeadline,
      });

      const r2ok = r2.successes.length;
      if (r2ok === 3) await this.transition(sessionId, "round2_completed");
      else if (r2ok === 2) await this.transition(sessionId, "round2_partial");
      else if (r2ok === 1) await this.transition(sessionId, "round2_limited");
      // r2ok === 0 → proceed to synthesis with explicit warning

      // ─── Round 3: Synthesis ─────────────────────────────────────────
      if (this.isPastDeadline(sessionDeadline)) {
        await this.markTimedOut(sessionId, "session deadline exceeded before synthesis");
        return;
      }
      await this.transition(sessionId, "synthesis_running", "synthesis");

      const synthInput: SynthesisInput = {
        userPrompt: sess.userPrompt,
        taskType: sess.taskType,
        opinions: critiqueInput.opinions,
        critiques: r2.successes.map((c) => ({
          providerId: c.providerId,
          unsupportedClaims: c.unsupportedClaims.map((u) => u.claim),
          unsafePhrasesFound: c.unsafePhrasesFound.map((u) => u.phrase),
          missingEvidenceFound: c.missingEvidenceFound,
          recommendedCorrections: c.recommendedCorrections,
        })),
        knownDangerousPhrases: UNSAFE_PHRASES_KO,
        evidenceContext,
      };

      const synthesized = await this.runSynthesis(
        sessionId,
        synthInput,
        r1ok,
        r2ok,
        accuracyMode,
        sessionDeadline,
      );

      // Populate the deterministic evidence usage contract (Step 10) from the
      // session evidence preview. ai_only → not_requested; ok preview with no
      // model mapping → conservative partial; no_matches/unavailable/failed →
      // reflected. Never auto-asserts "sufficient".
      const finalAns = applyEvidenceUsage(synthesized, evidencePreview);

      // ─── Final state ────────────────────────────────────────────────
      // Fix 3: reflect Round 2 outcome — a "completed" session requires both
      // Round 1 fully completed AND Round 2 to have hit
      // `minCritiquesForSynthesis` successes. Otherwise downgrade.
      let finalStatus: SessionStatus;
      if (r1ok === 1) {
        finalStatus = "limited_answer";
      } else if (r1ok < this.cfg.minOpinionsForMeeting) {
        finalStatus = "partial_completed";
      } else if (r2ok < this.cfg.minCritiquesForSynthesis) {
        finalStatus = "partial_completed";
      } else if (r1ok < 3 || r2ok < 3) {
        finalStatus = "partial_completed";
      } else {
        finalStatus = "completed";
      }

      if (this.isPastDeadline(sessionDeadline) && finalStatus === "completed") {
        finalStatus = "timed_out";
      }

      await this.store.update(sessionId, {
        finalAnswer: finalAns,
        status: finalStatus,
        completedAt: Date.now(),
      });
    } catch (err) {
      await this.store.update(sessionId, {
        status: "failed",
        errorMessage:
          err instanceof Error ? err.message : "unknown orchestrator error",
        completedAt: Date.now(),
      });
    }
  }

  // ───────────────────── round execution ─────────────────────────────

  private async runRound<T>(args: {
    sessionId: string;
    round: RoundKey;
    accuracyMode: AccuracyMode;
    call: (p: AiProviderAdapter, opts: ProviderCallOptions) => Promise<T>;
    onSuccess: (value: T) => Promise<void>;
    sessionDeadline: number;
  }): Promise<{ successes: T[]; failures: NormalizedProviderError[] }> {
    const { sessionId, round, accuracyMode, call, onSuccess, sessionDeadline } =
      args;

    // Round budget is bounded by both the configured round timeout AND the
    // remaining session budget.
    const roundDeadline = Math.min(
      Date.now() + this.cfg.roundTimeoutMs,
      sessionDeadline,
    );

    // Set every provider to "running" before dispatch so the UI shows
    // simultaneous activity (proving parallel execution).
    await Promise.all(
      PROVIDER_IDS.map((id) =>
        this.store.upsertProviderCall(sessionId, {
          providerId: id,
          round,
          status: "running",
          startedAt: Date.now(),
          timeoutMs: this.cfg.providerTimeoutMs,
          retryCount: 0,
        }),
      ),
    );

    const settled = await Promise.allSettled(
      PROVIDER_IDS.map((id) =>
        this.runProvider<T>({
          sessionId,
          providerId: id,
          round,
          accuracyMode,
          call,
          baseTimeoutMs: this.cfg.providerTimeoutMs,
          roundDeadline,
          sessionDeadline,
        }),
      ),
    );

    const successes: T[] = [];
    const failures: NormalizedProviderError[] = [];

    for (let i = 0; i < settled.length; i++) {
      const id = PROVIDER_IDS[i];
      const s = settled[i];
      if (s.status === "fulfilled") {
        const r = s.value;
        if (r.ok) {
          successes.push(r.value);
          await onSuccess(r.value);
        } else {
          failures.push(r.error);
        }
      } else {
        failures.push({
          providerId: id,
          errorType: "unknown",
          message:
            s.reason instanceof Error
              ? s.reason.message
              : String(s.reason ?? "unknown"),
          retryable: false,
        });
      }
    }

    return { successes, failures };
  }

  private async runProvider<T>(args: {
    sessionId: string;
    providerId: ProviderId;
    round: RoundKey;
    accuracyMode: AccuracyMode;
    call: (p: AiProviderAdapter, opts: ProviderCallOptions) => Promise<T>;
    baseTimeoutMs: number;
    roundDeadline: number;
    sessionDeadline: number;
  }): Promise<RunResult<T>> {
    const provider = this.providers[args.providerId];
    const start = Date.now();

    let chain: string[];
    try {
      chain = resolveModelChain(args.providerId, args.accuracyMode);
    } catch (err) {
      if (err instanceof ModelPolicyError) {
        const norm: NormalizedProviderError = {
          providerId: args.providerId,
          errorType: "model_policy",
          message: err.message,
          retryable: false,
        };
        await this.store.upsertProviderCall(args.sessionId, {
          providerId: args.providerId,
          round: args.round,
          status: "failed",
          startedAt: start,
          endedAt: Date.now(),
          latencyMs: Date.now() - start,
          timeoutMs: args.baseTimeoutMs,
          retryCount: 0,
          errorType: norm.errorType,
          errorMessage: norm.message,
          // No model selected — policy rejected the chain entirely.
          modelRequested: undefined,
          modelUsed: undefined,
        });
        return { ok: false, error: norm, latencyMs: 0, status: "failed" };
      }
      throw err;
    }

    let lastError: NormalizedProviderError | undefined;
    let rateLimitedSeen = false;
    let totalAttempts = 0;
    // Tracks the model used for the most recent attempt, so failure path
    // can record `modelUsed` even when every hop in the chain failed.
    let lastModelAttempted: string | undefined;
    const limiter = getRateLimiter(args.providerId);

    for (let chainIdx = 0; chainIdx < chain.length; chainIdx++) {
      const modelForThisHop = chain[chainIdx];
      lastModelAttempted = modelForThisHop;
      let perHopAttempts = 0;

      // After the primary 429, walking the fallback chain must bypass the
      // cooldown — otherwise we never get a chance to try the fallback. The
      // cooldown still applies to brand-new calls (next round / next session).
      const bypassCooldown = chainIdx > 0;

      while (perHopAttempts <= this.cfg.maxRetries) {
        const effectiveTimeout = this.computeAttemptBudget(
          args.baseTimeoutMs,
          args.roundDeadline,
          args.sessionDeadline,
        );
        if (effectiveTimeout <= 0) {
          // Out of time — give up rather than dispatch a near-zero timeout.
          lastError = {
            providerId: args.providerId,
            errorType: "timeout",
            message: "deadline exceeded before next attempt",
            retryable: false,
          };
          break;
        }

        const controller = new AbortController();
        const callOpts: ProviderCallOptions = {
          timeoutMs: effectiveTimeout,
          retryCount: totalAttempts,
          abortSignal: controller.signal,
          sessionId: args.sessionId,
          round: args.round,
          model: modelForThisHop,
        };

        try {
          // The limiter's 429 retry sleep must respect the same deadline
          // the orchestrator is enforcing, otherwise a long Retry-After
          // could blow past the round/session budget while we're holding
          // the slot.
          const hopDeadline =
            Date.now() + effectiveTimeout < args.roundDeadline
              ? Date.now() + effectiveTimeout
              : args.roundDeadline;
          const limiterDeadline = Math.min(hopDeadline, args.sessionDeadline);

          const value = await limiter.run(
            () =>
              withTimeout(
                () => args.call(provider, callOpts),
                {
                  timeoutMs: effectiveTimeout,
                  label: `${args.providerId}:${args.round}`,
                  abortController: controller,
                },
              ),
            modelForThisHop,
            {
              bypassCooldown,
              deadlineMs: limiterDeadline,
              abortSignal: controller.signal,
              onAttempt: (ev) => {
                void this.store.appendAttempt(args.sessionId, {
                  sessionId: args.sessionId,
                  providerId: args.providerId,
                  round: args.round,
                  model: modelForThisHop,
                  attemptIndex: ev.attemptIndex,
                  chainIndex: chainIdx,
                  status: limiterStatusToProviderStatus(ev.status),
                  startedAt: ev.startedAt,
                  endedAt: ev.endedAt,
                  latencyMs: ev.endedAt - ev.startedAt,
                  timeoutMs: effectiveTimeout,
                  errorType: ev.errorType,
                  errorMessage: ev.errorMessage,
                  retryAfterMs: ev.retryAfterMs,
                  rateLimited: ev.status === "rate_limited",
                });
              },
            },
          );

          const latencyMs = Date.now() - start;
          await this.store.upsertProviderCall(args.sessionId, {
            providerId: args.providerId,
            round: args.round,
            status: "succeeded",
            startedAt: start,
            endedAt: Date.now(),
            latencyMs,
            timeoutMs: effectiveTimeout,
            retryCount: totalAttempts,
            modelRequested: chain[0],
            modelUsed: modelForThisHop,
            rateLimited: rateLimitedSeen,
          });
          return { ok: true, value: value as T, latencyMs };
        } catch (err) {
          const norm = normalizeProviderError(args.providerId, err);
          lastError = norm;

          if (norm.errorType === "rate_limit") {
            rateLimitedSeen = true;
            controller.abort();
            break;
          }
          if (norm.errorType === "schema_validation") {
            // Preserve raw text on call record so an operator can diagnose.
            lastModelAttempted = modelForThisHop;
            await this.store.upsertProviderCall(args.sessionId, {
              providerId: args.providerId,
              round: args.round,
              status: "schema_invalid",
              startedAt: start,
              endedAt: Date.now(),
              latencyMs: Date.now() - start,
              timeoutMs: effectiveTimeout,
              retryCount: totalAttempts,
              modelRequested: chain[0],
              modelUsed: lastModelAttempted,
              errorType: norm.errorType,
              errorMessage: norm.message,
              rawResponse: norm.rawText,
              parsedResponse: norm.parsedJson,
            });
            controller.abort();
            return {
              ok: false,
              error: norm,
              latencyMs: Date.now() - start,
              status: "schema_invalid",
            };
          }
          if (!norm.retryable || perHopAttempts >= this.cfg.maxRetries) {
            controller.abort();
            break;
          }

          // Bounded backoff — and cap by remaining round/session budget.
          perHopAttempts += 1;
          totalAttempts += 1;
          const base = Number(process.env.RETRY_BASE_DELAY_MS ?? 1200);
          const cap = Number(process.env.RETRY_MAX_DELAY_MS ?? 5000);
          const configured = Math.min(cap, base * 2 ** (perHopAttempts - 1));
          const remaining =
            Math.min(args.roundDeadline, args.sessionDeadline) - Date.now();
          const wait = Math.min(configured, remaining - MIN_HOP_BUDGET_MS);
          if (wait <= 0) {
            // No time left for a retry. Break out and let the chain/loop
            // resolve to whichever lastError we have.
            break;
          }
          await new Promise((r) =>
            setTimeout(r, wait + Math.random() * 250),
          );
        } finally {
          controller.abort();
        }
      }

      // Walk to next fallback model only on 429; for other errors stop here.
      if (lastError?.errorType !== "rate_limit") break;
    }

    const latencyMs = Date.now() - start;
    const status: ProviderStatus =
      lastError?.errorType === "timeout"
        ? "timed_out"
        : lastError?.errorType === "schema_validation"
          ? "schema_invalid"
          : lastError?.errorType === "rate_limit"
            ? "rate_limited"
            : "failed";

    await this.store.upsertProviderCall(args.sessionId, {
      providerId: args.providerId,
      round: args.round,
      status,
      startedAt: start,
      endedAt: Date.now(),
      latencyMs,
      timeoutMs: args.baseTimeoutMs,
      retryCount: totalAttempts,
      errorType: lastError?.errorType,
      errorMessage: lastError?.message,
      modelRequested: chain[0],
      modelUsed: lastModelAttempted,
      rateLimited: rateLimitedSeen || lastError?.errorType === "rate_limit",
      rawResponse: lastError?.rawText,
      parsedResponse: lastError?.parsedJson,
    });

    return {
      ok: false,
      error: lastError ?? {
        providerId: args.providerId,
        errorType: "unknown",
        message: "unknown error",
        retryable: false,
      },
      latencyMs,
      status,
    };
  }

  // ───────────────────── synthesis ──────────────────────────────────

  private async runSynthesis(
    sessionId: string,
    input: SynthesisInput,
    opinionCount: number,
    critiqueCount: number,
    accuracyMode: AccuracyMode,
    sessionDeadline: number,
  ): Promise<SynthesisResult> {
    // GPT primary, Claude fallback per docs/05_round_based_orchestration.md.
    const order: ProviderId[] = ["openai", "anthropic", "gemini"];

    for (const id of order) {
      const provider = this.providers[id];
      if (!provider.generateSynthesis) continue;

      let chain: string[];
      try {
        chain = resolveModelChain(id, accuracyMode);
      } catch {
        continue;
      }
      const limiter = getRateLimiter(id);

      for (let chainIdx = 0; chainIdx < chain.length; chainIdx++) {
        const model = chain[chainIdx];
        const bypassCooldown = chainIdx > 0;

        const remaining = sessionDeadline - Date.now();
        if (remaining < MIN_HOP_BUDGET_MS) {
          // No time left to make any meaningful synthesis attempt — fall
          // through to the deterministic fallback below.
          return this.applySafetyGuard(
            this.fallbackSynthesis(input, opinionCount),
            opinionCount,
            critiqueCount,
          );
        }
        const hopTimeout = Math.min(this.cfg.synthesisTimeoutMs, remaining);

        const hopStart = Date.now();
        const hopDeadline = Math.min(
          hopStart + hopTimeout,
          sessionDeadline,
        );
        try {
          const controller = new AbortController();
          const ans = await limiter.run(
            () =>
              withTimeout(
                () =>
                  provider.generateSynthesis!(input, {
                    timeoutMs: hopTimeout,
                    retryCount: 0,
                    abortSignal: controller.signal,
                    sessionId,
                    round: "synthesis",
                    model,
                  }),
                {
                  timeoutMs: hopTimeout,
                  label: `${id}:synthesis`,
                  abortController: controller,
                },
              ),
            model,
            {
              bypassCooldown,
              deadlineMs: hopDeadline,
              abortSignal: controller.signal,
              onAttempt: (ev) => {
                void this.store.appendAttempt(sessionId, {
                  sessionId,
                  providerId: id,
                  round: "synthesis",
                  model,
                  attemptIndex: ev.attemptIndex,
                  chainIndex: chainIdx,
                  status: limiterStatusToProviderStatus(ev.status),
                  startedAt: ev.startedAt,
                  endedAt: ev.endedAt,
                  latencyMs: ev.endedAt - ev.startedAt,
                  timeoutMs: hopTimeout,
                  errorType: ev.errorType,
                  errorMessage: ev.errorMessage,
                  retryAfterMs: ev.retryAfterMs,
                  rateLimited: ev.status === "rate_limited",
                });
              },
            },
          );
          return this.applySafetyGuard(ans, opinionCount, critiqueCount);
        } catch (err) {
          await this.recordSynthesisError(sessionId, id, err, model, {
            startedAt: hopStart,
            timeoutMs: hopTimeout,
          });
          if (isRateLimitedError(err)) continue; // try next chain model
          break; // non-429 → next provider in order
        }
      }
    }

    return this.applySafetyGuard(
      this.fallbackSynthesis(input, opinionCount),
      opinionCount,
      critiqueCount,
    );
  }

  private async recordSynthesisError(
    sessionId: string,
    providerId: ProviderId,
    err: unknown,
    model?: string,
    timing?: { startedAt: number; timeoutMs: number },
  ): Promise<void> {
    const norm = normalizeProviderError(providerId, err);
    const startedAt = timing?.startedAt ?? Date.now();
    const endedAt = Date.now();
    await this.store.upsertProviderCall(sessionId, {
      providerId,
      round: "synthesis",
      status:
        norm.errorType === "timeout"
          ? "timed_out"
          : norm.errorType === "rate_limit"
            ? "rate_limited"
            : norm.errorType === "schema_validation"
              ? "schema_invalid"
              : "failed",
      startedAt,
      endedAt,
      latencyMs: Math.max(0, endedAt - startedAt),
      timeoutMs: timing?.timeoutMs ?? this.cfg.synthesisTimeoutMs,
      retryCount: 0,
      errorType: norm.errorType,
      errorMessage: norm.message,
      modelUsed: model,
      rateLimited: norm.errorType === "rate_limit",
      rawResponse: norm.rawText,
      parsedResponse: norm.parsedJson,
    });
  }

  private applySafetyGuard(
    ans: SynthesisResult,
    opinionCount: number,
    critiqueCount: number,
  ): SynthesisResult {
    // Ideation answers carry a different shape (no businessReadyAnswer); run
    // the parallel ideation-aware guard so the domain-safety surface still
    // gets populated (CLAUDE.md non-negotiable #5).
    if (ans.answerKind === "ideation") {
      return this.applyIdeationSafetyGuard(ans, opinionCount, critiqueCount);
    }

    const finalText = [
      ans.conclusion,
      ans.finalMarkdown,
      ans.businessReadyAnswer,
    ].join("\n\n");
    const detected = detectUnsafePhrases(finalText);

    const mergedUnsafe = dedupUnsafePhrases([
      ...ans.unsafePhrases,
      ...detected.map((d) => ({
        phrase: d.phrase,
        reason: "도메인 안전성 정책에 따라 자동 탐지됨",
        recommended: d.recommended,
      })),
    ]);

    const mergedSafeWording = dedupStrings([
      ...ans.recommendedSafeWording,
      ...collectRecommendedWordings(detected),
    ]);

    const risk = computeRiskLevel({
      unsafePhrases: detected,
      missingEvidence: ans.missingEvidence,
      taskType: "",
      text: finalText,
    });

    let finalMarkdown = ans.finalMarkdown;
    let businessReady = ans.businessReadyAnswer;
    let internalMemo = ans.internalMemo;

    // Fix 3: explicit warning when Round 2 critique never produced output.
    if (critiqueCount === 0) {
      const critiqueWarning =
        "[경고] Round 2 상호비판이 수행되지 못했고, 본 답변은 Round 1 의견만을 기반으로 합성되었습니다. 외부 발송 전 반드시 추가 검토가 필요합니다.";
      finalMarkdown = `${critiqueWarning}\n\n${finalMarkdown}`;
      internalMemo = internalMemo
        ? `${critiqueWarning}\n\n${internalMemo}`
        : critiqueWarning;
      businessReady = `${critiqueWarning}\n\n${businessReady}`;
    }

    // Fix 5: limited-mode warning is plain text (no emoji).
    if (opinionCount <= 1) {
      const limitedWarning =
        "[제한적 검토 안내] 본 답변은 일부 AI만 응답하여 제한적 검토 결과입니다. 외부 발송 전 추가 검토가 필요합니다.";
      businessReady = `${limitedWarning}\n\n${businessReady}`;
    }

    finalMarkdown = `${finalMarkdown}\n\n---\n_${FINAL_ANSWER_DISCLAIMER_KO}_`;

    return FinalAnswerSchema.parse({
      ...ans,
      unsafePhrases: mergedUnsafe,
      recommendedSafeWording: mergedSafeWording,
      riskLevel:
        priorityRiskLevel(ans.riskLevel, risk) ?? ans.riskLevel ?? "low",
      finalMarkdown,
      businessReadyAnswer: businessReady,
      internalMemo,
    });
  }

  // Ideation-mode safety guard. Mirrors the standard guard but scans the idea
  // text (no businessReadyAnswer/internalMemo exist) and writes warnings +
  // disclaimer into finalMarkdown so the risk / missing-evidence panels stay
  // populated identically to the standard path.
  private applyIdeationSafetyGuard(
    ans: IdeationFinalAnswer,
    opinionCount: number,
    critiqueCount: number,
  ): IdeationFinalAnswer {
    const ideaText = ans.ideas
      .map((i) =>
        [
          i.ideaSummary,
          i.expectedBenefit,
          i.recommendedNextExperiment,
          ...i.doNotClaim,
        ].join(" "),
      )
      .join("\n");
    const finalText = [ans.conclusion, ans.finalMarkdown, ideaText].join(
      "\n\n",
    );
    const detected = detectUnsafePhrases(finalText);

    const mergedUnsafe = dedupUnsafePhrases([
      ...ans.unsafePhrases,
      ...detected.map((d) => ({
        phrase: d.phrase,
        reason: "도메인 안전성 정책에 따라 자동 탐지됨",
        recommended: d.recommended,
      })),
    ]);

    const mergedSafeWording = dedupStrings([
      ...ans.recommendedSafeWording,
      ...collectRecommendedWordings(detected),
    ]);

    const risk = computeRiskLevel({
      unsafePhrases: detected,
      missingEvidence: ans.missingEvidence,
      taskType: "",
      text: finalText,
    });

    let finalMarkdown = ans.finalMarkdown;

    if (critiqueCount === 0) {
      const critiqueWarning =
        "[경고] Round 2 상호비판이 수행되지 못했고, 본 아이디어는 Round 1 의견만을 기반으로 정리되었습니다. 외부 활용 전 반드시 추가 검토가 필요합니다.";
      finalMarkdown = `${critiqueWarning}\n\n${finalMarkdown}`;
    }
    if (opinionCount <= 1) {
      const limitedWarning =
        "[제한적 검토 안내] 본 아이디어는 일부 AI만 응답하여 제한적 검토 결과입니다. 외부 활용 전 추가 검토가 필요합니다.";
      finalMarkdown = `${limitedWarning}\n\n${finalMarkdown}`;
    }

    finalMarkdown = `${finalMarkdown}\n\n---\n_${FINAL_ANSWER_DISCLAIMER_KO}_`;

    return IdeationFinalAnswerSchema.parse({
      ...ans,
      unsafePhrases: mergedUnsafe,
      recommendedSafeWording: mergedSafeWording,
      riskLevel:
        priorityRiskLevel(ans.riskLevel, risk) ?? ans.riskLevel ?? "medium",
      finalMarkdown,
    });
  }

  private fallbackSynthesis(
    input: SynthesisInput,
    opinionCount: number,
  ): SynthesisResult {
    if (input.taskType === "application_ideas") {
      return this.fallbackIdeation(input, opinionCount);
    }

    const evidence = input.opinions.flatMap((o) => o.evidenceBackedClaims);
    const missing = Array.from(
      new Set([
        ...input.opinions.flatMap((o) => o.missingEvidence),
        ...input.critiques.flatMap((c) => c.missingEvidenceFound),
      ]),
    );
    const corrections = input.critiques.flatMap(
      (c) => c.recommendedCorrections,
    );

    const conclusion =
      "AI 합성 단계가 실패하여 결정론적 요약을 제공합니다. 외부 발송 전 추가 검토가 필요합니다.";

    return FinalAnswerSchema.parse({
      conclusion,
      finalMarkdown: [
        `## (Fallback) 최종 합의 결론`,
        conclusion,
        ``,
        `### 종합 의견`,
        ...input.opinions.map((o) => `- [${o.providerId}] ${o.summary}`),
        ``,
        `### 합의된 보완 사항`,
        ...corrections.map((c) => `- ${c}`),
      ].join("\n"),
      businessReadyAnswer:
        opinionCount === 0
          ? "현재 모든 AI 검토가 실패하여 업체 발송용 답변을 작성할 수 없습니다."
          : "현재 제공된 자료 기준으로 조건부 검토가 가능하며, 시험성적서/기재 호환성/사용 환경 확인 후 단계적 적용 검토가 필요합니다.",
      internalMemo:
        "Synthesis fallback path. AI 합성 단계가 실패했으므로 합의된 비판 사항을 반영해 수동 검토 필요.",
      evidenceBackedClaims: evidence,
      assumptions: [],
      missingEvidence: missing,
      unsafePhrases: [],
      recommendedSafeWording: [],
      riskLevel: "medium",
      confidenceScore: 0.3,
      followUpQuestions: [],
      unresolvedDisagreements: [],
      providerSummary: input.opinions.map((o) => ({
        providerId: o.providerId,
        status: "succeeded",
      })),
      sessionStatus: "fallback_summary",
    });
  }

  // Deterministic ideation fallback when AI synthesis fails for an
  // application_ideas session. Derives a minimal, safe idea list from the
  // Round 1 opinions so the answer still carries the safety surface.
  private fallbackIdeation(
    input: SynthesisInput,
    opinionCount: number,
  ): IdeationFinalAnswer {
    const missing = Array.from(
      new Set([
        ...input.opinions.flatMap((o) => o.missingEvidence),
        ...input.critiques.flatMap((c) => c.missingEvidenceFound),
      ]),
    );
    const conclusion =
      opinionCount === 0
        ? "AI 검토가 모두 실패하여 아이디어를 생성할 수 없습니다. 추가 검토가 필요합니다."
        : "AI 합성 단계가 실패하여 Round 1 의견 기반의 결정론적 아이디어 요약을 제공합니다. 모든 항목은 가설이며 추가 검토가 필요합니다.";

    return IdeationFinalAnswerSchema.parse({
      ideas: input.opinions.slice(0, 3).map((o) => ({
        ideaSummary: `[${o.providerId}] ${o.summary}`,
        targetApplication: "",
        expectedBenefit: "",
        requiredEvidence: o.missingEvidence,
        riskLevel: "high",
        recommendedNextExperiment:
          "필요 근거(시험성적서/기재 호환성) 확보 후 단계적 검토",
        doNotClaim: ["단정적 성능 주장", "인증 완료 표현"],
      })),
      unresolvedQuestions: [],
      followUpResearch: [],
      conclusion,
      finalMarkdown: [
        `## (Fallback) 아이디어 모드 요약`,
        conclusion,
        ``,
        `### 종합 의견`,
        ...input.opinions.map((o) => `- [${o.providerId}] ${o.summary}`),
      ].join("\n"),
      missingEvidence: missing,
      unsafePhrases: [],
      recommendedSafeWording: [],
      riskLevel: "high",
      confidenceScore: 0.3,
      providerSummary: input.opinions.map((o) => ({
        providerId: o.providerId,
        status: "succeeded",
      })),
      sessionStatus: "fallback_summary",
    });
  }

  private computeAttemptBudget(
    base: number,
    roundDeadline: number,
    sessionDeadline: number,
  ): number {
    const now = Date.now();
    const roundLeft = roundDeadline - now;
    const sessionLeft = sessionDeadline - now;
    return Math.max(0, Math.min(base, roundLeft, sessionLeft));
  }

  private isPastDeadline(sessionDeadline: number): boolean {
    return Date.now() >= sessionDeadline;
  }

  private async markTimedOut(
    sessionId: string,
    message: string,
  ): Promise<void> {
    await this.store.update(sessionId, {
      status: "timed_out",
      errorMessage: message,
      completedAt: Date.now(),
    });
  }

  private async transition(
    sessionId: string,
    status: SessionStatus,
    currentRound?: RoundKey,
    extra?: Partial<SessionRecord>,
  ): Promise<void> {
    await this.store.update(sessionId, {
      status,
      currentRound,
      ...extra,
    });
  }

  /**
   * Bounded, timeout-safe internal evidence retrieval preflight.
   *
   * Returns a `SessionEvidencePreview` describing what (if anything) was
   * retrieved. NEVER throws and NEVER fails the session — on timeout /
   * database-unavailable / any error it returns an `unavailable` / `failed`
   * preview and the council run continues unchanged. The retrieved
   * candidates are NOT injected into provider prompts in this step.
   */
  private async runEvidencePreflight(
    sess: SessionRecord,
  ): Promise<SessionEvidencePreview> {
    // ai_only: never touch the documents layer — default behavior preserved
    // exactly (no DB access, no Prisma load).
    if (sess.evidenceMode === "ai_only") {
      return notRequestedPreview(sess.evidenceMode);
    }

    // Lazily construct the service so the ai_only path above never does.
    const evidence = this.evidenceService ?? new EvidenceBundleService();
    try {
      const bundle = await withTimeout(() => evidence.build({ query: sess.userPrompt }), {
        timeoutMs: evidencePreviewTimeoutMs(),
        label: "evidence-preflight",
      });
      return previewFromBundle(sess.evidenceMode, bundle);
    } catch (err) {
      if (err instanceof TimeoutError) {
        return unavailablePreview(sess.evidenceMode, err.message);
      }
      if (
        err instanceof DocumentServiceError &&
        err.code === "database_unavailable"
      ) {
        return unavailablePreview(sess.evidenceMode, err.message);
      }
      const message = err instanceof Error ? err.message : String(err);
      return failedPreview(sess.evidenceMode, message);
    }
  }
}

// ───────────────────────── helpers ─────────────────────────────────────

function normalizeProviderError(
  providerId: ProviderId,
  err: unknown,
): NormalizedProviderError {
  if (isRateLimitedError(err)) {
    const e = err as RateLimitedError;
    return {
      providerId,
      errorType: "rate_limit",
      message: e.message,
      retryable: false,
      retryAfterMs: e.retryAfterMs,
      rawError: err,
    };
  }
  if (err instanceof ModelPolicyError) {
    return {
      providerId,
      errorType: "model_policy",
      message: err.message,
      retryable: false,
      rawError: err,
    };
  }
  if (err instanceof TimeoutError) {
    return {
      providerId,
      errorType: "timeout",
      message: err.message,
      retryable: false,
      rawError: err,
    };
  }
  if (err instanceof SchemaValidationError) {
    return {
      providerId,
      errorType: "schema_validation",
      message: err.message,
      retryable: false,
      rawError: err,
      rawText: err.rawText,
      parsedJson: err.parsed,
    };
  }
  if (err instanceof JsonParseError) {
    return {
      providerId,
      errorType: "schema_validation",
      message: err.message,
      retryable: false,
      rawError: err,
      rawText: err.rawText,
    };
  }
  if (err instanceof ZodError) {
    return {
      providerId,
      errorType: "schema_validation",
      message: err.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; "),
      retryable: false,
      rawError: err,
    };
  }
  const anyErr = err as { status?: number; code?: string; message?: string };
  if (typeof anyErr?.status === "number") {
    if (anyErr.status === 429)
      return {
        providerId,
        errorType: "rate_limit",
        message: anyErr.message ?? "rate limited",
        retryable: true,
        rawError: err,
      };
    if (anyErr.status === 401 || anyErr.status === 403)
      return {
        providerId,
        errorType: "auth",
        message: anyErr.message ?? "auth error",
        retryable: false,
        rawError: err,
      };
    if (anyErr.status >= 500)
      return {
        providerId,
        errorType: "provider_5xx",
        message: anyErr.message ?? "provider 5xx",
        retryable: true,
        rawError: err,
      };
    if (anyErr.status >= 400)
      return {
        providerId,
        errorType: "invalid_request",
        message: anyErr.message ?? "invalid request",
        retryable: false,
        rawError: err,
      };
  }
  return {
    providerId,
    errorType: "unknown",
    message: anyErr?.message ?? "unknown error",
    retryable: false,
    rawError: err,
  };
}

/**
 * Map limiter attempt statuses → ProviderStatus on the attempt log.
 * Only "succeeded", "rate_limited", "error" are emitted by the limiter.
 */
function limiterStatusToProviderStatus(
  status: "succeeded" | "rate_limited" | "error",
): ProviderStatus {
  if (status === "succeeded") return "succeeded";
  if (status === "rate_limited") return "rate_limited";
  return "failed";
}

const RISK_RANK: Record<string, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};
function priorityRiskLevel(
  a: string | undefined,
  b: string | undefined,
): "low" | "medium" | "high" | "critical" {
  const ra = RISK_RANK[a ?? "low"] ?? 0;
  const rb = RISK_RANK[b ?? "low"] ?? 0;
  const pick = ra >= rb ? a : b;
  return (pick as "low" | "medium" | "high" | "critical") ?? "low";
}

function dedupUnsafePhrases(
  list: Array<{ phrase: string; reason?: string; recommended?: string }>,
): Array<{ phrase: string; reason?: string; recommended?: string }> {
  const seen = new Set<string>();
  const out: typeof list = [];
  for (const it of list) {
    const key = `${it.phrase}||${it.recommended ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}

function dedupStrings(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of list) {
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function collectRecommendedWordings(
  findings: UnsafePhraseFinding[],
): string[] {
  const out: string[] = [];
  for (const f of findings) {
    if (f.recommended) out.push(f.recommended);
  }
  return out;
}
