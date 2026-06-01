// POST /api/council-sessions
//   Creates a session, returns sessionId IMMEDIATELY, and starts the
//   multi-round orchestration in the background (do not await). This
//   guarantees the frontend never blocks waiting for AI calls — it polls
//   for status instead.
//
// GET /api/council-sessions?limit=N
//   Returns recent session SUMMARIES (id, userPrompt, taskType,
//   evidenceMode, status, currentRound, createdAt, completedAt,
//   errorMessage). Newest first. Never includes providerCalls / attempts /
//   rawResponse / parsedResponse / opinions / critiques / finalAnswer —
//   debug payload stays out of the list view by construction.
//
//   NOTE: This endpoint is intentionally unauthenticated for local / MVP
//   use. In production, gate it with admin/RBAC and consider per-tenant
//   filtering before exposing it beyond a trusted network.

import { NextResponse } from "next/server";
import { checkWriteAuth } from "@/lib/apiAuth";
import { CreateSessionRequestSchema } from "@/lib/council/schemas";
import { getSessionStore, newSessionId, type SessionRecord } from "@/lib/council/store";
import { buildProviderRegistry } from "@/lib/council/providers";
import {
  CouncilOrchestrator,
  defaultTimingConfig,
} from "@/lib/council/orchestrator";
import { runAfterResponse } from "@/lib/runtime/backgroundTask";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The council run continues after this route returns the session id. On
// Vercel the function must stay alive for that background work (via
// runAfterResponse → waitUntil), bounded by this ceiling. Keep it >= the
// configured SESSION_TIMEOUT_MS and within your Vercel plan's limit.
export const maxDuration = 300;

export async function POST(req: Request) {
  const denied = checkWriteAuth(req);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = CreateSessionRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const store = getSessionStore();
  const id = newSessionId();
  const cfg = defaultTimingConfig();
  const now = Date.now();

  const record: SessionRecord = {
    id,
    userPrompt: parsed.data.prompt,
    taskType: parsed.data.taskType,
    evidenceMode: parsed.data.evidenceMode,
    status: "created",
    createdAt: now,
    startedAt: now,
    deadlineAt: now + cfg.sessionTimeoutMs,
    providerCalls: [],
    attempts: [],
    opinions: [],
    critiques: [],
  };
  await store.create(record);

  // Background orchestration — DO NOT await. Runs after the response via a
  // Vercel-safe mechanism (waitUntil on Vercel, in-process elsewhere). The
  // orchestrator records its own errors on the session record.
  const orchestrator = new CouncilOrchestrator(buildProviderRegistry(), cfg);
  runAfterResponse(orchestrator.run(id));

  return NextResponse.json(
    { sessionId: id, status: "created" },
    { status: 201 },
  );
}

export async function GET(req: Request) {
  const store = getSessionStore();
  const url = new URL(req.url);
  const raw = url.searchParams.get("limit");
  let limit: number | undefined;
  if (raw !== null) {
    const n = Number(raw);
    // The store clamps non-finite / non-positive limits to the default,
    // so we don't have to reject them up here.
    if (Number.isFinite(n)) limit = n;
  }
  const sessions = await store.listRecent(limit);
  return NextResponse.json({ sessions });
}
