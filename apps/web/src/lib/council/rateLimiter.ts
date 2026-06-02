// Per-provider rate limiter, health tracker, and metric collector.
//
// Goals (see additional spec at top of conversation):
//   1. Limit concurrent in-flight calls per provider.
//   2. FIFO queue overflow tasks (no unbounded fan-out).
//   3. Respect server-provided Retry-After when 429 is seen.
//   4. Bounded exponential backoff with jitter, capped attempts.
//   5. When a provider trips the cooldown, queued waiters are NOT held —
//      they fail fast with a rate_limited error so the orchestrator can move
//      on with the other providers (partial completion is preferred over
//      freezing the whole session).
//   6. Track health: healthy | degraded | rate_limited | unavailable.
//   7. Emit metric events for admin visibility (logged for MVP; can be
//      wired to a real sink in Phase 2).

import type { ProviderId } from "./types";
import { TimeoutError } from "./timeout";

export type ProviderHealth =
  | "healthy"
  | "degraded"
  | "rate_limited"
  | "unavailable";

export type RateLimitMetric = {
  providerId: ProviderId;
  model?: string;
  status: "success" | "rate_limited" | "timeout" | "error";
  retryCount: number;
  retryAfterMs?: number;
  latencyMs: number;
  errorCode?: string;
  timestamp: number;
};

/**
 * Per-attempt event emitted by `SingleProviderLimiter.run` via the
 * `onAttempt` callback. Fires once for EVERY try (success or failure),
 * including retries inside the limiter's 429 loop. The orchestrator uses
 * this to maintain a forensic attempt log per session.
 */
export type LimiterAttemptEvent = {
  /** 0-based attempt counter within this `run()` call. */
  attemptIndex: number;
  status: "succeeded" | "rate_limited" | "error";
  startedAt: number;
  endedAt: number;
  errorType?: string;
  errorMessage?: string;
  retryAfterMs?: number;
};

export type RateLimitedError = Error & {
  rateLimited: true;
  retryAfterMs?: number;
  providerId: ProviderId;
};

export function isRateLimitedError(err: unknown): err is RateLimitedError {
  return (
    !!err &&
    typeof err === "object" &&
    (err as Record<string, unknown>)["rateLimited"] === true
  );
}

export type RateLimiterOptions = {
  maxConcurrent: number;
  /** Bounded exponential backoff cap (ms). */
  backoffMaxMs: number;
  /** Maximum 429 retries before giving up on a single call. */
  maxRetries: number;
  /** How long to keep a provider in the rate_limited cooldown bucket. */
  cooldownMs: number;
  /** How many recent errors flip health from healthy → degraded. */
  degradedAfterErrors: number;
};

export const DEFAULT_RATE_LIMITER_OPTIONS: RateLimiterOptions = {
  maxConcurrent: 2,
  backoffMaxMs: 8_000,
  maxRetries: 2,
  cooldownMs: 30_000,
  degradedAfterErrors: 3,
};

type Waiter = {
  cancelled: boolean;
  /** Granted a slot by releaseSlot (inFlight already incremented). */
  grant: () => void;
  /** Gave up (deadline / abort / cooldown) — rejects the acquire promise. */
  cancel: (e: unknown) => void;
};

class SingleProviderLimiter {
  readonly providerId: ProviderId;
  readonly opts: RateLimiterOptions;

  private inFlight = 0;
  private queue: Waiter[] = [];
  private cooldownUntil = 0;
  private recentErrors = 0;
  private healthState: ProviderHealth = "healthy";
  private listeners: Array<(m: RateLimitMetric) => void> = [];

  constructor(providerId: ProviderId, opts: Partial<RateLimiterOptions> = {}) {
    this.providerId = providerId;
    this.opts = { ...DEFAULT_RATE_LIMITER_OPTIONS, ...opts };
  }

  get health(): ProviderHealth {
    if (Date.now() < this.cooldownUntil) return "rate_limited";
    return this.healthState;
  }

