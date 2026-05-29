// MemorySessionStore.listRecent + GET /api/council-sessions tests.
//
// Uses createMemorySessionStore() for the unit tests so each case gets an
// isolated store and we don't depend on whatever the global singleton has
// accumulated from earlier test files.

import { describe, it, expect, beforeEach } from "vitest";
import {
  createMemorySessionStore,
  DEFAULT_RECENT_LIMIT,
  MAX_RECENT_LIMIT,
  resetGlobalSessionStoreForTests,
  type SessionRecord,
  type SessionSummary,
  getSessionStore,
} from "../store";
import type { TaskType, EvidenceMode } from "../types";

function makeRecord(overrides: Partial<SessionRecord> = {}): SessionRecord {
  const taskType: TaskType = "technical_review";
  const evidenceMode: EvidenceMode = "ai_only";
  return {
    id: `cs_${Math.random().toString(36).slice(2, 10)}`,
    userPrompt: "테스트 프롬프트",
    taskType,
    evidenceMode,
    status: "created",
    createdAt: Date.now(),
    startedAt: Date.now(),
    deadlineAt: Date.now() + 60_000,
    providerCalls: [
      {
        providerId: "openai",
        round: "initial",
        status: "succeeded",
        retryCount: 0,
        rawResponse: "should NOT leak",
        parsedResponse: { secret: true },
      },
    ],
    attempts: [
      {
        sessionId: "x",
        providerId: "openai",
        round: "initial",
        model: "gpt-5.5",
        attemptIndex: 0,
        chainIndex: 0,
        status: "succeeded",
        startedAt: 0,
        endedAt: 1,
        latencyMs: 1,
        timeoutMs: 200,
      },
    ],
    opinions: [],
    critiques: [],
    ...overrides,
  };
}

describe("MemorySessionStore.listRecent", () => {
  it("returns newest first", async () => {
    const store = createMemorySessionStore();
    await store.create(makeRecord({ id: "a", createdAt: 100 }));
    await store.create(makeRecord({ id: "b", createdAt: 300 }));
    await store.create(makeRecord({ id: "c", createdAt: 200 }));

    const recent = await store.listRecent();
    expect(recent.map((s) => s.id)).toEqual(["b", "c", "a"]);
  });

  it("respects an explicit limit", async () => {
    const store = createMemorySessionStore();
    for (let i = 0; i < 10; i++) {
      await store.create(makeRecord({ id: `s${i}`, createdAt: i }));
    }
    const recent = await store.listRecent(3);
    expect(recent.length).toBe(3);
    // newest 3 → s9, s8, s7
    expect(recent.map((s) => s.id)).toEqual(["s9", "s8", "s7"]);
  });

  it("uses DEFAULT_RECENT_LIMIT when no limit is provided", async () => {
    const store = createMemorySessionStore();
    const N = DEFAULT_RECENT_LIMIT + 5;
    for (let i = 0; i < N; i++) {
      await store.create(makeRecord({ id: `s${i}`, createdAt: i }));
    }
    const recent = await store.listRecent();
    expect(recent.length).toBe(DEFAULT_RECENT_LIMIT);
  });

  it("clamps an oversize limit to MAX_RECENT_LIMIT", async () => {
    const store = createMemorySessionStore();
    const N = MAX_RECENT_LIMIT + 30;
    for (let i = 0; i < N; i++) {
      await store.create(makeRecord({ id: `s${i}`, createdAt: i }));
    }
    const recent = await store.listRecent(9_999);
    expect(recent.length).toBe(MAX_RECENT_LIMIT);
  });

  it("falls back to default when limit is non-finite or non-positive", async () => {
    const store = createMemorySessionStore();
    for (let i = 0; i < DEFAULT_RECENT_LIMIT + 1; i++) {
      await store.create(makeRecord({ id: `s${i}`, createdAt: i }));
    }
    const nan = await store.listRecent(Number.NaN);
    const zero = await store.listRecent(0);
    const neg = await store.listRecent(-5);
    expect(nan.length).toBe(DEFAULT_RECENT_LIMIT);
    expect(zero.length).toBe(DEFAULT_RECENT_LIMIT);
    expect(neg.length).toBe(DEFAULT_RECENT_LIMIT);
  });

  it("returns SessionSummary shape only — no debug or large payload fields", async () => {
    const store = createMemorySessionStore();
    await store.create(makeRecord({ id: "x", createdAt: 1 }));
    const [summary] = await store.listRecent();

    // Exhaustive whitelist of public fields.
    const allowed = new Set([
      "id",
      "userPrompt",
      "taskType",
      "evidenceMode",
      "status",
      "currentRound",
      "createdAt",
      "completedAt",
      "errorMessage",
    ]);
    for (const k of Object.keys(summary)) {
      expect(allowed.has(k)).toBe(true);
    }

    // Explicit disallowed-field check (catches accidental future regressions).
    const blocked = [
      "providerCalls",
      "attempts",
      "opinions",
      "critiques",
      "finalAnswer",
      "evidencePreview",
      "rawResponse",
      "parsedResponse",
      "deadlineAt",
      "startedAt",
    ];
    for (const k of blocked) {
      expect((summary as Record<string, unknown>)[k]).toBeUndefined();
    }
  });
});

