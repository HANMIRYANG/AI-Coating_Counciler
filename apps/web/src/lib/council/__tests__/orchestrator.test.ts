// Integration tests for the round-based orchestrator.
//
// These tests are the load-bearing safety net for the policy in
// docs/04_timeout_and_parallel_execution_policy.md and
// docs/16_testing_and_validation_plan.md:
//
//   1. Providers run in TRUE parallel inside a round.
//   2. A hanging provider does not block the others.
//   3. Partial completion still produces a final answer (with warnings).
//   4. Zero successes mark the session failed without crashing the process.

import { describe, it, expect, beforeEach } from "vitest";
import { MockProviderAdapter } from "../providers/mock";
import {
  CouncilOrchestrator,
  defaultTimingConfig,
  type TimingConfig,
} from "../orchestrator";
import { getSessionStore, newSessionId, type SessionRecord } from "../store";
import type { ProviderId } from "../types";
import { sleep } from "../timeout";
import { __resetRateLimitersForTest } from "../rateLimiter";

// Keep rate-limiter timings tiny so the test suite runs in <2s total.
for (const id of ["OPENAI", "ANTHROPIC", "GEMINI"]) {
  process.env[`RATE_LIMIT_${id}_MAX_CONCURRENT`] = "3";
  process.env[`RATE_LIMIT_${id}_BACKOFF_MAX_MS`] = "20";
  process.env[`RATE_LIMIT_${id}_MAX_RETRIES`] = "0";
  process.env[`RATE_LIMIT_${id}_COOLDOWN_MS`] = "30";
}

beforeEach(() => {
  __resetRateLimitersForTest();
});

function fastTiming(overrides: Partial<TimingConfig> = {}): TimingConfig {
  return {
    ...defaultTimingConfig(),
    providerTimeoutMs: 200,
    roundTimeoutMs: 400,
    synthesisTimeoutMs: 200,
    sessionTimeoutMs: 1500,
    maxRetries: 0,
    minOpinionsForMeeting: 2,
    minCritiquesForSynthesis: 2,
    ...overrides,
  };
}

function newSession(): SessionRecord {
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
  };
}

function registry(opts: {
  geminiDelay?: number;
  claudeDelay?: number;
  openaiDelay?: number;
  failMode?: Partial<
    Record<ProviderId, "fail" | "hang" | "timeout" | "rate_limit">
  >;
}) {
  // Construct mocks with explicit overrides (do not rely on env).
  const mk = (id: ProviderId, delayMs: number) => {
    const m = new MockProviderAdapter(id, {
      delayMs,
      failureMode: opts.failMode?.[id] ?? "ok",
      displayName: `${id} (test)`,
      model: `${id}-test`,
    });
    return m;
  };
  return {
    gemini: mk("gemini", opts.geminiDelay ?? 30),
    anthropic: mk("anthropic", opts.claudeDelay ?? 40),
    openai: mk("openai", opts.openaiDelay ?? 50),
  };
}