  // ── Diagnostics (read-only) ──────────────────────────────────────────────
  /** Number of slots currently taken (in-flight calls + any leaked holders). */
  get inFlightCount(): number {
    return this.inFlight;
  }
  /** Callers parked waiting for a slot. A persistently >0 value with a full
   *  inFlight indicates saturation / leaked slots. */
  get queueLength(): number {
    return this.queue.length;
  }
  /** Configured concurrency cap for this provider. */
  get maxConcurrent(): number {
    return this.opts.maxConcurrent;
  }

  /**
   * Dev/admin escape hatch: forcibly clear all transient limiter state so a
   * stuck / saturated provider self-heals without a process restart. Queued
   * waiters are rejected (fail fast) rather than left hanging on a counter we
   * are about to zero. In-flight tasks keep running but are no longer counted
   * — their release is idempotent and clamps at 0, so this is always safe.
   */
  reset(): void {
    const waiters = this.queue.slice();
    this.queue.length = 0;
    for (const w of waiters) w.cancel(new Error("rate limiter reset"));
    this.inFlight = 0;
    this.cooldownUntil = 0;
    this.recentErrors = 0;
    this.healthState = "healthy";
  }

  onMetric(fn: (m: RateLimitMetric) => void): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  private emit(m: RateLimitMetric) {
    for (const l of this.listeners) {
      try {
        l(m);
      } catch {
        /* ignore listener errors */
      }
    }
  }

  /** Synchronously check whether the provider is currently cooled down. */
  isCoolingDown(): boolean {
    return Date.now() < this.cooldownUntil;
  }

  remainingCooldownMs(): number {
    return Math.max(0, this.cooldownUntil - Date.now());
  }

