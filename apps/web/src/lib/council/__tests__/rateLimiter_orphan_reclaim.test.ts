// Regression for the "*:slot-acquire timed out after 90000ms" outage.
//
// Root cause: leaked concurrency slots (a dev-server recompile / HMR severed an
// in-process background task before its release ran) were only reclaimed by an
// orphan watchdog set to max(120s, providerTimeout*2) = 180s — LONGER than the
// 90s slot-acquire deadline. So every fresh call queued behind a leaked slot
// waited out its full deadline and failed before the watchdog ever fired.
//
// Fixes under test:
//   #2 watchdog derived from the attempt deadline (deadline + small grace), so
//      a leaked slot is reclaimed before a new call hits its own deadline.
//   #3 cancellation/timeout releases the slot immediately, even if the task
//      ignores its abort signal and runs on in the background.
//   #1 diagnostics snapshot exposes inFlight / queueLength / maxConcurrent.
//   #4 resetRateLimiters() safely clears stuck state.

import { describe, it, expect, afterEach } from "vitest";
import {
  SingleProviderLimiter,
  getRateLimiter,
  snapshotProviderHealth,
  resetRateLimiters,
  __resetRateLimitersForTest,
} from "../rateLimiter";

const tick = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
  delete process.env.RATE_LIMIT_SLOT_WATCHDOG_GRACE_MS;
  __resetRateLimitersForTest();
});

describe("rate limiter — orphan slot reclaim (#2)", () => {
  it("reclaims a stale occupied slot BEFORE a new call reaches its providerTimeout deadline", async () => {
    // Small grace so the orphan's short deadline drives a short watchdog.
    process.env.RATE_LIMIT_SLOT_WATCHDOG_GRACE_MS = "20";
    const lim = new SingleProviderLimiter("openai", {
      maxConcurrent: 1,
      maxRetries: 0,
    });

    // Orphan: takes the only slot and NEVER releases (leaked in-flight call).
    // Its short attempt deadline (now+40ms) → watchdog ≈ 60ms.
    void lim.run(() => new Promise<string>(() => {}), "m1", {
      deadlineMs: Date.now() + 40,
    });
    await tick();

    // A fresh call whose own deadline mimics providerTimeout (long). It must be
    // granted via the watchdog reclaim — NOT wait out its 3s deadline. Pre-fix,
    // the 180s watchdog left this call to time out and reject.
    const t0 = Date.now();
    const value = await lim.run(() => Promise.resolve("ok"), "m2", {
      deadlineMs: Date.now() + 3_000,
    });
    expect(value).toBe("ok");
    expect(Date.now() - t0).toBeLessThan(1_500);
  });
});

describe("rate limiter — env defaults are not clobbered (outage root cause)", () => {
  it("grants the FIRST call immediately when RATE_LIMIT_*_MAX_CONCURRENT is unset", async () => {
    // Reproduces the production outage: with no per-provider concurrency env,
    // readEnvOptions used to emit `maxConcurrent: undefined`, clobbering the
    // default (2). `0 < undefined` is false, so the first call queued and timed
    // out at the slot-acquire deadline before any API call. The fixed limiter
    // must fall back to the default and run the call right away.
    __resetRateLimitersForTest();
    delete process.env.RATE_LIMIT_OPENAI_MAX_CONCURRENT;
    delete process.env.RATE_LIMIT_OPENAI_BACKOFF_MAX_MS;
    delete process.env.RATE_LIMIT_OPENAI_MAX_RETRIES;
    delete process.env.RATE_LIMIT_OPENAI_COOLDOWN_MS;

    const lim = getRateLimiter("openai");
    expect(lim.maxConcurrent).toBe(2); // DEFAULT_RATE_LIMITER_OPTIONS

    const t0 = Date.now();
    const value = await lim.run(() => Promise.resolve("first-call-ok"), "m", {
      // A real session passes providerTimeout here; the call must NOT wait for it.
      deadlineMs: Date.now() + 90_000,
    });
    expect(value).toBe("first-call-ok");
    expect(Date.now() - t0).toBeLessThan(500);
  });
});