describe("CouncilOrchestrator", () => {
  it("runs all 3 providers in parallel (wall-clock < sum of delays)", async () => {
    const store = getSessionStore();
    const sess = newSession();
    await store.create(sess);

    const o = new CouncilOrchestrator(
      registry({ geminiDelay: 80, claudeDelay: 90, openaiDelay: 100 }),
      fastTiming({ providerTimeoutMs: 500, roundTimeoutMs: 800 }),
      store,
    );

    const t0 = Date.now();
    await o.run(sess.id);
    const elapsed = Date.now() - t0;

    // Sequential would be ≥ 80+90+100 = 270ms per round × 2 rounds + synth.
    // Parallel should comfortably finish under 600ms total.
    expect(elapsed).toBeLessThan(900);

    const final = await store.get(sess.id);
    expect(final?.status).toBe("completed");
    expect(final?.finalAnswer).toBeTruthy();
    expect(final?.opinions.length).toBe(3);
  });

  it("waits for required OpenAI opinion before quorum grace can advance", async () => {
    const store = getSessionStore();
    const sess = newSession();
    await store.create(sess);

    const o = new CouncilOrchestrator(
      registry({ geminiDelay: 20, claudeDelay: 20, openaiDelay: 180 }),
      fastTiming({
        providerTimeoutMs: 600,
        roundTimeoutMs: 900,
        roundQuorumGraceMs: 40,
        requiredProvidersForQuorum: ["openai"],
      }),
      store,
    );

    await o.run(sess.id);

    const final = await store.get(sess.id);
    expect(final?.opinions.some((op) => op.providerId === "openai")).toBe(
      true,
    );
    const openaiInitial = final?.providerCalls.find(
      (c) => c.providerId === "openai" && c.round === "initial",
    );
    expect(openaiInitial?.status).toBe("succeeded");
  });

  it("does not block when one provider hangs forever", async () => {
    const store = getSessionStore();
    const sess = newSession();
    await store.create(sess);

    const o = new CouncilOrchestrator(
      registry({
        geminiDelay: 30,
        claudeDelay: 30,
        openaiDelay: 10,
        failMode: { openai: "hang" },
      }),
      fastTiming({ providerTimeoutMs: 150, roundTimeoutMs: 250 }),
      store,
    );

    const t0 = Date.now();
    await o.run(sess.id);
    const elapsed = Date.now() - t0;

    expect(elapsed).toBeLessThan(2_000);

    const final = await store.get(sess.id);
    // Two providers succeed → partial_completed with a final answer.
    expect(final?.status).toBe("partial_completed");
    expect(final?.opinions.length).toBe(2);

    const openaiInitial = final?.providerCalls.find(
      (c) => c.providerId === "openai" && c.round === "initial",
    );
    expect(openaiInitial?.status).toBe("timed_out");
  });

  it("produces limited_answer when only one provider succeeds", async () => {
    const store = getSessionStore();
    const sess = newSession();
    await store.create(sess);

    const o = new CouncilOrchestrator(
      registry({
        geminiDelay: 30,
        failMode: { anthropic: "fail", openai: "hang" },
      }),
      fastTiming({ providerTimeoutMs: 150, roundTimeoutMs: 250 }),
      store,
    );

    await o.run(sess.id);

    const final = await store.get(sess.id);
    expect(final?.opinions.length).toBe(1);
    expect(final?.status).toBe("limited_answer");
    expect(final?.finalAnswer).toBeTruthy();
    // Business-ready answer should carry the limited-mode warning.
    const fa = final?.finalAnswer;
    expect(fa?.answerKind).toBe("standard");
    expect(
      fa?.answerKind === "standard" ? fa.businessReadyAnswer : "",
    ).toMatch(/제한적/);
  });

  it("marks session failed when all providers fail in Round 1", async () => {
    const store = getSessionStore();
    const sess = newSession();
    await store.create(sess);

    const o = new CouncilOrchestrator(
      registry({
        failMode: { gemini: "fail", anthropic: "fail", openai: "fail" },
      }),
      fastTiming({ providerTimeoutMs: 150, roundTimeoutMs: 200 }),
      store,
    );

    await o.run(sess.id);

    const final = await store.get(sess.id);
    expect(final?.status).toBe("failed");
    expect(final?.opinions.length).toBe(0);
    expect(final?.finalAnswer).toBeUndefined();
  });

  it("records every provider call with start/end timestamps and latency", async () => {
    const store = getSessionStore();
    const sess = newSession();
    await store.create(sess);

    const o = new CouncilOrchestrator(
      registry({ geminiDelay: 20, claudeDelay: 20, openaiDelay: 20 }),
      fastTiming({ providerTimeoutMs: 200, roundTimeoutMs: 400 }),
      store,
    );

    await o.run(sess.id);
    const final = await store.get(sess.id);
    const initialCalls =
      final?.providerCalls.filter((c) => c.round === "initial") ?? [];
    expect(initialCalls.length).toBe(3);
    for (const c of initialCalls) {
      expect(c.startedAt).toBeGreaterThan(0);
      expect(c.endedAt).toBeGreaterThanOrEqual(c.startedAt!);
      expect(c.latencyMs).toBeGreaterThanOrEqual(0);
    }
  });

  it("continues with healthy providers when one provider is rate-limited", async () => {
    const store = getSessionStore();
    const sess = newSession();
    await store.create(sess);

    const o = new CouncilOrchestrator(
      registry({
        geminiDelay: 30,
        claudeDelay: 30,
        openaiDelay: 10,
        failMode: { openai: "rate_limit" },
      }),
      fastTiming({ providerTimeoutMs: 200, roundTimeoutMs: 400 }),
      store,
    );

    await o.run(sess.id);
    const final = await store.get(sess.id);
    // Two providers succeed → partial_completed; openai is recorded as rate_limited.
    expect(final?.status).toBe("partial_completed");
    const openaiCall = final?.providerCalls.find(
      (c) => c.providerId === "openai" && c.round === "initial",
    );
    expect(openaiCall?.status).toBe("rate_limited");
    expect(openaiCall?.rateLimited).toBe(true);
  });

  it("verifies parallel start: all three providers enter 'running' within one event-loop tick", async () => {
    const store = getSessionStore();
    const sess = newSession();
    await store.create(sess);

    const o = new CouncilOrchestrator(
      registry({ geminiDelay: 200, claudeDelay: 200, openaiDelay: 200 }),
      fastTiming({ providerTimeoutMs: 1_000, roundTimeoutMs: 2_000 }),
      store,
    );

    // Fire and forget; we will inspect the store mid-flight.
    const running = o.run(sess.id);

    // Give the orchestrator a moment to dispatch.
    await sleep(50);
    const snap = await store.get(sess.id);
    const runningCalls =
      snap?.providerCalls.filter(
        (c) => c.round === "initial" && c.status === "running",
      ) ?? [];
    expect(runningCalls.length).toBe(3);

    await running;
  });
});
