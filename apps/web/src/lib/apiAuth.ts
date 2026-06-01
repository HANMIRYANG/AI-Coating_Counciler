// Lightweight optional shared-secret gate for mutating (write) API routes.
//
// If `API_WRITE_TOKEN` is set (non-empty), every guarded write endpoint
// requires the caller to send `x-api-write-token` matching it; mismatches /
// missing → 401. If the env var is UNSET, writes are open — preserving the
// local / MVP dev flow unchanged.
//
// This is a deliberate stopgap, NOT a substitute for real auth / RBAC at
// deployment. Read (GET) endpoints are not gated here; the debug payload has
// its own `ADMIN_DEBUG_TOKEN` gate.

import { NextResponse } from "next/server";

/**
 * Returns a 401 NextResponse when the request is NOT authorized to perform a
 * write, or `null` when it may proceed (either the token is unset → open, or
 * the provided header matches).
 */
export function checkWriteAuth(req: Request): NextResponse | null {
  const token = process.env.API_WRITE_TOKEN;
  if (!token || token.trim().length === 0) return null; // open (dev / MVP)

  const header = req.headers.get("x-api-write-token");
  if (header === token) return null;

  return NextResponse.json(
    {
      error: "unauthorized",
      message:
        "This write endpoint requires a valid x-api-write-token header (API_WRITE_TOKEN is configured).",
    },
    { status: 401 },
  );
}
