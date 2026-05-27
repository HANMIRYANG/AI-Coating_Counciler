// In-memory session store for MVP.
//
// Sufficient for single-process dev / demo. Swap to Prisma later by
// implementing the same interface (`SessionStore`). The orchestrator never
// imports the store directly; it goes through `getSessionStore()` so tests
// can inject an alternative.

import type {
  ProviderId,
  ProviderStatus,
  RoundKey,
  SessionStatus,
  TaskType,
  EvidenceMode,
} from "./types";
import type { ProviderOpinion, ProviderCritique, FinalAnswer } from "./schemas";

/**
 * Per-attempt log entry — one row per *try*, including limiter-internal
 * retries and orchestrator-driven chain hops. The summary
 * `ProviderCallRecord` still exists for UI display; attempts give an
 * operator the full forensic trail.
 *
 * The attempt log is debug payload by default — it is NOT serialized to
 * the public GET endpoint without explicit admin authorization.
 */
export type ProviderAttemptRecord = {
  sessionId: string;
  providerId: ProviderId;
  round: RoundKey;
  /** Model name used for this try (the fallback-chain hop). */
  model: string;
  /** 0-based attempt index *within this chain hop*. */
  attemptIndex: number;
  /** 0-based position in the resolved fallback chain. */
  chainIndex: number;
  status: ProviderStatus;
  startedAt: number;
  endedAt: number;
  latencyMs: number;
  timeoutMs: number;
  errorType?: string;
  errorMessage?: string;
  retryAfterMs?: number;
  rateLimited?: boolean;
};

export type ProviderCallRecord = {
  providerId: ProviderId;
  round: RoundKey;
  status: ProviderStatus;
  startedAt?: number;
  endedAt?: number;
  latencyMs?: number;
  timeoutMs?: number;
  retryCount: number;
  errorType?: string;
  errorMessage?: string;
  /** Final model name used (after fallback chain walk). */
  modelUsed?: string;
  /** Initially-requested model name (head of fallback chain). */
  modelRequested?: string;
  /** True if a 429 cooldown was hit anywhere during the call. */
  rateLimited?: boolean;
  /**
   * Raw model output text. Captured when the call ended in `schema_invalid`
   * (JsonParseError or Zod failure) so an operator can diagnose without
   * re-running the prompt. Not stored on success to keep memory bounded.
   */
  rawResponse?: string;
  /**
   * Best-effort partially-parsed JSON. Populated when JSON.parse succeeded
   * but Zod validation failed.
   */
  parsedResponse?: unknown;
};

export type SessionRecord = {
  id: string;
  userPrompt: string;
  taskType: TaskType;
  evidenceMode: EvidenceMode;
  status: SessionStatus;
  currentRound?: RoundKey;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  deadlineAt: number;
  errorMessage?: string;
  providerCalls: ProviderCallRecord[];
  /** Full per-attempt forensic log — debug payload, NOT exposed publicly. */
  attempts: ProviderAttemptRecord[];
  opinions: ProviderOpinion[];
  critiques: ProviderCritique[];
  finalAnswer?: FinalAnswer;
};

/**
 * Public summary of a session — the ONLY shape exposed by the recent-list
 * endpoint. Deliberately excludes providerCalls, attempts, rawResponse,
 * parsedResponse, opinions, critiques, and finalAnswer so debug payload
 * can never leak through a list view.
 */
export type SessionSummary = {
  id: string;
  userPrompt: string;
  taskType: TaskType;
  evidenceMode: EvidenceMode;
  status: SessionStatus;
  currentRound: RoundKey | null;
  createdAt: number;
  completedAt: number | null;
  errorMessage: string | null;
};

/** Defaults for listRecent — small enough for sidebar, bounded for safety. */
export const DEFAULT_RECENT_LIMIT = 20;
export const MAX_RECENT_LIMIT = 100;

export interface SessionStore {
  create(s: SessionRecord): Promise<void>;
  get(id: string): Promise<SessionRecord | undefined>;
  update(id: string, patch: Partial<SessionRecord>): Promise<SessionRecord>;
  upsertProviderCall(
    id: string,
    call: ProviderCallRecord,
  ): Promise<SessionRecord>;
  appendOpinion(id: string, op: ProviderOpinion): Promise<void>;
  appendCritique(id: string, c: ProviderCritique): Promise<void>;
  appendAttempt(id: string, a: ProviderAttemptRecord): Promise<void>;
  /**
   * Return the most-recently-created sessions, newest first, as summaries.
   * `limit` is clamped to [1, MAX_RECENT_LIMIT]; missing / non-finite /
   * non-positive values fall back to DEFAULT_RECENT_LIMIT.
   */
  listRecent(limit?: number): Promise<SessionSummary[]>;
}

// Exported so alternate SessionStore implementations (PrismaSessionStore)
// can clamp `listRecent` limits identically.
export function clampRecentLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit) || limit <= 0) {
    return DEFAULT_RECENT_LIMIT;
  }
  return Math.min(Math.floor(limit), MAX_RECENT_LIMIT);
}

