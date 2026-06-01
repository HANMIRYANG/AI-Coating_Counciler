// PrismaSessionStore integration test.
//
// Skipped unless DATABASE_URL is set AND a PostgreSQL listener responds.
// In CI / dev without Docker this becomes a no-op — exactly what we want
// for the existing `npm test` workflow.
//
// To run locally:
//   docker compose up -d   (repo root)
//   cd apps/web && npx prisma migrate dev --name init_council
//   PRISMA_INTEGRATION=1 DATABASE_URL="postgresql://postgres:postgres@localhost:5432/ai_coating_council?schema=public" npx vitest run src/lib/council/__tests__/prisma_session_store.integration.test.ts
//
// Each test creates its own session id so they can run in any order and
// in parallel without colliding. Cleanup deletes the session and its
// cascaded child rows on completion.

import { describe, it, expect, beforeAll, afterAll } from "vitest";

const RUN = process.env.PRISMA_INTEGRATION === "1";
const describeIf = RUN ? describe : describe.skip;

// Pull these lazily so the suite skips cleanly when @prisma/client is
// unavailable (e.g. before the user runs `prisma generate`).
type AnyStore = import("../store").SessionStore;
type AnyRecord = import("../store").SessionRecord;
let store: AnyStore;
let createdIds: string[] = [];

function makeRecord(id: string): AnyRecord {
  const now = Date.now();
  return {
    id,
    userPrompt: "테스트: HE-850A 코팅제 배터리팩 적용 검토",
    taskType: "technical_review",
    evidenceMode: "ai_only",
    status: "created",
    createdAt: now,
    startedAt: now,
    deadlineAt: now + 240_000,
    providerCalls: [],
    attempts: [],
    opinions: [],
    critiques: [],
  };
}

