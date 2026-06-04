// POST /api/documents/embeddings/backfill[?limit=N]
//   Embeds persisted chunks that have no stored vector yet (pre-feature chunks,
//   or chunks whose best-effort embedding failed at intake). Bounded per call —
//   call repeatedly until the returned `remaining` is 0.
//
//   Uses the configured embedder (deterministic MockEmbedder unless
//   USE_MOCK_PROVIDERS=false + OPENAI_API_KEY). Write-gated by checkWriteAuth.

import { NextResponse } from "next/server";

import { checkWriteAuth } from "@/lib/apiAuth";
import { DocumentService, DocumentServiceError } from "@/lib/documents/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const denied = checkWriteAuth(req);
  if (denied) return denied;

  let limit: number | undefined;
  const raw = new URL(req.url).searchParams.get("limit");
  if (raw !== null) {
    const n = Number(raw);
    if (Number.isFinite(n)) limit = n;
  }

  try {
    const result = await new DocumentService().backfillEmbeddings({ limit });
    return NextResponse.json(result);
  } catch (err) {
    if (
      err instanceof DocumentServiceError &&
      err.code === "database_unavailable"
    ) {
      return NextResponse.json(
        {
          error: "database_unavailable",
          message:
            "Embedding backfill requires a configured PostgreSQL database. Set DATABASE_URL and run migrations from apps/web.",
        },
        { status: 503 },
      );
    }
    return NextResponse.json(
      {
        error: "internal_error",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
