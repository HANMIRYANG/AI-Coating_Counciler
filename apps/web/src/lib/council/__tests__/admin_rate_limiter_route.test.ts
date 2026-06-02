// /api/admin/rate-limiter — diagnostics + safe reset endpoint (#4).

import { describe, it, expect, afterEach } from "vitest";
import {
  getRateLimiter,
  __resetRateLimitersForTest,
} from "../rateLimiter";
import { GET, POST } from "@/app/api/admin/rate-limiter/route";

const tick = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
  delete process.env.ADMIN_DEBUG_TOKEN;
  __resetRateLimitersForTest();
});

describe("GET /api/admin/rate-limiter", () => {
  it("returns the per-provider diagnostics snapshot in dev (no token set)", async () => {
    delete process.env.ADMIN_DEBUG_TOKEN;
    __resetRateLimitersForTest();
    getRateLimiter("openai"); // materialize a limiter so it appears in snapshot

    const res = await GET(new Request("http://localhost/api/admin/rate-limiter"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.providerHealth)).toBe(true);
    const openai = body.providerHealth.find(
      (p: { providerId: string }) => p.providerId === "openai",
    );
    expect(openai).toMatchObject({
      providerId: "openai",
      inFlight: expect.any(Number),
      queueLength: expect.any(Number),
      maxConcurrent: expect.any(Number),
      cooldownMs: expect.any(Number),
    });
  });

  it("403s when ADMIN_DEBUG_TOKEN is set but the header is missing/wrong", async () => {
    process.env.ADMIN_DEBUG_TOKEN = "s3cret";
    const res = await GET(new Request("http://localhost/api/admin/rate-limiter"));
    expect(res.status).toBe(403);

    const ok = await GET(
      new Request("http://localhost/api/admin/rate-limiter", {
        headers: { "x-admin-debug-token": "s3cret" },
      }),
    );
    expect(ok.status).toBe(200);
  });
});

describe("POST /api/admin/rate-limiter", () => {
  it("clears stuck limiter state and returns the post-reset snapshot", async () => {
    delete process.env.ADMIN_DEBUG_TOKEN;
    __resetRateLimitersForTest();
    process.env.RATE_LIMIT_OPENAI_MAX_CONCURRENT = "1";
    const lim = getRateLimiter("openai");
    void lim.run(() => new Promise<string>(() => {}), "m1"); // leak a slot
    await tick();

    const res = await POST(
      new Request("http://localhost/api/admin/rate-limiter", { method: "POST" }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    const openai = body.providerHealth.find(
      (p: { providerId: string }) => p.providerId === "openai",
    );
    expect(openai.inFlight).toBe(0);

    delete process.env.RATE_LIMIT_OPENAI_MAX_CONCURRENT;
  });

  it("403s a reset in production without a token", async () => {
    delete process.env.ADMIN_DEBUG_TOKEN;
    const prev = process.env.NODE_ENV;
    // @ts-expect-error -- override for the test
    process.env.NODE_ENV = "production";
    try {
      const res = await POST(
        new Request("http://localhost/api/admin/rate-limiter", {
          method: "POST",
        }),
      );
      expect(res.status).toBe(403);
    } finally {
      // @ts-expect-error -- restore
      process.env.NODE_ENV = prev;
    }
  });
});
