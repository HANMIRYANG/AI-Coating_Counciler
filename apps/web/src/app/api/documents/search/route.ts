// GET /api/documents/search?q=...
//   Deterministic keyword search over persisted DocumentChunk content,
//   narrowed by optional metadata filters (documentType / productName /
//   issuer) and bounded by `limit`. Returns lightweight results — document
//   id, filename, chunk id/index, a short snippet, metadata, and a simple
//   deterministic score. Never returns full chunk bodies.
//
// Contract:
//   - missing / empty `q`            → 400 invalid_request
//   - invalid filter / limit         → 400 invalid_request
//   - database unreachable           → 503 database_unavailable
//   - success                        → 200 { query, count, results }
//
// Scope reminder (Step 5 foundation):
//   No embeddings, no vector similarity, no external fetching, no
//   evidence-bundle assembly, no orchestrator wiring. This is a keyword
//   layer over already-persisted rows.

import { NextResponse } from "next/server";

import {
  DocumentService,
  DocumentServiceError,
} from "@/lib/documents/service";
import { SearchDocumentsRequestSchema } from "@/lib/documents/search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Treat blank / whitespace-only filter params as absent rather than as a
// validation error, so `?q=foo&productName=` behaves like no filter.
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
    // Empty / missing q stays "" so the schema rejects it with 400.
    q: sp.get("q") ?? "",
    documentType: optionalParam(sp.get("documentType")),
    productName: optionalParam(sp.get("productName")),
    issuer: optionalParam(sp.get("issuer")),
    limit:
      limitNum !== undefined && Number.isFinite(limitNum) ? limitNum : undefined,
  };

  const parsed = SearchDocumentsRequestSchema.safeParse(candidate);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const results = await new DocumentService().search(parsed.data);
    return NextResponse.json({
      query: parsed.data.q,
      count: results.length,
      results,
    });
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
            "Document search requires a configured PostgreSQL database. Set DATABASE_URL and run `npx prisma migrate dev` from apps/web.",
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
