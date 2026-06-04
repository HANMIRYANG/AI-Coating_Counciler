// Audit fix #2 — quorum-based early round progression.
//
// Once a round reaches `quorum` successful providers, a bounded grace window
// (ROUND_QUORUM_GRACE_MS) starts. Providers finishing inside the window are
// still included; when it expires, stragglers are cancelled (terminal status
// persisted) and the round advances on the available successes. Per-provider
// dispatch stays parallel and each success is appended the moment it lands
// (audit #1), so these tests also guard against double-appended records.

import { describe, it, expect, beforeEach } from "vitest";
import { MockProviderAdapter } from "../providers/mock";
import {
  CouncilOrchestrator,
  defaultTimingConfig,
  type TimingConfig,
} from "../orchestrator";
import { getSessionStore, newSessionId, type SessionRecord } from "../store";
import type { ProviderId } from "../types";
import { __resetRateLimitersForTest } from "../rateLimiter";

// Keep the rate limiter out of the way — generous concurrency, no backoff.
for (const id of ["OPENAI", "ANTHROPIC", "GEMINI"]) {
  process.env[`RATE_LIMIT_${id}_MAX_CONCURRENT`] = "3";
  process.env[`RATE_LIMIT_${id}_BACKOFF_MAX_MS`] = "20";
  process.env[`RATE_LIMIT_${id}_MAX_RETRIES`] = "0";
  process.env[`RATE_LIMIT_${id}_COOLDOWN_MS`] = "30";
}

beforeEach(() => {
  __resetRateLimitersForTest();
});

type FailureMode = "ok" | "fail" | "hang" | "rate_limit" | "retryable_5xx";

// Provider/round budgets are deliberately LARGE here so the grace window —
// not a provider timeout — is what advances the round. That separation is the
// whole point of these tests.
function quorumTiming(overrides: Partial<TimingConfig> = {}): TimingConfig {
  return {
    ...defaultTimingConfig(),
    providerTimeoutMs: 3_000,
    roundTimeoutMs: 3_000,
    synthesisTimeoutMs: 1_000,
    sessionTimeoutMs: 20_000,
    maxRetries: 0,
    minOpinionsForMeeting: 2,
    minCritiquesForSynthesis: 2,
    roundQuorumGraceMs: 150,
    requiredProvidersForQuorum: [],
    ...overrides,
  };
}

function newSession(overrides: Partial<SessionRecord> = {}): SessionRecord {
  const now = Date.now();
  return {
    id: newSessionId(),
    userPrompt:
      "HE-850A 방사방열 코팅제를 EV 배터리팩 외장재에 적용 가능한지 답변을 만들어줘.",
    taskType: "technical_review",
    evidenceMode: "ai_only",
    status: "created",
    createdAt: now,
    startedAt: now,
    deadlineAt: now + 30_000,
    providerCalls: [],
    attempts: [],
    opinions: [],
    critiques: [],
    ...overrides,
  };
}

function registry(opts: {
  geminiDelay?: number;
  claudeDelay?: number;
  openaiDelay?: number;
  failMode?: Partial<Record<ProviderId, FailureMode>>;
}) {
  const mk = (id: ProviderId, delayMs: number) =>
    new MockProviderAdapter(id, {
      delayMs,
      failureMode: opts.failMode?.[id] ?? "ok",
      displayName: `${id} (test)`,
      model: `${id}-test`,
    });
  return {
    gemini: mk("gemini", opts.geminiDelay ?? 20),
    anthropic: mk("anthropic", opts.claudeDelay ?? 20),
    openai: mk("openai", opts.openaiDelay ?? 20),
  };
}

const initialCall = (rec: SessionRecord | undefined, id: ProviderId) =>
  rec?.providerCalls.find((c) => c.providerId === id && c.round === "initial");

