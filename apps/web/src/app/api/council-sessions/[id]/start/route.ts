// POST /api/council-sessions/:id/start
//
// MVP: the create endpoint already triggers orchestration. This endpoint is
// kept for API completeness and is idempotent — it only re-runs orchestration
// if the session has not yet entered round1_running.

import { NextResponse } from "next/server";
import { getSessionStore } from "@/lib/council/store";
import { buildProviderRegistry } from "@/lib/council/providers";
import {
  CouncilOrchestrator,
  defaultTimingConfig,
} from "@/lib/council/orchestrator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const store = getSessionStore();
  const sess = await store.get(params.id);
  if (!sess) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  if (sess.status !== "created") {
    return NextResponse.json(
      { sessionId: sess.id, status: sess.status, alreadyStarted: true },
      { status: 200 },
    );
  }

  const orchestrator = new CouncilOrchestrator(
    buildProviderRegistry(),
    defaultTimingConfig(),
  );
  void orchestrator.run(params.id);

  return NextResponse.json({ sessionId: params.id, status: "started" });
}
