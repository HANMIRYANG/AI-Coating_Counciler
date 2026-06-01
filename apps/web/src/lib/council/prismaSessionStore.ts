// Prisma-backed SessionStore.
//
// Activated by `SESSION_STORE=prisma`. The class lives in its own file so
// `store.ts` (the interface + memory implementation) never has to import
// `@prisma/client`. That keeps the bundle for code paths that only need
// the in-memory store small, and matches the schema-contract test's
// expectations.
//
// Mapping (in-memory ↔ Prisma):
//   SessionRecord            ↔  CouncilSession (one row per session)
//   ProviderCallRecord       ↔  ProviderCallLog (unique sessionId+providerId+round)
//   ProviderAttemptRecord    ↔  ProviderAttemptLog (append-only forensic log)
//   ProviderOpinion          ↔  AgentResponse.parsedResponse (Json)
//   ProviderCritique         ↔  AgentCritique.parsedResponse (Json)
//   FinalAnswer              ↔  FinalAnswer row (one or more revisions)
//
// Time conversion:
//   Memory store uses `number` (Date.now() ms). Prisma uses `Date`.
//   Conversions happen at the boundary in this file.
//
// Concurrency:
//   `appendAttempt` is fire-and-forget (returns immediately, writes in
//   background). All other writes are awaited because downstream code
//   relies on the resulting state for the next state transition.

import { Prisma } from "@prisma/client";
import type {
  CouncilSession,
  ProviderCallLog,
  ProviderAttemptLog,
  AgentResponse,
  AgentCritique,
  FinalAnswer as FinalAnswerRow,
  PrismaClient,
} from "@prisma/client";

import { getPrismaClient } from "../db";
import type {
  EvidenceMode,
  ProviderId,
  ProviderStatus,
  RoundKey,
  SessionStatus,
  TaskType,
} from "./types";
import {
  IdeationFinalAnswerSchema,
  type FinalAnswer,
  type ProviderCritique,
  type ProviderOpinion,
  type SynthesisResult,
} from "./schemas";
import {
  clampRecentLimit,
  type ProviderAttemptRecord,
  type ProviderCallRecord,
  type SessionRecord,
  type SessionStore,
  type SessionSummary,
} from "./store";
import type { SessionEvidencePreview } from "./evidencePreview";

function dateToMs(d: Date | null | undefined): number | undefined {
  return d ? d.getTime() : undefined;
}

function msToDate(ms: number | undefined | null): Date | undefined {
  return ms === undefined || ms === null ? undefined : new Date(ms);
}

type SessionWithRelations = CouncilSession & {
  providerCallLogs: ProviderCallLog[];
  providerAttemptLogs: ProviderAttemptLog[];
  agentResponses: AgentResponse[];
  agentCritiques: AgentCritique[];
  finalAnswers: FinalAnswerRow[];
};

function reassemble(row: SessionWithRelations): SessionRecord {
  // Latest FinalAnswer (highest revisionNumber) — there is normally only one.
  const final = [...row.finalAnswers].sort(
    (a, b) => b.revisionNumber - a.revisionNumber,
  )[0];

  return {
    id: row.id,
    userPrompt: row.userPrompt,
    taskType: row.taskType as TaskType,
    evidenceMode: row.evidenceMode as EvidenceMode,
    status: row.status as SessionStatus,
    currentRound: (row.currentRound ?? undefined) as RoundKey | undefined,
    createdAt: row.createdAt.getTime(),
    startedAt: dateToMs(row.startedAt),
    completedAt: dateToMs(row.completedAt),
    deadlineAt: row.deadlineAt.getTime(),
    errorMessage: row.errorMessage ?? undefined,
    providerCalls: row.providerCallLogs
      .slice()
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map(providerCallFromRow),
    attempts: row.providerAttemptLogs
      .slice()
      .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime())
      .map(attemptFromRow),
    opinions: row.agentResponses
      .slice()
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((r) => r.parsedResponse as ProviderOpinion),
    critiques: row.agentCritiques
      .slice()
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((r) => r.parsedResponse as ProviderCritique),
    finalAnswer: final ? finalAnswerFromRow(final) : undefined,
    evidencePreview:
      (row.evidencePreview as SessionEvidencePreview | null) ?? undefined,
  };
}