describe("Audit #2 — quorum early progression with grace window", () => {
  it("(1) advances after the grace window — NOT after the hanging provider's full timeout", async () => {
    // gemini + anthropic answer fast; openai hangs forever. Provider/round
    // budgets are 3s, so waiting for the hang would cost ~3s PER ROUND
    // (≥6s for the two opinion/critique rounds). The 150ms grace must let
    // the session finish in a small fraction of that.
    const store = getSessionStore();
    const sess = newSession();
    await store.create(sess);
    const reg = registry({ failMode: { openai: "hang" } });
    const o = new CouncilOrchestrator(reg, quorumTiming(), store);

    const t0 = Date.now();
    await o.run(sess.id);
    const elapsed = Date.now() - t0;

    // Two grace windows (Round 1 + Round 2) + fast synthesis ≪ one 3s timeout.
    expect(elapsed).toBeLessThan(1_500);
    const final = await store.get(sess.id);
    // Two of three succeeded each round → partial, not failed.
    expect(final?.status).toBe("partial_completed");
  });

  it("(2) marks the hanging provider terminal (cancelled) and does NOT block the next round", async () => {
    const store = getSessionStore();
    const sess = newSession();
    await store.create(sess);
    const reg = registry({ failMode: { openai: "hang" } });
    const o = new CouncilOrchestrator(reg, quorumTiming(), store);

    await o.run(sess.id);
    // Let the fire-and-forget straggler tasks drain their terminal upserts.
    await new Promise((r) => setTimeout(r, 60));

    const final = await store.get(sess.id);
    // The hanging provider was cancelled — a terminal status, not "running".
    expect(initialCall(final, "openai")?.status).toBe("cancelled");
    // Next rounds proceeded regardless: synthesis produced a final answer and
    // the two healthy providers' critiques landed.
    expect(final?.finalAnswer).toBeTruthy();
    expect(final?.critiques.length).toBeGreaterThanOrEqual(2);
    // The hung provider never contributed an opinion.
    expect(final?.opinions.some((op) => op.providerId === "openai")).toBe(
      false,
    );
  });

  it("(3) includes a third provider that finishes WITHIN the grace window", async () => {
    // openai is slower than the quorum pair but lands at ~200ms — inside the
    // 500ms grace — so its opinion must be included (3/3 → completed).
    const store = getSessionStore();
    const sess = newSession();
    await store.create(sess);
    const reg = registry({ openaiDelay: 200 });
    const o = new CouncilOrchestrator(
      reg,
      quorumTiming({ roundQuorumGraceMs: 500 }),
      store,
    );

    await o.run(sess.id);
    const final = await store.get(sess.id);

    expect(final?.opinions.length).toBe(3);
    expect(final?.opinions.map((op) => op.providerId).sort()).toEqual([
      "anthropic",
      "gemini",
      "openai",
    ]);
    expect(initialCall(final, "openai")?.status).toBe("succeeded");
    expect(final?.status).toBe("completed");
  });

  it("(4a) all providers failing still yields a failed session (unchanged)", async () => {
    const store = getSessionStore();
    const sess = newSession();
    await store.create(sess);
    const reg = registry({
      failMode: { openai: "fail", anthropic: "fail", gemini: "fail" },
    });
    const o = new CouncilOrchestrator(reg, quorumTiming(), store);

    await o.run(sess.id);
    const final = await store.get(sess.id);
    expect(final?.status).toBe("failed");
  });

  it("(4b) a single success still yields limited_answer (unchanged)", async () => {
    // Only quorum-1 succeeds → grace never starts; the round waits for the
    // failing providers to settle, then advances on the lone success.
    const store = getSessionStore();
    const sess = newSession();
    await store.create(sess);
    const reg = registry({
      failMode: { openai: "fail", anthropic: "fail" },
    });
    const o = new CouncilOrchestrator(reg, quorumTiming(), store);

    await o.run(sess.id);
    const final = await store.get(sess.id);
    expect(final?.status).toBe("limited_answer");
    // Exactly one provider (gemini) carried the round.
    expect(final?.opinions.map((op) => op.providerId)).toEqual(["gemini"]);
  });

  it("(5) appends exactly one record per provider per round — no duplicates from the grace path", async () => {
    // openai lands inside the grace window; gemini/anthropic are immediate.
    // Each provider must append its opinion/critique exactly once.
    const store = getSessionStore();
    const sess = newSession();
    await store.create(sess);
    const reg = registry({ openaiDelay: 150 });
    const o = new CouncilOrchestrator(
      reg,
      quorumTiming({ roundQuorumGraceMs: 500 }),
      store,
    );

    await o.run(sess.id);
    const final = await store.get(sess.id);

    const opinionIds = final?.opinions.map((o) => o.providerId) ?? [];
    const critiqueIds = final?.critiques.map((c) => c.providerId) ?? [];
    expect(opinionIds.length).toBe(new Set(opinionIds).size);
    expect(critiqueIds.length).toBe(new Set(critiqueIds).size);
    // And one providerCall row per (provider, initial) — upsert keyed, never duplicated.
    const initialRows =
      final?.providerCalls.filter((c) => c.round === "initial") ?? [];
    const initialKeys = initialRows.map((c) => c.providerId);
    expect(initialKeys.length).toBe(new Set(initialKeys).size);
  });
});