  /**
   * Schedule `task` for execution while respecting concurrency + cooldown.
   *
   * Cooldown: if the provider is in cooldown, the call fails fast with
   * `RateLimitedError` so the orchestrator can mark this provider
   * rate_limited and proceed with the other providers — we never hold the
   * whole session for a cooled-down provider.
   *
   * 429 / Retry-After: tasks throw `RateLimitedError` (best constructed via
   * `markRateLimited`) when a 429 is observed. The limiter sleeps for the
   * lesser of `retryAfterMs` and the remaining budget before retrying.
   *
   * Deadline contract (`opts.deadlineMs`):
   *   - 429 retry sleep is capped by the deadline; we never sleep past it.
   *   - If <50 ms remain before the deadline, we trip cooldown and rethrow
   *     `RateLimitedError` immediately so the orchestrator can record
   *     `rate_limited` and proceed without blowing the round/session
   *     timeout. The cap is a small safety margin so the orchestrator gets
   *     a chance to wind down.
   *   - The sleep itself is abortable via `opts.abortSignal` so an upstream
   *     timeout can break us out instantly.
   *
   * `opts.bypassCooldown`: set true when the orchestrator is walking the
   * model fallback chain WITHIN A SINGLE LOGICAL CALL. The cooldown
   * primarily protects future callers; once we have already failed on the
   * primary model we should still get a chance at the fallback model in
   * this same call. Concurrency cap is always honored.
   */
  async run<T>(
    task: (model: string) => Promise<T>,
    model: string,
    opts: {
      bypassCooldown?: boolean;
      deadlineMs?: number;
      abortSignal?: AbortSignal;
      /**
       * Fires once per attempt (every try, success or failure). Errors in
       * the callback itself are swallowed to keep observability from
       * affecting the call's outcome.
       */
      onAttempt?: (event: LimiterAttemptEvent) => void;
    } = {},
  ): Promise<T> {
    if (!opts.bypassCooldown && this.isCoolingDown()) {
      throw this.buildRateLimitedError(
        `Provider ${this.providerId} is in cooldown for ${this.remainingCooldownMs()}ms`,
        this.remainingCooldownMs(),
      );
    }

    // Slot acquisition is bounded by the SAME deadline/abort the caller uses
    // for the call itself. Without this, a leaked/saturated slot (e.g. an
    // in-process background task orphaned by a dev-server recompile that never
    // ran its release) would queue new calls FOREVER — bypassing every
    // per-call / round / session timeout. (Runs before the try/finally below,
    // so a rejection here never wrongly releases a slot we never took.)
    const release = await this.acquireSlot(opts.deadlineMs, opts.abortSignal);
    // Release the slot the INSTANT this call is cancelled / timed out, even if
    // a misbehaving task ignores its abort signal and keeps running in the
    // background (fire-and-forget). release() is idempotent and we do NOT reject
    // here, so the task's own outcome and error classification are unchanged —
    // we only stop counting the slot so a queued caller can proceed promptly.
    let onAbortRelease: (() => void) | undefined;
    if (opts.abortSignal) {
      if (opts.abortSignal.aborted) {
        release();
      } else {
        onAbortRelease = () => release();
        opts.abortSignal.addEventListener("abort", onAbortRelease, {
          once: true,
        });
      }
    }
    const start = Date.now();
    let attempt = 0;

    const fireAttempt = (event: LimiterAttemptEvent) => {
      if (!opts.onAttempt) return;
      try {
        opts.onAttempt(event);
      } catch {
        /* swallow listener errors */
      }
    };

    try {
      while (true) {
        const attemptStart = Date.now();
        try {
          const value = await task(model);
          const attemptEnd = Date.now();
          this.recentErrors = 0;
          this.healthState = "healthy";
          fireAttempt({
            attemptIndex: attempt,
            status: "succeeded",
            startedAt: attemptStart,
            endedAt: attemptEnd,
          });
          this.emit({
            providerId: this.providerId,
            model,
            status: "success",
            retryCount: attempt,
            latencyMs: attemptEnd - start,
            timestamp: attemptEnd,
          });
          return value;
        } catch (err) {
          const attemptEnd = Date.now();
          if (isRateLimitedError(err)) {
            // Server told us to wait. Respect Retry-After when provided.
            const requested = err.retryAfterMs ?? this.computeBackoff(attempt);
            const cappedWait = this.capWaitByDeadline(
              requested,
              opts.deadlineMs,
            );

            fireAttempt({
              attemptIndex: attempt,
              status: "rate_limited",
              startedAt: attemptStart,
              endedAt: attemptEnd,
              errorType: "rate_limit",
              errorMessage: err.message,
              retryAfterMs: requested,
            });

            // Out of budget OR retry quota exhausted → trip cooldown,
            // surface rate_limited so the orchestrator can move on.
            if (
              cappedWait <= 0 ||
              attempt >= this.opts.maxRetries
            ) {
              // Cool down using the SERVER-requested wait (not the capped
              // value) so the next session/call respects what the API
              // actually asked for.
              this.tripCooldown(requested);
              this.emit({
                providerId: this.providerId,
                model,
                status: "rate_limited",
                retryCount: attempt,
                retryAfterMs: requested,
                latencyMs: Date.now() - start,
                errorCode: "rate_limited",
                timestamp: Date.now(),
              });
              throw err;
            }
            attempt += 1;
            try {
              await this.abortableSleep(cappedWait, opts.abortSignal);
            } catch {
              // Sleep aborted (deadline/external signal) → trip cooldown,
              // surface rate_limited, do NOT keep retrying.
              this.tripCooldown(requested);
              this.emit({
                providerId: this.providerId,
                model,
                status: "rate_limited",
                retryCount: attempt,
                retryAfterMs: requested,
                latencyMs: Date.now() - start,
                errorCode: "rate_limited_aborted",
                timestamp: Date.now(),
              });
              throw err;
            }
            continue;
          }

          // Any other error degrades health but does not cool us down.
          this.recentErrors += 1;
          if (this.recentErrors >= this.opts.degradedAfterErrors) {
            this.healthState = "degraded";
          }
          fireAttempt({
            attemptIndex: attempt,
            status: "error",
            startedAt: attemptStart,
            endedAt: attemptEnd,
            errorType: extractErrorCode(err) ?? "error",
            errorMessage:
              err instanceof Error ? err.message : String(err),
          });
          this.emit({
            providerId: this.providerId,
            model,
            status: "error",
            retryCount: attempt,
            latencyMs: attemptEnd - start,
            errorCode: extractErrorCode(err),
            timestamp: attemptEnd,
          });
          throw err;
        }
      }
    } finally {
      if (opts.abortSignal && onAbortRelease) {
        opts.abortSignal.removeEventListener("abort", onAbortRelease);
      }
      release();
    }
  }

