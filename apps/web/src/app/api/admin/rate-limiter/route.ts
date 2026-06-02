// /api/admin/rate-limiter
//
// Operational visibility + safe recovery for the per-provider rate limiter.
//
//   GET  → diagnostics snapshot per provider: health, cooldownMs, inFlight,
//          queueLength, maxConcurrent. Use this to confirm a "slot-acquire
//          timed out" outage is leaked/saturated slots (inFlight pinned at
//          maxConcurrent with a growing queue) rather than model latency.
//   POST → clear all limiter state (inFlight / queue / cooldown) so a stuck or
//          saturated provider self-heals without a process restart. In-flight
//          tasks keep running but stop being counted; queued waiters fail fast.
//
// Auth (mirrors the `?debug=1` gate on the session endpoint):
//   - If ADMIN_DEBUG_TOKEN is set → caller MUST send a matching
//     `x-admin-debug-token` header; otherwise 403.
//   - If ADMIN_DEBUG_TOKEN is unset → allowed ONLY when NODE_ENV !== "production".
//     This keeps the recovery tool open for local dev while preventing an
//     unauthenticated reset in production.

import { NextResponse } from "next/server";
import {
  snapshotProviderHealth,
  resetRateLimiters,
} from "@/lib/council/rateLimiter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorize(req: Request): boolean {
  const token = process.env.ADMIN_DEBUG_TOKEN;
  if (token && token.trim().length > 0) {
    return req.headers.get("x-admin-debug-token") === token;
  }
  return process.env.NODE_ENV !== "production";
}

export async function GET(req: Request) {
  if (!authorize(req)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  return NextResponse.json({ providerHealth: snapshotProviderHealth() });
}

export async function POST(req: Request) {
  if (!authorize(req)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  resetRateLimiters();
  return NextResponse.json({
    ok: true,
    providerHealth: snapshotProviderHealth(),
  });
}