const drain = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("Audit #2 — cancellation path hardening", () => {
  it("discards a late success that ignores abort and resolves AFTER the grace window", async () => {
    // openai ignores its abort signal and resolves SUCCESSFULLY ~300ms after
    // dispatch — long after the 100ms grace window cancels it. That stale
    // success must never be appended, and its terminal status must be
    // "cancelled", not "succeeded".
    const store = getSessionStore();
    const sess = newSession();
    await store.create(sess);
    const reg = registry({});
    const realOpenaiOpinion = reg.openai.generateInitialOpinion.bind(
      reg.openai,
    );
    reg.openai.generateInitialOpinion = async (input, opts) => {
      // Ignore the abort signal entirely; resolve late with a normal opinion.
      await drain(300);
      return realOpenaiOpinion(input, { ...opts, abortSignal: undefined });
    };
    const o = new CouncilOrchestrator(
      reg,
      quorumTiming({ roundQuorumGraceMs: 100 }),
      store,
    );

    await o.run(sess.id);
    // Wait past the late resolution so a (buggy) append would have happened.
    await drain(400);

    const final = await store.get(sess.id);
    // The stale opinion was NOT appended.
    expect(final?.opinions.some((op) => op.providerId === "openai")).toBe(
      false,
    );
    // …and the terminal status is cancelled, never succeeded.
    expect(initialCall(final, "openai")?.status).toBe("cancelled");
  });

  it("makes the cancelled providerCall status visible immediately after the round advances", async () => {
    // No drain: the moment run() returns, the cancelled status must already be
    // persisted for the hung provider (synchronous terminal write on grace
    // expiry), not pending on a background task.
    const store = getSessionStore();
    const sess = newSession();
    await store.create(sess);
    const reg = registry({ failMode: { openai: "hang" } });
    const o = new CouncilOrchestrator(
      reg,
      quorumTiming({ roundQuorumGraceMs: 100 }),
      store,
    );

    await o.run(sess.id);

    // Read synchronously after run() — NO drain.
    let final = await store.get(sess.id);
    expect(initialCall(final, "openai")?.status).toBe("cancelled");

    // After the cancelled task unwinds in the background, it must preserve the
    // cancellation reason instead of overwriting it as an unknown failure.
    await drain(250);
    final = await store.get(sess.id);
    expect(initialCall(final, "openai")?.errorType).toBe("cancelled");
  });

  it("records cancelled promptly when a provider is cancelled mid retry-backoff", async () => {
    // openai fails with a retryable 503 then enters a 4s backoff. The quorum
    // pair finishes fast, so the 100ms grace cancels openai while it is asleep
    // in backoff. With the abort-aware backoff, its own task unwinds and writes
    // the terminal record (retryCount=1) within a fraction of RETRY_MAX_DELAY.
    process.env.RETRY_BASE_DELAY_MS = "4000";
    process.env.RETRY_MAX_DELAY_MS = "4000";
    const store = getSessionStore();
    const sess = newSession();
    await store.create(sess);
    const reg = registry({ failMode: { openai: "retryable_5xx" } });
    const o = new CouncilOrchestrator(
      reg,
      quorumTiming({ roundQuorumGraceMs: 100, maxRetries: 1 }),
      store,
    );

    const t0 = Date.now();
    await o.run(sess.id);
    // Drain far less than the 4s backoff. If the backoff were NOT abortable the
    // provider task would still be sleeping and its terminal write (retryCount
    // from the attempted hop) would not have landed yet.
    await drain(400);
    const elapsed = Date.now() - t0;

    const final = await store.get(sess.id);
    const openai = initialCall(final, "openai");
    expect(openai?.status).toBe("cancelled");
    // The provider task ran one attempt before backoff, so its own terminal
    // write reflects retryCount=1 — proving it unwound rather than sleeping
    // through RETRY_MAX_DELAY_MS.
    expect(openai?.retryCount).toBe(1);
    // Whole thing finished well under the 4s backoff.
    expect(elapsed).toBeLessThan(2_000);

    process.env.RETRY_BASE_DELAY_MS = "1200";
    process.env.RETRY_MAX_DELAY_MS = "5000";
  });
});