describe("GET /api/council-sessions", () => {
  // Each route test starts from a clean global store so we never depend
  // on what earlier tests (or other test files) happened to plant.
  beforeEach(() => {
    resetGlobalSessionStoreForTests();
  });

  it("returns { sessions: [...] } using the global store, summary shape only", async () => {
    const store = getSessionStore();
    const rec = makeRecord({
      id: `cs_route_${Date.now().toString(36)}`,
      userPrompt: "route 통합 테스트 프롬프트",
      createdAt: Date.now(),
    });
    await store.create(rec);

    const { GET } = await import("@/app/api/council-sessions/route");
    const res = await GET(
      new Request("http://localhost/api/council-sessions?limit=5"),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sessions: SessionSummary[] };
    expect(Array.isArray(body.sessions)).toBe(true);
    expect(body.sessions.length).toBeLessThanOrEqual(5);

    const ours = body.sessions.find((s) => s.id === rec.id);
    expect(ours).toBeTruthy();
    expect(ours?.userPrompt).toBe("route 통합 테스트 프롬프트");

    // Sanity: every item should carry ONLY summary fields.
    for (const s of body.sessions) {
      expect(s).not.toHaveProperty("providerCalls");
      expect(s).not.toHaveProperty("attempts");
      expect(s).not.toHaveProperty("opinions");
      expect(s).not.toHaveProperty("critiques");
      expect(s).not.toHaveProperty("finalAnswer");
      expect(s).not.toHaveProperty("rawResponse");
      expect(s).not.toHaveProperty("parsedResponse");
    }
  });

  it("returns sessions newest-first through the API", async () => {
    const store = getSessionStore();
    await store.create(makeRecord({ id: "oldest", createdAt: 1_000 }));
    await store.create(makeRecord({ id: "newest", createdAt: 9_000 }));
    await store.create(makeRecord({ id: "middle", createdAt: 5_000 }));

    const { GET } = await import("@/app/api/council-sessions/route");
    const res = await GET(
      new Request("http://localhost/api/council-sessions?limit=10"),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sessions: SessionSummary[] };
    expect(body.sessions.map((s) => s.id)).toEqual([
      "newest",
      "middle",
      "oldest",
    ]);

    // Blocked-field check still holds across all returned items.
    for (const s of body.sessions) {
      expect(s).not.toHaveProperty("providerCalls");
      expect(s).not.toHaveProperty("attempts");
      expect(s).not.toHaveProperty("opinions");
      expect(s).not.toHaveProperty("critiques");
      expect(s).not.toHaveProperty("finalAnswer");
      expect(s).not.toHaveProperty("rawResponse");
      expect(s).not.toHaveProperty("parsedResponse");
    }
  });

  it("ignores a malformed limit and uses the default", async () => {
    const { GET } = await import("@/app/api/council-sessions/route");
    const res = await GET(
      new Request("http://localhost/api/council-sessions?limit=not-a-number"),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sessions: SessionSummary[] };
    expect(Array.isArray(body.sessions)).toBe(true);
    // No throw, no 400 — malformed limit is tolerated.
    expect(body.sessions.length).toBeLessThanOrEqual(DEFAULT_RECENT_LIMIT);
  });
});
