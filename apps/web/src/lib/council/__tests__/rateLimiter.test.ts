import { describe, it, expect } from "vitest";
import {
  SingleProviderLimiter,
  markRateLimited,
  isRateLimitedError,
} from "../rateLimiter";

describe("SingleProviderLimiter", () => {
  it("caps concurrency at maxConcurrent", async () => {
    const limiter = new SingleProviderLimiter("openai", {
      maxConcurrent: 2,
      maxRetries: 0,
      backoffMaxMs: 200,
      cooldownMs: 200,
      degradedAfterErrors: 99,
    });

    let inflight = 0;
    let peak = 0;

    const tasks = Array.from({ length: 5 }, (_, i) =>
      limiter.run(async () => {
        inflight += 1;
        peak = Math.max(peak, inflight);
        await new Promise((r) => setTimeout(r, 30));
        inflight -= 1;
        return i;
      }, "gpt-5.5"),
    );

    const results = await Promise.all(tasks);
    expect(results.length).toBe(5);
    expect(peak).toBeLessThanOrEqual(2);
  });

  it("retries on rate-limited error up to maxRetries, then trips cooldown", async () => {
    const limiter = new SingleProviderLimiter("anthropic", {
      maxConcurrent: 1,
      maxRetries: 2,
      backoffMaxMs: 30,
      cooldownMs: 200,
      degradedAfterErrors: 99,
    });

    let attempts = 0;
    await expect(
      limiter.run(async () => {
        attempts += 1;
        throw markRateLimited("anthropic", { retryAfterMs: 10 });
      }, "claude-sonnet-4-6"),
    ).rejects.toSatisfy(isRateLimitedError);

    expect(attempts).toBeGreaterThanOrEqual(2);
    expect(limiter.health).toBe("rate_limited");
  });

  it("fails fast with rate_limited when called during cooldown", async () => {
    const limiter = new SingleProviderLimiter("gemini", {
      maxConcurrent: 1,
      maxRetries: 0,
      backoffMaxMs: 30,
      cooldownMs: 100,
      degradedAfterErrors: 99,
    });

    // Trip cooldown once.
    await limiter
      .run(async () => {
        throw markRateLimited("gemini", { retryAfterMs: 10 });
      }, "gemini-3.5-flash")
      .catch(() => {});

    // Next call should fail fast (not wait).
    const t0 = Date.now();
    await expect(
      limiter.run(async () => "ok", "gemini-3.5-flash"),
    ).rejects.toSatisfy(isRateLimitedError);
    expect(Date.now() - t0).toBeLessThan(50);
  });

  it("recovers from cooldown after the window elapses", async () => {
    const limiter = new SingleProviderLimiter("openai", {
      maxConcurrent: 1,
      maxRetries: 0,
      backoffMaxMs: 30,
      cooldownMs: 60,
      degradedAfterErrors: 99,
    });
    await limiter
      .run(async () => {
        throw markRateLimited("openai", { retryAfterMs: 10 });
      }, "gpt-5.5")
      .catch(() => {});
    await new Promise((r) => setTimeout(r, 100));

    const v = await limiter.run(async () => "recovered", "gpt-5.5");
    expect(v).toBe("recovered");
    expect(limiter.health).toBe("healthy");
  });

  it("caps a long Retry-After by the deadlineMs and trips cooldown when budget runs out", async () => {
    // maxRetries=2, retryAfterMs=5000, deadlineMs is only ~200ms away —
    // limiter must not sleep past the deadline. Total elapsed should stay
    // under ~400ms (deadline + small slack).
    const limiter = new SingleProviderLimiter("openai", {
      maxConcurrent: 1,
      maxRetries: 2,
      backoffMaxMs: 50,
      cooldownMs: 100,
      degradedAfterErrors: 99,
    });

    const t0 = Date.now();
    await expect(
      limiter.run(
        async () => {
          throw markRateLimited("openai", { retryAfterMs: 5_000 });
        },
        "gpt-5.5",
        { deadlineMs: t0 + 200 },
      ),
    ).rejects.toSatisfy(isRateLimitedError);

    expect(Date.now() - t0).toBeLessThan(400);
    expect(limiter.health).toBe("rate_limited");
  });

  it("breaks out of 429 sleep when abortSignal fires", async () => {
    const limiter = new SingleProviderLimiter("openai", {
      maxConcurrent: 1,
      maxRetries: 5,
      backoffMaxMs: 2_000,
      cooldownMs: 100,
      degradedAfterErrors: 99,
    });
    const controller = new AbortController();

    const t0 = Date.now();
    const p = limiter.run(
      async () => {
        throw markRateLimited("openai", { retryAfterMs: 3_000 });
      },
      "gpt-5.5",
      { abortSignal: controller.signal },
    );

    // Abort while limiter is sleeping inside its retry backoff.
    setTimeout(() => controller.abort(), 50);
    await expect(p).rejects.toSatisfy(isRateLimitedError);
    expect(Date.now() - t0).toBeLessThan(300);
  });

  it("emits a metric on every call", async () => {
    const limiter = new SingleProviderLimiter("openai", {
      maxConcurrent: 1,
      maxRetries: 0,
      backoffMaxMs: 30,
      cooldownMs: 200,
      degradedAfterErrors: 99,
    });

    const metrics: Array<Record<string, unknown>> = [];
    limiter.onMetric((m) => metrics.push(m));

    await limiter.run(async () => "ok", "gpt-5.5");
    await limiter
      .run(async () => {
        throw markRateLimited("openai", { retryAfterMs: 5 });
      }, "gpt-5.5")
      .catch(() => {});

    expect(metrics.length).toBeGreaterThanOrEqual(2);
    expect(metrics.some((m) => m.status === "success")).toBe(true);
    expect(metrics.some((m) => m.status === "rate_limited")).toBe(true);
  });
});