describe("rate limiter — prompt release on cancel/timeout (#3)", () => {
  it("frees the slot immediately when a call is aborted, even if the task ignores abort", async () => {
    const lim = new SingleProviderLimiter("gemini", {
      maxConcurrent: 1,
      maxRetries: 0,
    });

    const controller = new AbortController();
    // First holder IGNORES its abort signal and runs forever (misbehaving
    // provider / fire-and-forget straggler).
    void lim.run(() => new Promise<string>(() => {}), "m1", {
      abortSignal: controller.signal,
    });
    await tick();

    // Queue a second call behind the held slot.
    const t0 = Date.now();
    const p2 = lim.run(() => Promise.resolve("second"), "m2", {
      deadlineMs: Date.now() + 3_000,
    });

    // Cancel the first → its slot must free at once so the waiter proceeds,
    // long before the zombie task would ever end.
    controller.abort();

    await expect(p2).resolves.toBe("second");
    expect(Date.now() - t0).toBeLessThan(1_000);
  });

  it("does not change the error classification of a timed-out task", async () => {
    // withTimeout aborts the SAME controller it passes as abortSignal. The
    // early slot-release must NOT swallow / rewrite the task's own rejection.
    const lim = new SingleProviderLimiter("anthropic", {
      maxConcurrent: 1,
      maxRetries: 0,
    });
    const controller = new AbortController();
    const boom = new Error("real task failure");
    await expect(
      lim.run(
        () =>
          new Promise<string>((_resolve, reject) => {
            // Abort (as withTimeout would) then reject with the real error.
            controller.abort();
            reject(boom);
          }),
        "m",
        { abortSignal: controller.signal },
      ),
    ).rejects.toBe(boom);
  });
});

describe("rate limiter — diagnostics snapshot (#1)", () => {
  it("reports inFlight, queueLength, maxConcurrent and cooldownMs per provider", async () => {
    __resetRateLimitersForTest();
    process.env.RATE_LIMIT_OPENAI_MAX_CONCURRENT = "1";
    const lim = getRateLimiter("openai");

    // Occupy the slot and queue a second waiter.
    void lim.run(() => new Promise<string>(() => {}), "m1");
    await tick();
    void lim.run(() => Promise.resolve("x"), "m2", {
      deadlineMs: Date.now() + 5_000,
    });
    await tick();

    const snap = snapshotProviderHealth();
    const openai = snap.find((s) => s.providerId === "openai");
    expect(openai).toBeDefined();
    expect(openai!.maxConcurrent).toBe(1);
    expect(openai!.inFlight).toBe(1);
    expect(openai!.queueLength).toBe(1);
    expect(typeof openai!.cooldownMs).toBe("number");

    delete process.env.RATE_LIMIT_OPENAI_MAX_CONCURRENT;
  });
});

describe("rate limiter — safe reset (#4)", () => {
  it("clears stuck inFlight/queue/cooldown and rejects queued waiters", async () => {
    __resetRateLimitersForTest();
    process.env.RATE_LIMIT_GEMINI_MAX_CONCURRENT = "1";
    const lim = getRateLimiter("gemini");

    void lim.run(() => new Promise<string>(() => {}), "m1"); // leak a slot
    await tick();
    const queued = lim.run(() => Promise.resolve("x"), "m2", {
      deadlineMs: Date.now() + 5_000,
    });
    await tick();

    let before = snapshotProviderHealth().find((s) => s.providerId === "gemini");
    expect(before!.inFlight).toBe(1);
    expect(before!.queueLength).toBe(1);

    resetRateLimiters();

    // Queued waiter fails fast rather than hanging on the zeroed counter.
    await expect(queued).rejects.toBeInstanceOf(Error);

    const after = snapshotProviderHealth().find((s) => s.providerId === "gemini");
    expect(after!.inFlight).toBe(0);
    expect(after!.queueLength).toBe(0);
    expect(after!.cooldownMs).toBe(0);
    expect(after!.health).toBe("healthy");

    delete process.env.RATE_LIMIT_GEMINI_MAX_CONCURRENT;
  });
});
