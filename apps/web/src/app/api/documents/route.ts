// POST /api/documents
//   Accepts a single text-only document (text/plain or text/markdown),
//   chunks the content deterministically, and persists a Document plus its
//   DocumentChunk rows via Prisma. Returns the new document id + chunk
//   count. Binary formats (PDF / DOCX / images) are rejected with HTTP 415.
//
// GET /api/documents
//   Lightweight document list. Newest first. Never returns chunk content
//   (the chunk payload can be large and is not needed for a list view).
//
// Persistence backend:
//   This endpoint always uses Prisma — it does not fall back to an
//   in-memory store. If the database is unreachable, we answer 503 with
//   a typed message so the caller knows to configure DATABASE_URL +
//   migrations rather than retrying blindly.
//
// Scope reminder:
//   This route is text intake + list ONLY — it does not run retrieval. (At
//   intake DocumentService best-effort embeds chunks; retrieval — keyword /
//   vector / hybrid — happens elsewhere via the evidence bundle.) Rich metadata
//   (issuer / testMethod / etc.) is validated at the API boundary, persisted
//   into `Document.metadata`, surfaced in the GET summary, and used as a filter
//   by search / evidence retrieval.

import { NextResponse } from "next/server";

import { checkWriteAuth } from "@/lib/apiAuth";
import {
  CreateDocumentRequestSchema,
  SupportedDocumentMimeSchema,
  isKnownUnsupportedMime,
} from "@/lib/documents/schemas";
import {
  DocumentService,
  DocumentServiceError,
} from "@/lib/documents/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const denied = checkWriteAuth(req);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  // Friendlier 415 for known binary formats. Anything not on the supported
  // list still falls through to Zod and yields the same 415 path below.
  const claimed = (body as { mimeType?: unknown })?.mimeType;
  if (typeof claimed === "string") {
    const supported = SupportedDocumentMimeSchema.safeParse(claimed);
    if (!supported.success) {
      const labeled = isKnownUnsupportedMime(claimed);
      return NextResponse.json(
        {
          error: "unsupported_media_type",
          message: labeled
            ? `mimeType '${claimed}' is a binary format. Phase 2 will add a parser; for now extract text first and send text/plain or text/markdown.`
            : `mimeType '${claimed}' is not supported. Use text/plain or text/markdown.`,
        },
        { status: 415 },
      );
    }
  }

  const parsed = CreateDocumentRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const result = await new DocumentService().create(parsed.data);
    return NextResponse.json(
      {
        id: result.id,
        chunkCount: result.chunkCount,
        status: "chunked",
      },
      { status: 201 },
    );
  } catch (err) {
    return handleServiceError(err);
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const raw = url.searchParams.get("limit");
  const parsed = raw === null ? undefined : Number(raw);
  const limit =
    parsed !== undefined && Number.isFinite(parsed) ? parsed : undefined;

  try {
    const documents = await new DocumentService().list(limit);
    return NextResponse.json({ documents });
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
            "Document intake requires a configured PostgreSQL database. Set DATABASE_URL and run `npx prisma migrate dev` from apps/web.",
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
