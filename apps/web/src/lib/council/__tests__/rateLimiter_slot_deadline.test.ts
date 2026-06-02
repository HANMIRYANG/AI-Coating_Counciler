import { describe, it, expect } from "vitest";
import { SingleProviderLimiter } from "../rateLimiter";

// Regression: a leaked / saturated concurrency slot must NOT hang new calls
// forever. Slot acquisition now respects the per-call deadline so the call
// fails fast (and the orchestrator records it + proceeds) instead of bypassing
// every timeout. See fix for the 30-min stuck-session bug.

describe("SingleProviderLimiter — slot acquisition deadline", () => {
  it("rejects a queued call at its deadline when the only slot is stuck", async () => {
    const lim = new SingleProviderLimiter("openai", {
      maxConcurrent: 1,
      maxRetries: 0,
    });

    // Occupy the only slot with a task that never resolves (a leaked/hung
    // in-flight call).
    let stuckStarted = false;
    const stuck = lim.run(() => {
      stuckStarted = true;
      return new Promise<string>(() => {}); // never resolves
    }, "m1");
    void stuck; // intentionally never settles

    await new Promise((r) => setTimeout(r, 0));
    expect(stuckStarted).toBe(true);

    const t0 = Date.now();
    await expect(
      lim.run(() => Promise.resolve("ok"), "m2", {
        deadlineMs: Date.now() + 40,
      }),
    ).rejects.toBeInstanceOf(Error);
    expect(Date.now() - t0).toBeLessThan(2000); // bounded, not infinite
  });

  it("grants a queued slot once the holder releases", async () => {
    const lim = new SingleProviderLimiter("gemini", {
      maxConcurrent: 1,
      maxRetries: 0,
    });

    let release!: () => void;
    const held = new Promise<void>((r) => {
      release = r;
    });
    const p1 = lim.run(() => held.then(() => "first"), "m");
    await new Promise((r) => setTimeout(r, 0));

    const p2 = lim.run(() => Promise.resolve("second"), "m", {
      deadlineMs: Date.now() + 1000,
    });

    release(); // holder finishes → queued waiter should be granted
    await expect(p1).resolves.toBe("first");
    await expect(p2).resolves.toBe("second");
  });

  it("rejects immediately when the abort signal is already aborted", async () => {
    const lim = new SingleProviderLimiter("anthropic", {
      maxConcurrent: 1,
      maxRetries: 0,
    });
    const stuck = lim.run(() => new Promise<string>(() => {}), "m1");
    void stuck;
    await new Promise((r) => setTimeout(r, 0));

    const controller = new AbortController();
    controller.abort();
    await expect(
      lim.run(() => Promise.resolve("x"), "m2", {
        abortSignal: controller.signal,
      }),
    ).rejects.toBeInstanceOf(Error);
  });
});