function providerCallFromRow(r: ProviderCallLog): ProviderCallRecord {
  return {
    providerId: r.providerId as ProviderId,
    round: r.round as RoundKey,
    status: r.status as ProviderStatus,
    startedAt: dateToMs(r.startedAt),
    endedAt: dateToMs(r.endedAt),
    latencyMs: r.latencyMs ?? undefined,
    timeoutMs: r.timeoutMs ?? undefined,
    retryCount: r.retryCount,
    errorType: r.errorType ?? undefined,
    errorMessage: r.errorMessage ?? undefined,
    modelUsed: r.modelUsed ?? undefined,
    modelRequested: r.modelRequested ?? undefined,
    rateLimited: r.rateLimited,
    rawResponse: r.rawResponse ?? undefined,
    parsedResponse: r.parsedResponse ?? undefined,
  };
}

function attemptFromRow(r: ProviderAttemptLog): ProviderAttemptRecord {
  return {
    sessionId: r.sessionId,
    providerId: r.providerId as ProviderId,
    round: r.round as RoundKey,
    model: r.model,
    attemptIndex: r.attemptIndex,
    chainIndex: r.chainIndex,
    status: r.status as ProviderStatus,
    startedAt: r.startedAt.getTime(),
    endedAt: r.endedAt.getTime(),
    latencyMs: r.latencyMs,
    timeoutMs: r.timeoutMs,
    errorType: r.errorType ?? undefined,
    errorMessage: r.errorMessage ?? undefined,
    retryAfterMs: r.retryAfterMs ?? undefined,
    rateLimited: r.rateLimited,
  };
}

function finalAnswerFromRow(r: FinalAnswerRow): SynthesisResult {
  // Ideation rows persist their full IdeationFinalAnswer payload in `ideation`.
  // Re-validate through the schema so defaults / shape are guaranteed.
  if (r.answerKind === "ideation" && r.ideation != null) {
    return IdeationFinalAnswerSchema.parse(r.ideation);
  }
  return {
    answerKind: "standard",
    conclusion: r.conclusion,
    finalMarkdown: r.finalMarkdown,
    businessReadyAnswer: r.businessReadyAnswer ?? "",
    internalMemo: r.internalMemo ?? "",
    evidenceBackedClaims:
      (r.evidenceBackedClaims as string[] | null) ?? [],
    assumptions: (r.assumptions as string[] | null) ?? [],
    missingEvidence: (r.missingEvidence as string[] | null) ?? [],
    unsafePhrases:
      (r.unsafePhrases as FinalAnswer["unsafePhrases"] | null) ?? [],
    recommendedSafeWording:
      (r.recommendedSafeWording as string[] | null) ?? [],
    unresolvedDisagreements:
      (r.unresolvedDisagreements as string[] | null) ?? [],
    riskLevel:
      (r.riskLevel as FinalAnswer["riskLevel"] | null) ?? "low",
    confidenceScore: r.confidenceScore ?? 0.5,
    followUpQuestions: (r.followUpQuestions as string[] | null) ?? [],
    providerSummary:
      (r.providerSummary as FinalAnswer["providerSummary"] | null) ?? [],
    sessionStatus: r.sessionStatus ?? undefined,
    evidenceUsed: (r.evidenceUsed as FinalAnswer["evidenceUsed"] | null) ?? [],
    coveredClaims:
      (r.coveredClaims as FinalAnswer["coveredClaims"] | null) ?? [],
    uncoveredClaims: (r.uncoveredClaims as string[] | null) ?? [],
    evidenceCoverageStatus:
      (r.evidenceCoverageStatus as FinalAnswer["evidenceCoverageStatus"] | null) ??
      "not_requested",
  };
}

const SESSION_INCLUDE = {
  providerCallLogs: true,
  providerAttemptLogs: true,
  agentResponses: true,
  agentCritiques: true,
  finalAnswers: true,
} as const;

export class PrismaSessionStore implements SessionStore {
  constructor(private readonly client: PrismaClient = getPrismaClient()) {}

  async create(s: SessionRecord): Promise<void> {
    await this.client.councilSession.create({
      data: {
        id: s.id,
        userPrompt: s.userPrompt,
        taskType: s.taskType,
        evidenceMode: s.evidenceMode,
        status: s.status,
        currentRound: s.currentRound ?? null,
        createdAt: new Date(s.createdAt),
        startedAt: msToDate(s.startedAt) ?? null,
        completedAt: msToDate(s.completedAt) ?? null,
        deadlineAt: new Date(s.deadlineAt),
        errorMessage: s.errorMessage ?? null,
        evidencePreview:
          s.evidencePreview === undefined
            ? Prisma.DbNull
            : (s.evidencePreview as unknown as Prisma.InputJsonValue),
      },
    });
  }

