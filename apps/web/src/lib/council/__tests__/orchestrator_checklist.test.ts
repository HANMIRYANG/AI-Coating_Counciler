// Certification-checklist integration tests (docs/23,
// taskType=certification_checklist). Verifies the distinct synthesis path:
//   1. A successful session yields answerKind="certification_checklist".
//   2. The checklist carries the shared safety surface + disclaimer, and the
//      structured items are present.
//   3. The markdown export renders the checklist document shape.

import { describe, it, expect, beforeEach } from "vitest";
import { MockProviderAdapter } from "../providers/mock";
import {
  CouncilOrchestrator,
  defaultTimingConfig,
  type TimingConfig,
} from "../orchestrator";
import { getSessionStore, newSessionId, type SessionRecord } from "../store";
import type { ProviderId } from "../types";
import { FINAL_ANSWER_DISCLAIMER_KO } from "../safety";
import { buildSessionMarkdown } from "../sessionMarkdown";
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

function checklistSession(): SessionRecord {
  return {
    id: newSessionId(),
    userPrompt:
      "이 난연 코팅제를 건축 내장재에 적용하려면 어떤 인증/규격/시험이 필요한지 체크리스트로 정리해줘.",
    taskType: "certification_checklist",
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

function registry() {
  const mk = (id: ProviderId, delayMs: number) =>
    new MockProviderAdapter(id, {
      delayMs,
      failureMode: "ok",
      displayName: `${id} (test)`,
      model: `${id}-test`,
    });
  return {
    gemini: mk("gemini", 30),
    anthropic: mk("anthropic", 40),
    openai: mk("openai", 50),
  };
}

describe("CouncilOrchestrator — certification checklist mode", () => {
  it("produces a checklist-shaped final answer for certification_checklist", async () => {
    const store = getSessionStore();
    const sess = checklistSession();
    await store.create(sess);

    const o = new CouncilOrchestrator(registry(), fastTiming(), store);
    await o.run(sess.id);

    const final = await store.get(sess.id);
    expect(final?.status).toBe("completed");

    const fa = final?.finalAnswer;
    expect(fa?.answerKind).toBe("certification_checklist");
    if (fa?.answerKind !== "certification_checklist") {
      throw new Error("expected certification_checklist");
    }

    expect(fa.items.length).toBeGreaterThan(0);
    expect(fa.items[0].requirement.length).toBeGreaterThan(0);
    expect(["met", "unmet", "unknown"]).toContain(fa.items[0].status);
    // Safety guard appended the mandatory disclaimer + kept risk elevated.
    expect(fa.finalMarkdown).toContain(FINAL_ANSWER_DISCLAIMER_KO);
    expect(["high", "critical"]).toContain(fa.riskLevel);
  });

  it("exports the checklist as a checklist-mode markdown document", async () => {
    const store = getSessionStore();
    const sess = checklistSession();
    await store.create(sess);

    const o = new CouncilOrchestrator(registry(), fastTiming(), store);
    await o.run(sess.id);

    const full = await store.get(sess.id);
    const fa = full?.finalAnswer;
    if (fa?.answerKind !== "certification_checklist") {
      throw new Error("expected certification_checklist");
    }

    const md = buildSessionMarkdown({
      id: full!.id,
      userPrompt: full!.userPrompt,
      taskType: full!.taskType,
      evidenceMode: full!.evidenceMode,
      status: full!.status,
      finalAnswer: fa,
    });

    expect(md).toContain("인증/규격 체크리스트");
    expect(md).toContain("## 체크리스트");
    expect(md).toContain("미충족 항목");
  });
});
