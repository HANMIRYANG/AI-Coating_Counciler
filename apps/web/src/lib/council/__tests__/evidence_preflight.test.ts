// Orchestrator evidence preflight (Step 7).
//
// Verifies that the bounded internal-evidence preflight:
//   - is SKIPPED for ai_only (default behavior preserved exactly),
//   - records ok / no_matches for internal_docs,
//   - never fails the session when retrieval errors,
//   - keeps the preview bounded and free of raw chunk bodies.
//
// Providers are mocked; the EvidenceBundleService is injected as a stub so
// no database is involved.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { MockProviderAdapter } from "../providers/mock";
import { CouncilOrchestrator, defaultTimingConfig, type TimingConfig } from "../orchestrator";
import { createMemorySessionStore, newSessionId, type SessionRecord } from "../store";
import type { ProviderId, EvidenceMode, EvidenceContext } from "../types";
import type { AiProviderAdapter } from "../provider";
import { DocumentServiceError } from "@/lib/documents/service";
import type {
  EvidenceBundle,
  EvidenceBundleService,
  InternalEvidenceCandidate,
} from "@/lib/documents/evidence-bundle";
import { __resetRateLimitersForTest } from "../rateLimiter";

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

function registry() {
  const mk = (id: ProviderId, delayMs: number) =>
    new MockProviderAdapter(id, {
      delayMs,
      failureMode: "ok",
      displayName: `${id} (test)`,
      model: `${id}-test`,
    });
  return {
    gemini: mk("gemini", 20),
    anthropic: mk("anthropic", 25),
    openai: mk("openai", 30),
  };
}