  async get(id: string): Promise<SessionRecord | undefined> {
    const row = await this.client.councilSession.findUnique({
      where: { id },
      include: SESSION_INCLUDE,
    });
    return row ? reassemble(row) : undefined;
  }

  async update(
    id: string,
    patch: Partial<SessionRecord>,
  ): Promise<SessionRecord> {
    const data: Prisma.CouncilSessionUpdateInput = {};
    if (patch.status !== undefined) data.status = patch.status;
    if (patch.currentRound !== undefined)
      data.currentRound = patch.currentRound ?? null;
    if (patch.completedAt !== undefined)
      data.completedAt = msToDate(patch.completedAt) ?? null;
    if (patch.startedAt !== undefined)
      data.startedAt = msToDate(patch.startedAt) ?? null;
    if (patch.errorMessage !== undefined)
      data.errorMessage = patch.errorMessage ?? null;
    if (patch.evidencePreview !== undefined)
      data.evidencePreview =
        patch.evidencePreview as unknown as Prisma.InputJsonValue;

    // FinalAnswer is stored in its own table — create a new revision row.
    // Two output kinds share the table: "standard" uses the dedicated columns;
    // "ideation" (docs/23) persists its full payload in `ideation` while the
    // shared safety columns stay populated. Standard-only columns are narrowed
    // via the `answerKind` discriminator so they read NULL for ideation rows.
    if (patch.finalAnswer) {
      const fa = patch.finalAnswer;
      await this.client.finalAnswer.create({
        data: {
          sessionId: id,
          revisionNumber: 1,
          status: patch.status ?? "completed",
          answerKind: fa.answerKind,
          ideation:
            fa.answerKind === "ideation"
              ? (fa as unknown as Prisma.InputJsonValue)
              : Prisma.DbNull,
          conclusion: fa.conclusion,
          finalMarkdown: fa.finalMarkdown,
          businessReadyAnswer:
            fa.answerKind === "standard" ? fa.businessReadyAnswer : null,
          internalMemo:
            fa.answerKind === "standard" ? fa.internalMemo : null,
          evidenceBackedClaims:
            fa.answerKind === "standard"
              ? (fa.evidenceBackedClaims as Prisma.InputJsonValue)
              : Prisma.DbNull,
          assumptions:
            fa.answerKind === "standard"
              ? (fa.assumptions as Prisma.InputJsonValue)
              : Prisma.DbNull,
          missingEvidence: fa.missingEvidence as Prisma.InputJsonValue,
          unsafePhrases:
            fa.unsafePhrases as unknown as Prisma.InputJsonValue,
          recommendedSafeWording:
            fa.recommendedSafeWording as Prisma.InputJsonValue,
          unresolvedDisagreements:
            fa.answerKind === "standard"
              ? (fa.unresolvedDisagreements as Prisma.InputJsonValue)
              : Prisma.DbNull,
          followUpQuestions:
            fa.answerKind === "standard"
              ? (fa.followUpQuestions as Prisma.InputJsonValue)
              : Prisma.DbNull,
          providerSummary:
            fa.providerSummary as unknown as Prisma.InputJsonValue,
          sessionStatus: fa.sessionStatus ?? null,
          riskLevel: fa.riskLevel,
          confidenceScore: fa.confidenceScore,
          evidenceUsed:
            fa.evidenceUsed as unknown as Prisma.InputJsonValue,
          coveredClaims:
            fa.coveredClaims as unknown as Prisma.InputJsonValue,
          uncoveredClaims: fa.uncoveredClaims as Prisma.InputJsonValue,
          evidenceCoverageStatus: fa.evidenceCoverageStatus ?? null,
        },
      });
    }

    if (Object.keys(data).length > 0) {
      await this.client.councilSession.update({ where: { id }, data });
    }

    const row = await this.client.councilSession.findUniqueOrThrow({
      where: { id },
      include: SESSION_INCLUDE,
    });
    return reassemble(row);
  }