  private slotWatchdogGraceMs(): number {
    const g = Number(process.env.RATE_LIMIT_SLOT_WATCHDOG_GRACE_MS);
    return Number.isFinite(g) && g >= 0 ? g : 5_000;
  }

  // How long a granted slot may be held before the orphan watchdog reclaims it.
  //
  // A slot must never legitimately outlive its attempt deadline (every task is
  // withTimeout-bounded to exactly that deadline). If it does, the holder was
  // orphaned — e.g. a dev-server recompile / HMR severed an in-process
  // background task before its release ran. The watchdog must therefore fire:
  //   - AFTER a legit call's own release (deadline) — so we never reclaim a
  //     healthy in-flight slot → hence `deadline + grace`;
  //   - BEFORE a *fresh* queued call hits its own slot-acquire deadline — so a
  //     leaked slot can't make every future call wait out the full timeout and
  //     fail with "slot-acquire timed out". Since the orphan's deadline is in
  //     the past relative to a new call, `deadline + grace` clears comfortably.
  // The legacy `max(120s, providerTimeout*2)` was LONGER than the acquire
  // deadline (= providerTimeout), so leaked slots were never reclaimed in time.
  private slotWatchdogMs(deadlineMs?: number): number {
    const grace = this.slotWatchdogGraceMs();
    if (deadlineMs !== undefined) {
      return Math.max(0, deadlineMs - Date.now()) + grace;
    }
    // No deadline supplied → bound by the provider timeout (still far below the
    // legacy 2× value) so an orphan is reclaimed promptly.
    const base = Number(process.env.PROVIDER_TIMEOUT_MS);
    const provider = Number.isFinite(base) && base > 0 ? base : 90_000;
    return provider + grace;
  }

  // Take a slot NOW: increment inFlight, arm the orphan watchdog (sized to the
  // caller's attempt deadline), and return an idempotent release that clears
  // the watchdog and pumps the queue.
  private grantSlot(deadlineMs?: number): () => void {
    this.inFlight += 1;
    let released = false;
    let watchdog: ReturnType<typeof setTimeout>;
    const release = () => {
      if (released) return;
      released = true;
      clearTimeout(watchdog);
      this.inFlight = Math.max(0, this.inFlight - 1);
      this.pumpQueue();
    };
    watchdog = setTimeout(release, this.slotWatchdogMs(deadlineMs));
    // Don't let the orphan-reclaim timer keep the process/event loop alive.
    (watchdog as unknown as { unref?: () => void }).unref?.();
    return release;
  }