function toSessionSummary(s: SessionRecord): SessionSummary {
  return {
    id: s.id,
    userPrompt: s.userPrompt,
    taskType: s.taskType,
    evidenceMode: s.evidenceMode,
    status: s.status,
    currentRound: s.currentRound ?? null,
    createdAt: s.createdAt,
    completedAt: s.completedAt ?? null,
    errorMessage: s.errorMessage ?? null,
  };
}

export class MemorySessionStore implements SessionStore {
  private map = new Map<string, SessionRecord>();

  async create(s: SessionRecord): Promise<void> {
    this.map.set(s.id, s);
  }

  async get(id: string): Promise<SessionRecord | undefined> {
    return this.map.get(id);
  }

  async update(
    id: string,
    patch: Partial<SessionRecord>,
  ): Promise<SessionRecord> {
    const cur = this.map.get(id);
    if (!cur) throw new Error(`session ${id} not found`);
    const next = { ...cur, ...patch };
    this.map.set(id, next);
    return next;
  }

  async upsertProviderCall(
    id: string,
    call: ProviderCallRecord,
  ): Promise<SessionRecord> {
    const cur = this.map.get(id);
    if (!cur) throw new Error(`session ${id} not found`);
    const idx = cur.providerCalls.findIndex(
      (c) => c.providerId === call.providerId && c.round === call.round,
    );
    if (idx === -1) cur.providerCalls.push(call);
    else cur.providerCalls[idx] = { ...cur.providerCalls[idx], ...call };
    this.map.set(id, cur);
    return cur;
  }

  async appendOpinion(id: string, op: ProviderOpinion): Promise<void> {
    const cur = this.map.get(id);
    if (!cur) return;
    cur.opinions.push(op);
    this.map.set(id, cur);
  }

  async appendCritique(id: string, c: ProviderCritique): Promise<void> {
    const cur = this.map.get(id);
    if (!cur) return;
    cur.critiques.push(c);
    this.map.set(id, cur);
  }

  async appendAttempt(id: string, a: ProviderAttemptRecord): Promise<void> {
    const cur = this.map.get(id);
    if (!cur) return;
    cur.attempts.push(a);
    this.map.set(id, cur);
  }

  async listRecent(limit?: number): Promise<SessionSummary[]> {
    const effective = clampRecentLimit(limit);
    // Snapshot values then sort by createdAt descending. Ties are stable
    // (Array.prototype.sort is stable since ES2019).
    const all = Array.from(this.map.values());
    all.sort((a, b) => b.createdAt - a.createdAt);
    return all.slice(0, effective).map(toSessionSummary);
  }
}

/**
 * Construct an *isolated* in-memory store. Useful for tests that want to
 * exercise the store without sharing state with `getSessionStore()` (which
 * is a process-global singleton).
 */
export function createMemorySessionStore(): MemorySessionStore {
  return new MemorySessionStore();
}

// Single global store survives across API routes inside one Next.js process.
// We attach to globalThis so hot-reload during dev does not lose sessions.
//
// SESSION_STORE selects the backing implementation:
//   "memory" (default) — in-process MemorySessionStore. Process restart
//                        wipes all sessions. Single-process deployments
//                        only.
//   "prisma"           — PrismaSessionStore (sibling file). Required for
//                        multi-worker / multi-process deployments. Needs
//                        DATABASE_URL + a migrated schema; see
//                        docker-compose.yml at the repo root for the
//                        local Postgres bootstrap.
const KEY = "__ai_coating_council_session_store__";

function selectedBackend(): "memory" | "prisma" {
  const raw = (process.env.SESSION_STORE ?? "memory").trim().toLowerCase();
  return raw === "prisma" ? "prisma" : "memory";
}

function getOrCreateGlobalStore(): SessionStore {
  const g = globalThis as Record<string, unknown>;
  if (g[KEY]) return g[KEY] as SessionStore;

  if (selectedBackend() === "prisma") {
    // Lazy require so the memory-only code path never loads @prisma/client.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require("./prismaSessionStore") as typeof import("./prismaSessionStore");
    g[KEY] = new mod.PrismaSessionStore();
  } else {
    g[KEY] = new MemorySessionStore();
  }
  return g[KEY] as SessionStore;
}

export function getSessionStore(): SessionStore {
  return getOrCreateGlobalStore();
}

/**
 * TEST-ONLY: replace the process-global memory store with a fresh
 * `MemorySessionStore`. Lets a test isolate itself from sessions that
 * earlier tests / previous test files may have planted on the singleton.
 *
 * Do NOT call this from production code paths — it would silently wipe
 * in-flight sessions belonging to live users.
 */
export function resetGlobalSessionStoreForTests(): void {
  const g = globalThis as Record<string, unknown>;
  g[KEY] = new MemorySessionStore();
}

export function newSessionId(): string {
  // Avoid extra dep; "cs_" + 24 base36 chars from Math.random + timestamp.
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 12);
  const rand2 = Math.random().toString(36).slice(2, 10);
  return `cs_${ts}${rand}${rand2}`;
}
