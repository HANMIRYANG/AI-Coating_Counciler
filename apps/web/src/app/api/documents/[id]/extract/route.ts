// POST /api/documents/:id/extract
//   Lazy extraction path for large originals stored in Vercel Blob.
//
// Blob upload registration stays cheap: it creates a Document row with
// status `needs_extraction` and no chunks. This route is called only when the
// original is actually needed for search / council evidence. It fetches the
// private Blob server-side, extracts a text layer or OCR fallback, then
// attaches chunks to the existing Document row.

import { get } from "@vercel/blob";
import { NextResponse } from "next/server";

import { checkWriteAuth } from "@/lib/apiAuth";
import {
  DocumentExtractError,
  MAX_PARSE_BYTES,
  extractDocumentTextWithOcrFallback,
  extractErrorToStatus,
} from "@/lib/documents/extract";
import {
  DocumentService,
  DocumentServiceError,
  type DocumentOriginalForExtraction,
} from "@/lib/documents/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
) {
  const denied = checkWriteAuth(req);
  if (denied) return denied;

  const service = new DocumentService();
  let original: DocumentOriginalForExtraction;
  try {
    original = await service.getOriginalForExtraction(params.id);
  } catch (err) {
    return handleServiceError(err);
  }

  if (
    original.originalBlobSizeBytes !== null &&
    original.originalBlobSizeBytes > MAX_PARSE_BYTES
  ) {
    return NextResponse.json(
      {
        error: "payload_too_large",
        message: `Original file exceeds ${MAX_PARSE_BYTES} bytes.`,
      },
      { status: 413 },
    );
  }

  let buffer: Buffer;
  let mimeType: string;
  try {
    const blob = await get(original.originalBlobPath ?? original.originalBlobUrl, {
      access: "private",
      useCache: false,
    });
    if (!blob || blob.statusCode !== 200 || !blob.stream) {
      return NextResponse.json(
        { error: "blob_not_found", message: "Original Blob was not found." },
        { status: 404 },
      );
    }
    if (blob.blob.size > MAX_PARSE_BYTES) {
      return NextResponse.json(
        {
          error: "payload_too_large",
          message: `Original file exceeds ${MAX_PARSE_BYTES} bytes.`,
        },
        { status: 413 },
      );
    }
    buffer = await streamToBuffer(blob.stream);
    mimeType =
      blob.blob.contentType ??
      original.originalBlobContentType ??
      original.mimeType;
  } catch (err) {
    return NextResponse.json(
      {
        error: "blob_fetch_failed",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 502 },
    );
  }

  let extracted;
  try {
    extracted = await extractDocumentTextWithOcrFallback(buffer, mimeType, {
      filename: original.originalName,
    });
  } catch (err) {
    return handleExtractError(err);
  }

  try {
    const updated = await service.attachExtractedTextToOriginal({
      id: original.id,
      content: extracted.text,
      category:
        extracted.extractionMethod === "ocr"
          ? `parsed_${extracted.kind}_ocr`
          : `parsed_${extracted.kind}`,
      metadata: {
        ...(original.metadata ?? {}),
        extractionMethod: extracted.extractionMethod,
        ...(extracted.ocrProvider
          ? { ocrProvider: extracted.ocrProvider }
          : {}),
      },
    });
    return NextResponse.json({
      id: updated.id,
      chunkCount: updated.chunkCount,
      status: "chunked",
      kind: extracted.kind,
      pageCount: extracted.pageCount ?? null,
      extractedChars: extracted.text.length,
      extractionMethod: extracted.extractionMethod,
      ocrProvider: extracted.ocrProvider ?? null,
    });
  } catch (err) {
    return handleServiceError(err);
  }
}

async function streamToBuffer(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = Buffer.from(value);
    chunks.push(chunk);
    total += chunk.length;
    if (total > MAX_PARSE_BYTES) {
      throw new Error(`Original file exceeds ${MAX_PARSE_BYTES} bytes.`);
    }
  }
  return Buffer.concat(chunks, total);
}

function handleExtractError(err: unknown) {
  if (err instanceof DocumentExtractError) {
    // Shared status mapping (extractErrorToStatus) — identical to the inline
    // /api/documents/parse route so the same cause never returns two statuses.
    const error =
      err.code === "unsupported_type" ? "unsupported_media_type" : err.code;
    return NextResponse.json(
      { error, message: err.message },
      { status: extractErrorToStatus(err.code) },
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

function handleServiceError(err: unknown) {
  if (err instanceof DocumentServiceError) {
    if (err.code === "database_unavailable") {
      return NextResponse.json(
        {
          error: "database_unavailable",
          message:
            "Document extraction requires a configured PostgreSQL database. Set DATABASE_URL and run migrations from apps/web.",
        },
        { status: 503 },
      );
    }
    if (err.code === "not_found") {
      return NextResponse.json(
        { error: "not_found", message: err.message },
        { status: 404 },
      );
    }
    if (err.code === "not_extractable") {
      return NextResponse.json(
        { error: "not_extractable", message: err.message },
        { status: 422 },
      );
    }
    return NextResponse.json(
      { error: "internal_error", message: err.message },
      { status: 500 },
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