  private acquireSlot(
    deadlineMs?: number,
    signal?: AbortSignal,
  ): Promise<() => void> {
    if (this.inFlight < this.opts.maxConcurrent) {
      return Promise.resolve(this.grantSlot(deadlineMs));
    }
    if (signal?.aborted) {
      return Promise.reject(new Error("aborted before slot acquisition"));
    }
    return new Promise<() => void>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let onAbort: (() => void) | undefined;
      const cleanup = () => {
        if (timer) clearTimeout(timer);
        if (onAbort && signal) signal.removeEventListener("abort", onAbort);
      };

      const waiter: Waiter = {
        cancelled: false,
        grant: () => {
          cleanup();
          resolve(this.grantSlot(deadlineMs));
        },
        cancel: (e: unknown) => {
          if (waiter.cancelled) return;
          waiter.cancelled = true;
          cleanup();
          reject(e);
        },
      };
      this.queue.push(waiter);

      if (signal) {
        onAbort = () => waiter.cancel(new Error("aborted while queued"));
        signal.addEventListener("abort", onAbort, { once: true });
      }
      if (deadlineMs !== undefined) {
        const ms = Math.max(0, deadlineMs - Date.now());
        timer = setTimeout(
          () =>
            waiter.cancel(
              new TimeoutError(ms, `${this.providerId}:slot-acquire`),
            ),
          ms,
        );
      }
    });
  }

  // Grant the next non-cancelled waiter a slot when capacity frees up.
  private pumpQueue(): void {
    if (this.inFlight >= this.opts.maxConcurrent) return;
    let next = this.queue.shift();
    while (next && next.cancelled) next = this.queue.shift();
    if (next) next.grant();
  }

  /**
   * Reject all queued waiters with rate_limited. Called when a 429 arrives
   * and the cooldown is tripped — keeping waiters parked would freeze the
   * caller's `Promise.allSettled`. We prefer to fail them fast so the
   * orchestrator records each as rate_limited and continues with the
   * providers that are still healthy.
   */
  private rejectQueuedWithRateLimit(retryAfterMs: number) {
    const waiters = this.queue.slice();
    this.queue.length = 0;
    for (const w of waiters) {
      w.cancel(
        this.buildRateLimitedError(
          `Provider ${this.providerId} entered cooldown while queued`,
          retryAfterMs,
        ),
      );
    }
  }

  private tripCooldown(retryAfterMs: number) {
    this.cooldownUntil = Math.max(
      this.cooldownUntil,
      Date.now() + Math.max(retryAfterMs, this.opts.cooldownMs),
    );
    this.healthState = "rate_limited";
    this.rejectQueuedWithRateLimit(retryAfterMs);
  }

  private computeBackoff(attempt: number): number {
    const base = 800;
    const exp = Math.min(this.opts.backoffMaxMs, base * 2 ** attempt);
    return Math.floor(exp / 2 + Math.random() * (exp / 2));
  }

  /**
   * Cap `requested` so we never sleep past `deadlineMs`. Returns 0 when
   * even a minimal sleep would push us past the deadline (caller treats
   * that as "give up").
   */
  private capWaitByDeadline(
    requested: number,
    deadlineMs: number | undefined,
  ): number {
    if (deadlineMs === undefined) return Math.max(0, requested);
    // 50 ms safety margin so the orchestrator gets a chance to bail
    // cleanly after we resolve.
    const remaining = deadlineMs - Date.now() - 50;
    if (remaining <= 0) return 0;
    return Math.max(0, Math.min(requested, remaining));
  }

  /**
   * Sleep that respects an external AbortSignal so an upstream timeout can
   * break us out instantly. Rejects with "aborted" if the signal fires (or
   * was already aborted before we entered).
   */
  private abortableSleep(
    ms: number,
    signal?: AbortSignal,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new Error("aborted"));
        return;
      }
      const handle = setTimeout(resolve, ms);
      signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(handle);
          reject(new Error("aborted"));
        },
        { once: true },
      );
    });
  }

  private buildRateLimitedError(
    msg: string,
    retryAfterMs?: number,
  ): RateLimitedError {
    const e = new Error(msg) as RateLimitedError;
    e.rateLimited = true;
    e.providerId = this.providerId;
    if (retryAfterMs !== undefined) e.retryAfterMs = retryAfterMs;
    return e;
  }
}

// ───────────────────────── helpers ──────────────────────────────────────

function extractErrorCode(err: unknown): string | undefined {
  if (!err || typeof err !== "object") return undefined;
  const e = err as Record<string, unknown>;
  return (
    (typeof e.code === "string" && e.code) ||
    (typeof e.status === "number" && `http_${e.status}`) ||
    undefined
  );
}

/**
 * Construct a RateLimitedError for use inside a provider adapter when a
 * provider SDK signals 429 / quota / Retry-After.
 *
 *   throw markRateLimited(providerId, { retryAfterMs, message })
 */
