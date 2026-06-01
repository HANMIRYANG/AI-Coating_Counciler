// GET /api/config
//   Read-only, NON-SECRET runtime configuration for the settings view:
//   timeout/threshold policy, default model chain, session-store mode, and
//   mock-provider flag. Never returns API keys, tokens, or connection strings.

import { NextResponse } from "next/server";
import { defaultTimingConfig } from "@/lib/council/orchestrator";
import { DEFAULT_MODELS } from "@/lib/council/models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const t = defaultTimingConfig();
  const sessionStore =
    (process.env.SESSION_STORE ?? "memory").trim().toLowerCase() === "prisma"
      ? "prisma"
      : "memory";
  const useMockProviders =
    (process.env.USE_MOCK_PROVIDERS ?? "").trim().toLowerCase() === "true";
  const pollingIntervalMs =
    Number(process.env.NEXT_PUBLIC_POLLING_INTERVAL_MS) || 1500;

  return NextResponse.json({
    timeouts: {
      providerTimeoutMs: t.providerTimeoutMs,
      roundTimeoutMs: t.roundTimeoutMs,
      synthesisTimeoutMs: t.synthesisTimeoutMs,
      sessionTimeoutMs: t.sessionTimeoutMs,
      maxRetries: t.maxRetries,
    },
    thresholds: {
      minOpinionsForMeeting: t.minOpinionsForMeeting,
      minCritiquesForSynthesis: t.minCritiquesForSynthesis,
    },
    models: DEFAULT_MODELS,
    sessionStore,
    useMockProviders,
    pollingIntervalMs,
  });
}
