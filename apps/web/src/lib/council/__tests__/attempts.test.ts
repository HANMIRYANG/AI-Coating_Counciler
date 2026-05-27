// Attempt-log + debug-endpoint + English keyword regression tests.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MockProviderAdapter } from "../providers/mock";
import {
  CouncilOrchestrator,
  defaultTimingConfig,
  type TimingConfig,
} from "../orchestrator";
import { getSessionStore, newSessionId, type SessionRecord } from "../store";
import type { ProviderId, SessionStatus } from "../types";
import { __resetRateLimitersForTest } from "../rateLimiter";
import { DEFAULT_MODELS, inferAccuracyMode } from "../models";
import { SchemaValidationError } from "../prompts";

for (const id of ["OPENAI", "ANTHROPIC", "GEMINI"]) {
  process.env[`RATE_LIMIT_${id}_MAX_CONCURRENT`] = "3";
  process.env[`RATE_LIMIT_${id}_BACKOFF_MAX_MS`] = "20";
  process.env[`RATE_LIMIT_${id}_MAX_RETRIES`] = "0";
  process.env[`RATE_LIMIT_${id}_COOLDOWN_MS`] = "30";
}

beforeEach(() => {
  __resetRateLimitersForTest();
});

// `process.env.NODE_ENV` is typed read-only on @types/node 20+. Cast to a
// plain mutable record so the test can flip NODE_ENV between cases without
// pulling in vi.stubEnv.
const mutableEnv = process.env as Record<string, string | undefined>;

afterEach(() => {
  delete mutableEnv.ADMIN_DEBUG_TOKEN;
  delete mutableEnv.NODE_ENV;
});

function fastTiming(overrides: Partial<TimingConfig> = {}): TimingConfig {
  return {
    ...defaultTimingConfig(),
    providerTimeoutMs: 200,
    roundTimeoutMs: 400,
    synthesisTimeoutMs: 200,
    sessionTimeoutMs: 2_000,
    maxRetries: 0,
    minOpinionsForMeeting: 2,
    minCritiquesForSynthesis: 2,
    ...overrides,
  };
}

function newSession(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: newSessionId(),
    userPrompt:
      "HE-850A 방사방열 코팅제를 EV 배터리팩 외장재에 적용 가능한지 답변을 만들어줘.",
    taskType: "technical_review",
    evidenceMode: "ai_only",
    status: "created",
    createdAt: Date.now(),
    startedAt: Date.now(),
    deadlineAt: Date.now() + 5_000,
    providerCalls: [],
    attempts: [],
    opinions: [],
    critiques: [],
    ...overrides,
  };
}

type FailureMode = "ok" | "fail" | "hang" | "rate_limit" | "retryable_5xx";

function registry(opts: {
  failMode?: Partial<Record<ProviderId, FailureMode>>;
}) {
  const mk = (id: ProviderId) =>
    new MockProviderAdapter(id, {
      delayMs: 10,
      failureMode: opts.failMode?.[id] ?? "ok",
      displayName: `${id} (test)`,
      model: `${id}-test`,
    });
  return {
    gemini: mk("gemini"),
    anthropic: mk("anthropic"),
    openai: mk("openai"),
  };
}

// ───────────────────────── attempt log ─────────────────────────────────

