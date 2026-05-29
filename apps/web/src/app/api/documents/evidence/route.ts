// GET /api/documents/evidence?query=...
//   Normalizes internal keyword document-search hits into bounded
//   evidence/citation candidates (see lib/documents/evidence-bundle.ts).
//   Returns the normalized query, the candidates, a count, and retrieval
//   mode/status metadata. Never returns full chunk bodies.
//
// Contract:
//   - missing / empty `query`        → 400 invalid_request
//   - invalid filter / limit         → 400 invalid_request
//   - database unreachable           → 503 database_unavailable
//   - success                        → 200 { query, normalizedQuery,
//                                            retrievalMode, retrievalStatus,
//                                            count, candidates }
//
// Scope reminder (Step 6 foundation):
//   No embeddings, no vector similarity, no external fetching, no final RAG
//   retrieval, no orchestrator wiring. This normalizes keyword hits into the
//   evidence vocabulary the orchestrator will later consume.

import { NextResponse } from "next/server";

import { DocumentServiceError } from "@/lib/documents/service";
import {
  EvidenceBundleRequestSchema,
  EvidenceBundleService,
} from "@/lib/documents/evidence-bundle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Treat blank / whitespace-only filter params as absent rather than as a
// validation error, so `?query=foo&productName=` behaves like no filter.
function optionalParam(value: string | null): string | undefined {
  if (value === null) return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;

  const rawLimit = sp.get("limit");
  const limitNum = rawLimit === null ? undefined : Number(rawLimit);

  const candidate = {
    // Empty / missing query stays "" so the schema rejects it with 400.
    query: sp.get("query") ?? "",
    documentType: optionalParam(sp.get("documentType")),
    productName: optionalParam(sp.get("productName")),
    issuer: optionalParam(sp.get("issuer")),
    limit:
      limitNum !== undefined && Number.isFinite(limitNum) ? limitNum : undefined,
  };

  const parsed = EvidenceBundleRequestSchema.safeParse(candidate);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const bundle = await new EvidenceBundleService().build(parsed.data);
    return NextResponse.json({ query: parsed.data.query, ...bundle });
  } catch (err) {
    return handleServiceError(err);
  }
}

function handleServiceError(err: unknown) {
  if (err instanceof DocumentServiceError) {
    if (err.code === "database_unavailable") {
      return NextResponse.json(
        {
          error: "database_unavailable",
          message:
            "Evidence retrieval requires a configured PostgreSQL database. Set DATABASE_URL and run `npx prisma migrate dev` from apps/web.",
        },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { error: "internal_error", message: err.message },
      { status: 500 },
    );
  }
  const message = err instanceof Error ? err.message : String(err);
  return NextResponse.json(
    { error: "internal_error", message },
    { status: 500 },
  );
}
