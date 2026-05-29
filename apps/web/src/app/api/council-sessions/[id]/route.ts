// GET /api/council-sessions/:id
//
// Returns the current session snapshot for UI polling. Includes provider
// statuses for every round, all collected opinions / critiques, and the
// final answer when synthesis has completed.
//
// Debug payload (`?debug=1`):
//   When authorized, the response is enriched with:
//     - per-call `rawResponse` / `parsedResponse` (only ever populated for
//       schema_invalid)
//     - a full `attempts[]` forensic log (one entry per try, including
//       limiter-internal 429 retries and orchestrator-driven chain hops)
//     - `providerHealth` snapshot (cooldown / health state)
//
// Authorization rules:
//   - If `ADMIN_DEBUG_TOKEN` env is set → caller MUST send
//     `x-admin-debug-token` matching it. Mismatched / missing → 403.
//   - If `ADMIN_DEBUG_TOKEN` is unset → debug is allowed ONLY when
//     `NODE_ENV !== "production"`. In production with no token, `?debug=1`
//     is forbidden (403). This prevents accidental data leaks if the
//     endpoint is exposed without explicit admin auth.

import { NextResponse } from "next/server";
import { getSessionStore } from "@/lib/council/store";
import { snapshotProviderHealth } from "@/lib/council/rateLimiter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: { id: string } },
) {
  const store = getSessionStore();
  const sess = await store.get(params.id);
  if (!sess) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const debugRequested =
    new URL(req.url).searchParams.get("debug") === "1";

  const debugAuth = evaluateDebugAuth(req, debugRequested);
  if (debugAuth === "forbidden") {
    return NextResponse.json(
      { error: "debug_forbidden" },
      { status: 403 },
    );
  }
  const debug = debugAuth === "allowed";

  const payload: Record<string, unknown> = {
    id: sess.id,
    status: sess.status,
    currentRound: sess.currentRound ?? null,
    userPrompt: sess.userPrompt,
    taskType: sess.taskType,
    evidenceMode: sess.evidenceMode,
    createdAt: sess.createdAt,
    startedAt: sess.startedAt ?? null,
    completedAt: sess.completedAt ?? null,
    deadlineAt: sess.deadlineAt,
    errorMessage: sess.errorMessage ?? null,
    providers: sess.providerCalls.map((c) => ({
      providerId: c.providerId,
      round: c.round,
      status: c.status,
      latencyMs: c.latencyMs ?? null,
      timeoutMs: c.timeoutMs ?? null,
      retryCount: c.retryCount,
      errorType: c.errorType ?? null,
      errorMessage: c.errorMessage ?? null,
      modelRequested: c.modelRequested ?? null,
      modelUsed: c.modelUsed ?? null,
      rateLimited: c.rateLimited ?? false,
      // Debug-only: raw LLM output. Never exposed to public callers.
      ...(debug
        ? {
            rawResponse: c.rawResponse ?? null,
            parsedResponse: c.parsedResponse ?? null,
          }
        : {}),
    })),
    providerHealth: snapshotProviderHealth(),
    opinions: sess.opinions,
    critiques: sess.critiques,
    finalAnswer: sess.finalAnswer ?? null,
    // Bounded internal-evidence retrieval preview (Step 7). Snippets only —
    // never full chunk bodies. `null` for legacy sessions created before the
    // preflight ran.
    evidencePreview: sess.evidencePreview ?? null,
    debug,
  };

  if (debug) {
    payload.attempts = sess.attempts;
  }

  return NextResponse.json(payload);
}

/**
 * Returns:
 *   "allowed"   — debug requested and authorized
 *   "denied"    — debug NOT requested (treat as public)
 *   "forbidden" — debug requested but not authorized (respond 403)
 */
function evaluateDebugAuth(
  req: Request,
  debugRequested: boolean,
): "allowed" | "denied" | "forbidden" {
  if (!debugRequested) return "denied";

  const adminToken = process.env.ADMIN_DEBUG_TOKEN;
  if (adminToken && adminToken.trim().length > 0) {
    const header = req.headers.get("x-admin-debug-token");
    return header === adminToken ? "allowed" : "forbidden";
  }
  // No token configured → allow in non-production only.
  return process.env.NODE_ENV !== "production" ? "allowed" : "forbidden";
}