describe("Attempt log — every model hop is recorded", () => {
  it("OpenAI default-mode 429 records all three hops (primary → fallback → fastFallback)", async () => {
    const store = getSessionStore();
    const sess = newSession({
      userPrompt: "색상 카탈로그 정리", // benign → default chain
      taskType: "customer_reply",
    });
    await store.create(sess);
    const reg = registry({ failMode: { openai: "rate_limit" } });
    const o = new CouncilOrchestrator(reg, fastTiming({}), store);
    await o.run(sess.id);

    const final = await store.get(sess.id);
    const openaiInitial = (final?.attempts ?? []).filter(
      (a) => a.providerId === "openai" && a.round === "initial",
    );

    const models = openaiInitial.map((a) => a.model);
    expect(models).toEqual([
      DEFAULT_MODELS.openai.primary,
      DEFAULT_MODELS.openai.fallback!,
      DEFAULT_MODELS.openai.fastFallback,
    ]);

    // Every attempt should be marked rate_limited with retryAfterMs.
    for (const a of openaiInitial) {
      expect(a.status).toBe("rate_limited");
      expect(a.rateLimited).toBe(true);
      expect(a.retryAfterMs).toBeGreaterThanOrEqual(0);
      expect(a.startedAt).toBeGreaterThan(0);
      expect(a.endedAt).toBeGreaterThanOrEqual(a.startedAt);
      expect(a.latencyMs).toBeGreaterThanOrEqual(0);
    }

    // Chain indices are sequential.
    expect(openaiInitial.map((a) => a.chainIndex)).toEqual([0, 1, 2]);
  });

  it("Anthropic high-accuracy 429 records [highAccuracy, primary, fastFallback]", async () => {
    const store = getSessionStore();
    const sess = newSession({
      userPrompt: "배터리 화재 방지 검토", // → high_accuracy
    });
    await store.create(sess);
    const reg = registry({ failMode: { anthropic: "rate_limit" } });
    const o = new CouncilOrchestrator(reg, fastTiming({}), store);
    await o.run(sess.id);

    const final = await store.get(sess.id);
    const anthropic = (final?.attempts ?? []).filter(
      (a) => a.providerId === "anthropic" && a.round === "initial",
    );

    expect(anthropic.map((a) => a.model)).toEqual([
      DEFAULT_MODELS.anthropic.highAccuracy,
      DEFAULT_MODELS.anthropic.primary,
      DEFAULT_MODELS.anthropic.fastFallback,
    ]);
    expect(anthropic.every((a) => a.status === "rate_limited")).toBe(true);
  });

  it("Gemini high-accuracy 429 records [highAccuracy, primary, fastFallback]", async () => {
    const store = getSessionStore();
    const sess = newSession({
      userPrompt: "배터리 화재 방지 검토",
    });
    await store.create(sess);
    const reg = registry({ failMode: { gemini: "rate_limit" } });
    const o = new CouncilOrchestrator(reg, fastTiming({}), store);
    await o.run(sess.id);

    const final = await store.get(sess.id);
    const gemini = (final?.attempts ?? []).filter(
      (a) => a.providerId === "gemini" && a.round === "initial",
    );
    expect(gemini.map((a) => a.model)).toEqual([
      DEFAULT_MODELS.gemini.highAccuracy,
      DEFAULT_MODELS.gemini.primary,
      DEFAULT_MODELS.gemini.fastFallback,
    ]);
  });

  it("records attempts for all three rounds (initial / critique / synthesis)", async () => {
    const store = getSessionStore();
    const sess = newSession({
      userPrompt: "색상 카탈로그 정리",
      taskType: "customer_reply",
    });
    await store.create(sess);
    const reg = registry({});
    const o = new CouncilOrchestrator(reg, fastTiming({}), store);
    await o.run(sess.id);

    const final = await store.get(sess.id);
    const rounds = new Set((final?.attempts ?? []).map((a) => a.round));
    expect(rounds.has("initial")).toBe(true);
    expect(rounds.has("critique")).toBe(true);
    expect(rounds.has("synthesis")).toBe(true);
  });
});

// ───────────────────────── debug endpoint auth ─────────────────────────