describeIf("PrismaSessionStore (integration, PRISMA_INTEGRATION=1)", () => {
  beforeAll(async () => {
    const mod = await import("../prismaSessionStore");
    store = new mod.PrismaSessionStore();
  });

  afterAll(async () => {
    // Best-effort cleanup. Cascade deletes child rows.
    if (!RUN) return;
    const { getPrismaClient } = await import("../../db");
    const client = getPrismaClient();
    for (const id of createdIds) {
      await client.councilSession.delete({ where: { id } }).catch(() => undefined);
    }
    await client.$disconnect();
  });

  it("create + get round-trips a SessionRecord", async () => {
    const id = `cs_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    createdIds.push(id);

    const rec = makeRecord(id);
    await store.create(rec);

    const got = await store.get(id);
    expect(got).toBeDefined();
    expect(got!.id).toBe(id);
    expect(got!.userPrompt).toBe(rec.userPrompt);
    expect(got!.taskType).toBe("technical_review");
    expect(got!.status).toBe("created");
    expect(got!.providerCalls).toEqual([]);
    expect(got!.opinions).toEqual([]);
  });

  it("update applies scalar patches and re-reads the session", async () => {
    const id = `cs_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    createdIds.push(id);
    await store.create(makeRecord(id));

    const updated = await store.update(id, {
      status: "round1_running",
      currentRound: "initial",
    });
    expect(updated.status).toBe("round1_running");
    expect(updated.currentRound).toBe("initial");
  });

  it("upsertProviderCall enforces the (sessionId, providerId, round) unique key", async () => {
    const id = `cs_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    createdIds.push(id);
    await store.create(makeRecord(id));

    // First call — insert
    await store.upsertProviderCall(id, {
      providerId: "openai",
      round: "initial",
      status: "running",
      startedAt: Date.now(),
      timeoutMs: 90_000,
      retryCount: 0,
    });
    // Same key — update (status flips to succeeded)
    const after = await store.upsertProviderCall(id, {
      providerId: "openai",
      round: "initial",
      status: "succeeded",
      startedAt: Date.now() - 1000,
      endedAt: Date.now(),
      latencyMs: 1000,
      timeoutMs: 90_000,
      retryCount: 0,
      modelUsed: "gpt-5.5",
    });

    const openaiInitial = after.providerCalls.filter(
      (c) => c.providerId === "openai" && c.round === "initial",
    );
    expect(openaiInitial.length).toBe(1);
    expect(openaiInitial[0].status).toBe("succeeded");
    expect(openaiInitial[0].modelUsed).toBe("gpt-5.5");
  });

  it("appendAttempt is fire-and-forget (returns immediately) and eventually writes", async () => {
    const id = `cs_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    createdIds.push(id);
    await store.create(makeRecord(id));

    const t0 = Date.now();
    await store.appendAttempt(id, {
      sessionId: id,
      providerId: "anthropic",
      round: "initial",
      model: "claude-sonnet-4-6",
      attemptIndex: 0,
      chainIndex: 0,
      status: "succeeded",
      startedAt: Date.now() - 500,
      endedAt: Date.now(),
      latencyMs: 500,
      timeoutMs: 90_000,
    });
    // Fire-and-forget must return quickly (the actual DB write may still
    // be in flight). 200ms is generous — local Postgres usually < 20ms.
    expect(Date.now() - t0).toBeLessThan(200);

    // Wait for the background write to drain, then verify it landed.
    await new Promise((r) => setTimeout(r, 500));
    const got = await store.get(id);
    expect(got!.attempts.length).toBe(1);
    expect(got!.attempts[0].model).toBe("claude-sonnet-4-6");
  });

  it("FinalAnswer round-trip preserves followUpQuestions / providerSummary / sessionStatus", async () => {
    const id = `cs_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    createdIds.push(id);
    await store.create(makeRecord(id));

    const finalAnswer = {
      answerKind: "standard" as const,
      conclusion: "조건부 적용 가능",
      finalMarkdown: "# 결론\n조건부 적용 가능합니다.",
      businessReadyAnswer: "업체 발송용 본문",
      internalMemo: "내부 검토 메모",
      evidenceBackedClaims: ["근거1", "근거2"],
      assumptions: ["가정1"],
      missingEvidence: ["시험성적서 필요"],
      unsafePhrases: [
        { phrase: "완전 차단", reason: "단정 표현", recommended: "조건부 차단" },
      ],
      recommendedSafeWording: ["권장 표현"],
      unresolvedDisagreements: ["미해결1"],
      riskLevel: "medium" as const,
      confidenceScore: 0.62,
      followUpQuestions: ["추가 질문 1", "추가 질문 2"],
      providerSummary: [
        { providerId: "openai" as const, status: "succeeded", latencyMs: 1500 },
        { providerId: "anthropic" as const, status: "succeeded", latencyMs: 1800 },
        { providerId: "gemini" as const, status: "timed_out" },
      ],
      sessionStatus: "partial_completed",
      // Evidence usage contract (Step 10) — round-trips through JSON columns.
      evidenceUsed: [
        {
          chunkId: "chunk_1",
          filename: "kcl-report.md",
          chunkIndex: 0,
          trustLevel: "uploaded_copy",
          verificationStatus: "auto_extracted",
        },
      ],
      coveredClaims: [{ claim: "근거1", evidenceChunkIds: ["chunk_1"] }],
      uncoveredClaims: ["시험성적서 필요"],
      evidenceCoverageStatus: "partial" as const,
    };

    await store.update(id, { status: "completed", finalAnswer });
    const got = await store.get(id);
    expect(got!.finalAnswer).toBeDefined();
    const gotFa = got!.finalAnswer!;
    if (gotFa.answerKind !== "standard") throw new Error("expected standard answer");
    expect(gotFa.followUpQuestions).toEqual(finalAnswer.followUpQuestions);
    expect(gotFa.providerSummary).toEqual(finalAnswer.providerSummary);
    expect(gotFa.sessionStatus).toBe("partial_completed");
    expect(gotFa.evidenceCoverageStatus).toBe("partial");
    expect(gotFa.evidenceUsed).toEqual(finalAnswer.evidenceUsed);
    expect(gotFa.coveredClaims).toEqual(finalAnswer.coveredClaims);
    expect(gotFa.uncoveredClaims).toEqual(finalAnswer.uncoveredClaims);
  });

  it("listRecent returns newest-first SessionSummary entries", async () => {
    const id1 = `cs_test_${Date.now()}_a_${Math.random().toString(36).slice(2, 8)}`;
    const id2 = `cs_test_${Date.now() + 1}_b_${Math.random().toString(36).slice(2, 8)}`;
    createdIds.push(id1, id2);
    await store.create(makeRecord(id1));
    await new Promise((r) => setTimeout(r, 5));
    await store.create(makeRecord(id2));

    const summaries = await store.listRecent(10);
    const idx1 = summaries.findIndex((s) => s.id === id1);
    const idx2 = summaries.findIndex((s) => s.id === id2);
    expect(idx1).toBeGreaterThanOrEqual(0);
    expect(idx2).toBeGreaterThanOrEqual(0);
    // id2 was created later → must come first.
    expect(idx2).toBeLessThan(idx1);
  });
});