export function markRateLimited(
  providerId: ProviderId,
  args: { retryAfterMs?: number; message?: string } = {},
): RateLimitedError {
  const e = new Error(args.message ?? "rate limited") as RateLimitedError;
  e.rateLimited = true;
  e.providerId = providerId;
  if (args.retryAfterMs !== undefined) e.retryAfterMs = args.retryAfterMs;
  return e;
}

// ───────────────────────── registry (singleton) ─────────────────────────

class RateLimiterRegistry {
  private limiters = new Map<ProviderId, SingleProviderLimiter>();

  get(providerId: ProviderId): SingleProviderLimiter {
    let l = this.limiters.get(providerId);
    if (!l) {
      l = new SingleProviderLimiter(providerId, readEnvOptions(providerId));
      this.limiters.set(providerId, l);
    }
    return l;
  }

  snapshot(): Array<{
    providerId: ProviderId;
    health: ProviderHealth;
    cooldownMs: number;
    inFlight: number;
    queueLength: number;
    maxConcurrent: number;
  }> {
    return Array.from(this.limiters.values()).map((l) => ({
      providerId: l.providerId,
      health: l.health,
      cooldownMs: l.remainingCooldownMs(),
      inFlight: l.inFlightCount,
      queueLength: l.queueLength,
      maxConcurrent: l.maxConcurrent,
    }));
  }

  resetAll(): void {
    for (const l of this.limiters.values()) l.reset();
  }
}

function readEnvOptions(providerId: ProviderId): Partial<RateLimiterOptions> {
  const upper = providerId.toUpperCase();
  // CRITICAL: only emit keys whose env var is set to a finite number. Emitting
  // an explicit `undefined` (the old behavior) clobbered the constructor
  // defaults via `{ ...DEFAULT, ...opts }`, leaving e.g. `maxConcurrent =
  // undefined`. Then `inFlight < undefined` is always false, so EVERY call —
  // starting with the very first (inFlight 0) — skips the free-slot path,
  // queues, and fails at the slot-acquire deadline with
  // "<provider>:slot-acquire timed out after 90000ms" before any API call.
  // That is the outage this guards against when RATE_LIMIT_*_MAX_CONCURRENT is
  // left unset in the environment.
  const out: Partial<RateLimiterOptions> = {};
  const set = (key: keyof RateLimiterOptions, envKey: string) => {
    const v = process.env[envKey];
    if (v === undefined) return;
    const num = Number(v);
    if (Number.isFinite(num)) out[key] = num;
  };
  set("maxConcurrent", `RATE_LIMIT_${upper}_MAX_CONCURRENT`);
  set("backoffMaxMs", `RATE_LIMIT_${upper}_BACKOFF_MAX_MS`);
  set("maxRetries", `RATE_LIMIT_${upper}_MAX_RETRIES`);
  set("cooldownMs", `RATE_LIMIT_${upper}_COOLDOWN_MS`);
  return out;
}

const KEY = "__ai_coating_council_rate_limiter__";
function globalRegistry(): RateLimiterRegistry {
  const g = globalThis as Record<string, unknown>;
  if (!g[KEY]) g[KEY] = new RateLimiterRegistry();
  return g[KEY] as RateLimiterRegistry;
}

export function getRateLimiter(providerId: ProviderId): SingleProviderLimiter {
  return globalRegistry().get(providerId);
}

export function snapshotProviderHealth() {
  return globalRegistry().snapshot();
}

/**
 * Dev/admin: clear all per-provider limiter state (inFlight, queue, cooldown)
 * so a stuck / saturated provider self-heals without a process restart. Unlike
 * `__resetRateLimitersForTest`, this keeps the SAME limiter instances (and
 * their env-derived options) — it only zeroes the transient counters. Gate any
 * caller behind admin auth.
 */
export function resetRateLimiters(): void {
  globalRegistry().resetAll();
}

/**
 * Test-only: clear the cached registry so subsequent `getRateLimiter()` calls
 * re-read env. Do NOT call from production code.
 */
export function __resetRateLimitersForTest(): void {
  const g = globalThis as Record<string, unknown>;
  delete g[KEY];
}

export { SingleProviderLimiter };