describe("Debug endpoint — admin token gating", () => {
  it("omits attempts + rawResponse from the public response", async () => {
    const store = getSessionStore();
    const sess = newSession({});
    await store.create(sess);

    const reg = registry({});
    reg.openai.generateInitialOpinion = async () => {
      throw new SchemaValidationError(
        "providerId: invalid",
        '{"providerId":"unknown"}',
        { providerId: "unknown" },
      );
    };
    const o = new CouncilOrchestrator(reg, fastTiming({}), store);
    await o.run(sess.id);

    const { GET } = await import("@/app/api/council-sessions/[id]/route");
    const res = await GET(
      new Request(`http://localhost/api/council-sessions/${sess.id}`),
      { params: { id: sess.id } },
    );
    const body = await res.json();

    expect(body.debug).toBe(false);
    expect(body).not.toHaveProperty("attempts");
    expect(body.providers[0]).not.toHaveProperty("rawResponse");
  });

  it("allows ?debug=1 in dev when ADMIN_DEBUG_TOKEN is unset", async () => {
    delete mutableEnv.ADMIN_DEBUG_TOKEN;
    mutableEnv.NODE_ENV = "test"; // not "production"

    const store = getSessionStore();
    const sess = newSession({});
    await store.create(sess);
    const reg = registry({});
    const o = new CouncilOrchestrator(reg, fastTiming({}), store);
    await o.run(sess.id);

    const { GET } = await import("@/app/api/council-sessions/[id]/route");
    const res = await GET(
      new Request(`http://localhost/api/council-sessions/${sess.id}?debug=1`),
      { params: { id: sess.id } },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.debug).toBe(true);
    expect(Array.isArray(body.attempts)).toBe(true);
  });

  it("rejects ?debug=1 in production when ADMIN_DEBUG_TOKEN is unset", async () => {
    delete mutableEnv.ADMIN_DEBUG_TOKEN;
    mutableEnv.NODE_ENV = "production";

    const store = getSessionStore();
    const sess = newSession({});
    await store.create(sess);
    const reg = registry({});
    const o = new CouncilOrchestrator(reg, fastTiming({}), store);
    await o.run(sess.id);

    const { GET } = await import("@/app/api/council-sessions/[id]/route");
    const res = await GET(
      new Request(`http://localhost/api/council-sessions/${sess.id}?debug=1`),
      { params: { id: sess.id } },
    );
    expect(res.status).toBe(403);
  });

  it("requires matching x-admin-debug-token when ADMIN_DEBUG_TOKEN is set", async () => {
    mutableEnv.ADMIN_DEBUG_TOKEN = "supersecret";
    mutableEnv.NODE_ENV = "production";

    const store = getSessionStore();
    const sess = newSession({});
    await store.create(sess);
    const reg = registry({});
    const o = new CouncilOrchestrator(reg, fastTiming({}), store);
    await o.run(sess.id);

    const { GET } = await import("@/app/api/council-sessions/[id]/route");

    // No header → 403
    const denied = await GET(
      new Request(`http://localhost/api/council-sessions/${sess.id}?debug=1`),
      { params: { id: sess.id } },
    );
    expect(denied.status).toBe(403);

    // Wrong header → 403
    const wrong = await GET(
      new Request(`http://localhost/api/council-sessions/${sess.id}?debug=1`, {
        headers: { "x-admin-debug-token": "nope" },
      }),
      { params: { id: sess.id } },
    );
    expect(wrong.status).toBe(403);

    // Correct header → 200 with attempts
    const ok = await GET(
      new Request(`http://localhost/api/council-sessions/${sess.id}?debug=1`, {
        headers: { "x-admin-debug-token": "supersecret" },
      }),
      { params: { id: sess.id } },
    );
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.debug).toBe(true);
    expect(Array.isArray(body.attempts)).toBe(true);
  });
});

// ───────────────────────── English high-risk routing ───────────────────

describe("inferAccuracyMode — English keyword coverage", () => {
  const cases: Array<[string, string]> = [
    ["This product is a flame retardant coating for steel", "flame retardant"],
    ["Battery fire scenario assessment", "battery fire"],
    ["Customer expects fire prevention claim", "fire prevention"],
    ["Risk of explosion under impact", "explosion"],
    ["Required certification before sale", "certification"],
    ["Legal compliance documents", "legal compliance"],
    ["Refer to the SDS for the resin", "SDS"],
    ["MSDS sheets attached", "MSDS"],
    ["Warranty terms for performance", "warranty"],
    ["Guaranteed performance over 5 years", "guaranteed performance"],
    ["Avoid customer-facing performance claims without test data", "performance claim"],
  ];
  for (const [prompt, label] of cases) {
    it(`escalates: "${label}"`, () => {
      expect(inferAccuracyMode(prompt, "technical_review")).toBe(
        "high_accuracy",
      );
    });
  }

  it("is case-insensitive (UPPER, lower, Mixed all match)", () => {
    expect(
      inferAccuracyMode("FLAME RETARDANT data needed", "technical_review"),
    ).toBe("high_accuracy");
    expect(
      inferAccuracyMode("battery FIRE risk", "technical_review"),
    ).toBe("high_accuracy");
    expect(
      inferAccuracyMode("Battery Fire Test Report", "technical_review"),
    ).toBe("high_accuracy");
  });

  it("stays in default mode for benign English prompts", () => {
    expect(
      inferAccuracyMode("Color swatch sample for indoor wall", "customer_reply"),
    ).toBe("default");
  });
});

// SessionStatus is imported so TS doesn't drop the import when nothing in
// the test file references it directly.
const _statusCheck: SessionStatus[] = ["completed", "partial_completed"];
void _statusCheck;
