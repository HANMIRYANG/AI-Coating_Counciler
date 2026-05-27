import { describe, it, expect } from "vitest";
import { TimeoutError, sleep, withTimeout } from "../timeout";

describe("withTimeout", () => {
  it("resolves when work completes before deadline", async () => {
    const r = await withTimeout(
      async (signal) => {
        await sleep(20, signal);
        return 42;
      },
      { timeoutMs: 200, label: "ok" },
    );
    expect(r).toBe(42);
  });

  it("rejects with TimeoutError when work exceeds deadline", async () => {
    await expect(
      withTimeout(
        async (signal) => {
          await sleep(500, signal);
          return "should not happen";
        },
        { timeoutMs: 50, label: "slow" },
      ),
    ).rejects.toBeInstanceOf(TimeoutError);
  });

  it("aborts the underlying work on timeout", async () => {
    let aborted = false;
    await withTimeout(
      async (signal) => {
        signal.addEventListener("abort", () => {
          aborted = true;
        });
        try {
          await sleep(500, signal);
        } catch {
          /* expected */
        }
      },
      { timeoutMs: 50, label: "abort" },
    ).catch(() => {
      /* swallow timeout */
    });

    // Give the abort listener a tick to run.
    await sleep(10);
    expect(aborted).toBe(true);
  });
});
