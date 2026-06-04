// Ideation-mode integration tests (docs/23, taskType=application_ideas).
//
// Verifies the distinct synthesis path:
//   1. A successful application_ideas session yields answerKind="ideation".
//   2. The ideation answer still carries the domain-safety surface and the
//      safety guard runs over the idea text (CLAUDE.md non-negotiable #5):
//      unsafe phrases embedded in doNotClaim are auto-detected and the
//      mandatory disclaimer is appended to finalMarkdown.

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
import { IdeationFinalAnswerSchema } from "../schemas";

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

function ideationSession(): SessionRecord {
  return {
    id: newSessionId(),
    userPrompt:
      "방사방열 코팅제를 EV 배터리팩에 활용할 수 있는 새로운 적용 아이디어를 제안해줘.",
    taskType: "application_ideas",
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

describe("CouncilOrchestrator — ideation mode", () => {
  it("produces an ideation-shaped final answer for application_ideas", async () => {
    const store = getSessionStore();
    const sess = ideationSession();
    await store.create(sess);

    const o = new CouncilOrchestrator(registry(), fastTiming(), store);
    await o.run(sess.id);

    const final = await store.get(sess.id);
    expect(final?.status).toBe("completed");

    const fa = final?.finalAnswer;
    expect(fa?.answerKind).toBe("ideation");
    if (fa?.answerKind !== "ideation") throw new Error("expected ideation");

    expect(fa.ideas.length).toBeGreaterThan(0);
    expect(fa.ideas[0].ideaSummary.length).toBeGreaterThan(0);
    // Mandatory disclaimer appended by the safety guard.
    expect(fa.finalMarkdown).toContain(FINAL_ANSWER_DISCLAIMER_KO);
  });

  it("rejects schema-valid ideation synthesis with no ideas and tries the next provider", async () => {
    const store = getSessionStore();
    const sess = ideationSession();
    await store.create(sess);

    const reg = registry();
    reg.anthropic.generateSynthesis = async () =>
      IdeationFinalAnswerSchema.parse({
        answerKind: "ideation",
        ideas: [],
        conclusion: "No usable ideas were returned.",
        finalMarkdown: "No usable ideas were returned.",
        missingEvidence: [],
        unsafePhrases: [],
        recommendedSafeWording: [],
        riskLevel: "medium",
        confidenceScore: 0.5,
        providerSummary: [{ providerId: "anthropic", status: "succeeded" }],
        sessionStatus: "completed",
      });
    reg.openai.generateSynthesis = async () =>
      IdeationFinalAnswerSchema.parse({
        answerKind: "ideation",
        ideas: [
          {
            ideaSummary: "openai recovered usable coating idea",
            targetApplication: "test application",
            expectedBenefit: "test benefit",
            requiredEvidence: ["test evidence"],
            riskLevel: "medium",
            recommendedNextExperiment: "run a controlled coupon test",
            doNotClaim: [],
          },
        ],
        conclusion: "Recovered with the next synthesis provider.",
        finalMarkdown: "Recovered with the next synthesis provider.",
        missingEvidence: ["test evidence"],
        unsafePhrases: [],
        recommendedSafeWording: [],
        riskLevel: "medium",
        confidenceScore: 0.65,
        providerSummary: [{ providerId: "openai", status: "succeeded" }],
        sessionStatus: "completed",
      });

    const o = new CouncilOrchestrator(reg, fastTiming(), store);
    await o.run(sess.id);

    const final = await store.get(sess.id);
    const fa = final?.finalAnswer;
    expect(fa?.answerKind).toBe("ideation");
    if (fa?.answerKind !== "ideation") throw new Error("expected ideation");

    expect(fa.ideas.length).toBeGreaterThan(0);
    expect(fa.ideas[0].ideaSummary).toBe(
      "openai recovered usable coating idea",
    );

    const anthropicSynthesis = final?.providerCalls.find(
      (c) => c.providerId === "anthropic" && c.round === "synthesis",
    );
    expect(anthropicSynthesis?.status).toBe("schema_invalid");
    expect(anthropicSynthesis?.errorMessage).toContain("ideation.ideas");
  });

  it("runs the safety guard over idea text (auto-detects unsafe phrases in doNotClaim)", async () => {
    const store = getSessionStore();
    const sess = ideationSession();
    await store.create(sess);

    const o = new CouncilOrchestrator(registry(), fastTiming(), store);
    await o.run(sess.id);

    const fa = (await store.get(sess.id))?.finalAnswer;
    if (fa?.answerKind !== "ideation") throw new Error("expected ideation");

    // The mock seeds doNotClaim with "100% 안전" / "완전 방지" / "인증 완료",
    // which the guard must surface as detected unsafe phrases and elevate risk.
    expect(fa.unsafePhrases.length).toBeGreaterThan(0);
    expect(["high", "critical"]).toContain(fa.riskLevel);
  });

  it("exports ideation answers as an ideation-mode markdown document", async () => {
    const store = getSessionStore();
    const sess = ideationSession();
    await store.create(sess);

    const o = new CouncilOrchestrator(registry(), fastTiming(), store);
    await o.run(sess.id);

    const full = await store.get(sess.id);
    const fa = full?.finalAnswer;
    if (fa?.answerKind !== "ideation") throw new Error("expected ideation");

    const md = buildSessionMarkdown({
      id: full!.id,
      userPrompt: full!.userPrompt,
      taskType: full!.taskType,
      evidenceMode: full!.evidenceMode,
      status: full!.status,
      finalAnswer: fa,
    });

    expect(md).toContain("아이디어 모드");
    expect(md).toContain("적용 아이디어 옵션");
    expect(md).toContain("주장 금지");
  });
});
