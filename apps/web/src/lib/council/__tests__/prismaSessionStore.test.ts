// Fast unit tests for PrismaSessionStore final-answer persistence, using an
// in-memory fake PrismaClient (no database). Focus: the full final-answer
// payload — including fields without a dedicated column such as
// `retrievalGuard` — must survive a write → read round-trip.

import { describe, it, expect } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";

import { PrismaSessionStore } from "../prismaSessionStore";
import {
  FinalAnswerSchema,
  IdeationFinalAnswerSchema,
  type SynthesisResult,
} from "../schemas";
import type { SessionRecord } from "../store";

// Map Prisma.DbNull sentinels to null, mimicking how the DB reads them back.
function denull(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    out[k] = v === Prisma.DbNull ? null : v;
  }
  return out;
}

type FinalRow = Record<string, unknown> & {
  sessionId: string;
  revisionNumber: number;
};

// Minimal in-memory fake of the PrismaClient surface PrismaSessionStore touches
// for create / update / get with a final answer.
function makeFakeClient() {
  const sessions = new Map<string, Record<string, unknown>>();
  const finals: FinalRow[] = [];

  const client = {
    councilSession: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        sessions.set(data.id as string, denull(data));
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Record<string, unknown>;
      }) => {
        const s = sessions.get(where.id);
        if (s) Object.assign(s, denull(data));
      },
      findUnique: async ({ where }: { where: { id: string } }) => {
        const s = sessions.get(where.id);
        if (!s) return null;
        return {
          ...s,
          providerCallLogs: [],
          providerAttemptLogs: [],
          agentResponses: [],
          agentCritiques: [],
          finalAnswers: finals.filter((f) => f.sessionId === where.id),
        };
      },
    },
    finalAnswer: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        finals.push(denull(data) as FinalRow);
      },
    },
  };

  return {
    store: new PrismaSessionStore(client as unknown as PrismaClient),
    finals,
  };
}

function baseSession(id: string): SessionRecord {
  return {
    id,
    userPrompt: "방오 코팅 검토",
    taskType: "document_based_answer",
    evidenceMode: "internal_docs",
    status: "created",
    createdAt: 1_700_000_000_000,
    deadlineAt: 1_700_000_050_000,
    providerCalls: [],
    attempts: [],
    opinions: [],
    critiques: [],
  };
}

function standardAnswer(over: Record<string, unknown> = {}): SynthesisResult {
  return FinalAnswerSchema.parse({
    conclusion: "조건부 적용 가능",
    finalMarkdown: "# 결론",
    businessReadyAnswer: "업체 발송용 본문",
    evidenceCoverageStatus: "sufficient",
    evidenceUsed: [
      {
        chunkId: "c1",
        filename: "kcl.md",
        chunkIndex: 0,
        trustLevel: "uploaded_copy",
        verificationStatus: "auto_extracted",
      },
    ],
    coveredClaims: [{ claim: "난연 충족", evidenceChunkIds: ["c1"] }],
    uncoveredClaims: [],
    retrievalGuard: {
      guardStatus: "passed",
      reasons: ["검증됨"],
      requiredEvidence: true,
      businessCitationReady: true,
      recommendedAction: "발송 가능",
    },
    ...over,
  });
}

describe("PrismaSessionStore — final answer payload round-trip", () => {
  it("preserves retrievalGuard on a standard answer across write → read", async () => {
    const { store, finals } = makeFakeClient();
    await store.create(baseSession("s1"));
    await store.update("s1", {
      finalAnswer: standardAnswer(),
      status: "completed",
      completedAt: 1_700_000_010_000,
    });

    // The write must persist a non-null payload for standard answers.
    expect(finals).toHaveLength(1);
    expect(finals[0].answerKind).toBe("standard");
    expect(finals[0].payload).not.toBeNull();
    expect(finals[0].payload).toBeDefined();

    const got = await store.get("s1");
    const fa = got?.finalAnswer;
    expect(fa?.answerKind).toBe("standard");
    expect(fa?.retrievalGuard).toBeDefined();
    expect(fa?.retrievalGuard?.guardStatus).toBe("passed");
    expect(fa?.retrievalGuard?.businessCitationReady).toBe(true);
  });

  it("falls back to dedicated columns for older standard rows with payload null", async () => {
    const { store, finals } = makeFakeClient();
    await store.create(baseSession("s2"));
    // Simulate a legacy row written before `payload` was persisted for
    // standard answers: payload null, data in the dedicated columns.
    finals.push({
      sessionId: "s2",
      revisionNumber: 1,
      answerKind: "standard",
      payload: null,
      ideation: null,
      conclusion: "레거시 결론",
      finalMarkdown: "# 레거시",
      businessReadyAnswer: "레거시 발송본",
      internalMemo: "메모",
      evidenceBackedClaims: ["근거1"],
      assumptions: [],
      missingEvidence: [],
      unsafePhrases: [],
      recommendedSafeWording: [],
      unresolvedDisagreements: [],
      riskLevel: "low",
      confidenceScore: 0.5,
      followUpQuestions: [],
      providerSummary: [],
      sessionStatus: null,
      evidenceUsed: [],
      coveredClaims: [],
      uncoveredClaims: [],
      evidenceCoverageStatus: "not_requested",
    });

    const got = await store.get("s2");
    const fa = got?.finalAnswer;
    expect(fa?.answerKind).toBe("standard");
    expect(fa?.conclusion).toBe("레거시 결론");
    if (fa?.answerKind === "standard") {
      expect(fa.businessReadyAnswer).toBe("레거시 발송본");
    }
    // Legacy rows carry no guard — reconstruction must not invent one.
    expect(fa?.retrievalGuard).toBeUndefined();
  });

  it("ideation payload behavior is unchanged (parsed from payload)", async () => {
    const { store, finals } = makeFakeClient();
    await store.create(baseSession("s3"));
    const ideation = IdeationFinalAnswerSchema.parse({
      ideas: [{ ideaSummary: "단열 코팅 시제품" }],
      conclusion: "아이디어 결론",
      finalMarkdown: "# 아이디어",
      retrievalGuard: {
        guardStatus: "warning",
        reasons: ["부분 근거"],
        requiredEvidence: false,
        businessCitationReady: false,
        recommendedAction: "검토 필요",
      },
    });
    await store.update("s3", { finalAnswer: ideation, status: "completed" });

    expect(finals[0].answerKind).toBe("ideation");
    expect(finals[0].payload).not.toBeNull();

    const got = await store.get("s3");
    const fa = got?.finalAnswer;
    expect(fa?.answerKind).toBe("ideation");
    if (fa?.answerKind === "ideation") {
      expect(fa.ideas[0].ideaSummary).toBe("단열 코팅 시제품");
    }
    expect(fa?.retrievalGuard?.guardStatus).toBe("warning");
  });
});