function session(evidenceMode: EvidenceMode): SessionRecord {
  return {
    id: newSessionId(),
    userPrompt: "HE-850A 방오 코팅의 부착 성능 검토를 요청합니다.",
    taskType: "technical_review",
    evidenceMode,
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

function candidate(i: number): InternalEvidenceCandidate {
  return {
    sourceType: "internal_document",
    documentId: `doc${i}`,
    filename: `f${i}.md`,
    chunkId: `c${i}`,
    chunkIndex: i,
    snippet: `…snippet ${i}…`,
    metadata: { issuer: "KCL" },
    score: 100 - i,
    trustLevel: "uploaded_copy",
    verificationStatus: "auto_extracted",
  };
}

function stubEvidence(build: EvidenceBundleService["build"]): EvidenceBundleService {
  return { build } as unknown as EvidenceBundleService;
}

const COMPLETED = new Set([
  "completed",
  "partial_completed",
  "limited_answer",
]);

describe("evidence preflight", () => {
  it("ai_only does NOT run evidence retrieval and records not_requested", async () => {
    const store = createMemorySessionStore();
    const sess = session("ai_only");
    await store.create(sess);

    const buildSpy = vi.fn();
    const o = new CouncilOrchestrator(
      registry(),
      fastTiming(),
      store,
      stubEvidence(buildSpy),
    );
    await o.run(sess.id);

    expect(buildSpy).not.toHaveBeenCalled();
    const final = await store.get(sess.id);
    expect(final?.evidencePreview).toEqual({
      mode: "ai_only",
      retrievalStatus: "not_requested",
      count: 0,
      candidates: [],
    });
    expect(COMPLETED.has(final?.status ?? "")).toBe(true);
  });

  it("internal_docs records ok with a bounded, body-free candidate list", async () => {
    const store = createMemorySessionStore();
    const sess = session("internal_docs");
    await store.create(sess);

    const aBundle: EvidenceBundle = {
      normalizedQuery: "he-850a 방오 코팅",
      retrievalMode: "internal_documents_keyword",
      retrievalStatus: "ok",
      count: 7,
      candidates: Array.from({ length: 7 }, (_, i) => candidate(i)),
    };
    const buildSpy = vi.fn().mockResolvedValue(aBundle);

    const o = new CouncilOrchestrator(
      registry(),
      fastTiming(),
      store,
      stubEvidence(buildSpy),
    );
    await o.run(sess.id);

    expect(buildSpy).toHaveBeenCalledTimes(1);
    expect(buildSpy).toHaveBeenCalledWith({ query: sess.userPrompt });

    const final = await store.get(sess.id);
    expect(final?.evidencePreview?.retrievalStatus).toBe("ok");
    expect(final?.evidencePreview?.count).toBe(7);
    // Bounded to MAX_PREVIEW_CANDIDATES (5).
    expect(final?.evidencePreview?.candidates).toHaveLength(5);
    for (const c of final?.evidencePreview?.candidates ?? []) {
      expect(c).not.toHaveProperty("content");
      expect(typeof c.snippet).toBe("string");
    }
    // Session still completes normally.
    expect(COMPLETED.has(final?.status ?? "")).toBe(true);
  });

  it("internal_docs with no matches records no_matches and still proceeds", async () => {
    const store = createMemorySessionStore();
    const sess = session("internal_docs");
    await store.create(sess);

    const o = new CouncilOrchestrator(
      registry(),
      fastTiming(),
      store,
      stubEvidence(
        vi.fn().mockResolvedValue({
          normalizedQuery: "x",
          retrievalMode: "internal_documents_keyword",
          retrievalStatus: "no_matches",
          count: 0,
          candidates: [],
        }),
      ),
    );
    await o.run(sess.id);

    const final = await store.get(sess.id);
    expect(final?.evidencePreview?.retrievalStatus).toBe("no_matches");
    expect(COMPLETED.has(final?.status ?? "")).toBe(true);
  });

  it("a database_unavailable error records unavailable and does NOT fail the session", async () => {
    const store = createMemorySessionStore();
    const sess = session("internal_docs");
    await store.create(sess);

    const o = new CouncilOrchestrator(
      registry(),
      fastTiming(),
      store,
      stubEvidence(
        vi
          .fn()
          .mockRejectedValue(
            new DocumentServiceError("database_unavailable", "Can't reach DB"),
          ),
      ),
    );
    await o.run(sess.id);

    const final = await store.get(sess.id);
    expect(final?.evidencePreview?.retrievalStatus).toBe("unavailable");
    expect(final?.evidencePreview?.errorMessage).toMatch(/reach DB/i);
    // The council still runs to completion despite retrieval failing.
    expect(COMPLETED.has(final?.status ?? "")).toBe(true);
    expect(final?.opinions.length).toBeGreaterThanOrEqual(2);
  });

  it("a generic retrieval error records failed and does NOT fail the session", async () => {
    const store = createMemorySessionStore();
    const sess = session("internal_docs");
    await store.create(sess);

    const o = new CouncilOrchestrator(
      registry(),
      fastTiming(),
      store,
      stubEvidence(vi.fn().mockRejectedValue(new Error("kaboom"))),
    );
    await o.run(sess.id);

    const final = await store.get(sess.id);
    expect(final?.evidencePreview?.retrievalStatus).toBe("failed");
    expect(final?.evidencePreview?.errorMessage).toMatch(/kaboom/);
    expect(COMPLETED.has(final?.status ?? "")).toBe(true);
  });
});

// ── Step 8: the evidence context reaches every provider call ───────────

// Wrap mock adapters so we can capture the evidenceContext each round
// received without re-implementing the provider schemas.
function capturingRegistry() {
  const captured: Record<
    ProviderId,
    { initial?: EvidenceContext; critique?: EvidenceContext; synthesis?: EvidenceContext }
  > = { gemini: {}, anthropic: {}, openai: {} };

  const wrap = (id: ProviderId): AiProviderAdapter => {
    const inner = new MockProviderAdapter(id, {
      delayMs: 20,
      failureMode: "ok",
      displayName: `${id} (test)`,
      model: `${id}-test`,
    });
    return {
      id: inner.id,
      displayName: inner.displayName,
      model: inner.model,
      generateInitialOpinion: (input, opts) => {
        captured[id].initial = input.evidenceContext;
        return inner.generateInitialOpinion(input, opts);
      },
      generateCritique: (input, opts) => {
        captured[id].critique = input.evidenceContext;
        return inner.generateCritique(input, opts);
      },
      generateSynthesis: (input, opts) => {
        captured[id].synthesis = input.evidenceContext;
        return inner.generateSynthesis!(input, opts);
      },
    };
  };

  return {
    registry: { gemini: wrap("gemini"), anthropic: wrap("anthropic"), openai: wrap("openai") },
    captured,
  };
}

describe("evidence context injection into provider calls", () => {
  it("internal_docs passes the ok preview into all three rounds", async () => {
    const store = createMemorySessionStore();
    const sess = session("internal_docs");
    await store.create(sess);

    const { registry: reg, captured } = capturingRegistry();
    const o = new CouncilOrchestrator(
      reg,
      fastTiming(),
      store,
      stubEvidence(
        vi.fn().mockResolvedValue({
          normalizedQuery: "q",
          retrievalMode: "internal_documents_keyword",
          retrievalStatus: "ok",
          count: 1,
          candidates: [candidate(0)],
        }),
      ),
    );
    await o.run(sess.id);

    // Round 1 + Round 2 run all three providers → context present each time.
    expect(captured.gemini.initial?.retrievalStatus).toBe("ok");
    expect(captured.gemini.critique?.retrievalStatus).toBe("ok");
    expect(captured.gemini.initial?.candidates[0].chunkId).toBe("c0");

    // Synthesis runs on a single chosen provider — at least one captured it.
    const synthContexts = [
      captured.gemini.synthesis,
      captured.anthropic.synthesis,
      captured.openai.synthesis,
    ].filter(Boolean);
    expect(synthContexts.length).toBeGreaterThanOrEqual(1);
    expect(synthContexts[0]?.retrievalStatus).toBe("ok");
  });

  it("ai_only passes NO evidence context (undefined) into provider calls", async () => {
    const store = createMemorySessionStore();
    const sess = session("ai_only");
    await store.create(sess);

    const { registry: reg, captured } = capturingRegistry();
    const buildSpy = vi.fn();
    const o = new CouncilOrchestrator(reg, fastTiming(), store, stubEvidence(buildSpy));
    await o.run(sess.id);

    expect(buildSpy).not.toHaveBeenCalled();
    expect(captured.gemini.initial).toBeUndefined();
    expect(captured.gemini.critique).toBeUndefined();
    expect(captured.gemini.synthesis).toBeUndefined();
  });

  it("unavailable evidence still injects an (unavailable) context and completes", async () => {
    const store = createMemorySessionStore();
    const sess = session("internal_docs");
    await store.create(sess);

    const { registry: reg, captured } = capturingRegistry();
    const o = new CouncilOrchestrator(
      reg,
      fastTiming(),
      store,
      stubEvidence(
        vi
          .fn()
          .mockRejectedValue(
            new DocumentServiceError("database_unavailable", "Can't reach DB"),
          ),
      ),
    );
    await o.run(sess.id);

    expect(captured.gemini.initial?.retrievalStatus).toBe("unavailable");
    const final = await store.get(sess.id);
    expect(COMPLETED.has(final?.status ?? "")).toBe(true);
  });
});