  async upsertProviderCall(
    id: string,
    call: ProviderCallRecord,
  ): Promise<SessionRecord> {
    await this.client.providerCallLog.upsert({
      where: {
        sessionId_providerId_round: {
          sessionId: id,
          providerId: call.providerId,
          round: call.round,
        },
      },
      create: {
        sessionId: id,
        providerId: call.providerId,
        round: call.round,
        status: call.status,
        startedAt: msToDate(call.startedAt) ?? null,
        endedAt: msToDate(call.endedAt) ?? null,
        latencyMs: call.latencyMs ?? null,
        timeoutMs: call.timeoutMs ?? null,
        retryCount: call.retryCount,
        errorType: call.errorType ?? null,
        errorMessage: call.errorMessage ?? null,
        modelRequested: call.modelRequested ?? null,
        modelUsed: call.modelUsed ?? null,
        rateLimited: call.rateLimited ?? false,
        rawResponse: call.rawResponse ?? null,
        parsedResponse:
          call.parsedResponse === undefined
            ? Prisma.JsonNull
            : (call.parsedResponse as Prisma.InputJsonValue),
      },
      update: {
        status: call.status,
        startedAt: msToDate(call.startedAt) ?? null,
        endedAt: msToDate(call.endedAt) ?? null,
        latencyMs: call.latencyMs ?? null,
        timeoutMs: call.timeoutMs ?? null,
        retryCount: call.retryCount,
        errorType: call.errorType ?? null,
        errorMessage: call.errorMessage ?? null,
        modelRequested: call.modelRequested ?? null,
        modelUsed: call.modelUsed ?? null,
        rateLimited: call.rateLimited ?? false,
        rawResponse: call.rawResponse ?? null,
        parsedResponse:
          call.parsedResponse === undefined
            ? Prisma.JsonNull
            : (call.parsedResponse as Prisma.InputJsonValue),
      },
    });

    const row = await this.client.councilSession.findUniqueOrThrow({
      where: { id },
      include: SESSION_INCLUDE,
    });
    return reassemble(row);
  }

  async appendOpinion(id: string, op: ProviderOpinion): Promise<void> {
    await this.client.agentResponse.create({
      data: {
        sessionId: id,
        providerId: op.providerId,
        model: op.model ?? null,
        round: "initial",
        status: "succeeded",
        parsedResponse: op as unknown as Prisma.InputJsonValue,
      },
    });
  }

  async appendCritique(id: string, c: ProviderCritique): Promise<void> {
    await this.client.agentCritique.create({
      data: {
        sessionId: id,
        providerId: c.providerId,
        model: c.model ?? null,
        round: "critique",
        status: "succeeded",
        parsedResponse: c as unknown as Prisma.InputJsonValue,
      },
    });
  }

  async appendAttempt(
    id: string,
    a: ProviderAttemptRecord,
  ): Promise<void> {
    // Fire-and-forget — orchestrator must not block on forensic log writes.
    // Failures are logged but never propagated; losing a single attempt row
    // is better than stalling a session because the DB hiccupped.
    void this.client.providerAttemptLog
      .create({
        data: {
          sessionId: id,
          providerId: a.providerId,
          round: a.round,
          model: a.model,
          attemptIndex: a.attemptIndex,
          chainIndex: a.chainIndex,
          status: a.status,
          startedAt: new Date(a.startedAt),
          endedAt: new Date(a.endedAt),
          latencyMs: a.latencyMs,
          timeoutMs: a.timeoutMs,
          errorType: a.errorType ?? null,
          errorMessage: a.errorMessage ?? null,
          retryAfterMs: a.retryAfterMs ?? null,
          rateLimited: a.rateLimited ?? false,
        },
      })
      .catch((err) => {
        console.error("[PrismaSessionStore] appendAttempt failed", {
          sessionId: id,
          providerId: a.providerId,
          round: a.round,
          model: a.model,
          err,
        });
      });
  }

  async listRecent(limit?: number): Promise<SessionSummary[]> {
    const take = clampRecentLimit(limit);
    const rows = await this.client.councilSession.findMany({
      orderBy: { createdAt: "desc" },
      take,
    });
    return rows.map((r) => ({
      id: r.id,
      userPrompt: r.userPrompt,
      taskType: r.taskType as TaskType,
      evidenceMode: r.evidenceMode as EvidenceMode,
      status: r.status as SessionStatus,
      currentRound: (r.currentRound as RoundKey | null) ?? null,
      createdAt: r.createdAt.getTime(),
      completedAt: r.completedAt ? r.completedAt.getTime() : null,
      errorMessage: r.errorMessage ?? null,
    }));
  }
}
