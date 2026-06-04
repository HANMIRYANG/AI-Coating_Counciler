// POST /api/documents/parse
//   Accepts a PDF / DOCX / OCR-supported image via multipart/form-data and
//   extracts text (text layer first; OCR fallback for a scanned PDF or an
//   image — see extractDocumentTextWithOcrFallback), then feeds the text into
//   the SAME deterministic chunking + persistence path as the inline text
//   intake (DocumentService.create).
//
//   This is a self-contained path: it does NOT require Vercel Blob — the file
//   is parsed server-side and only the extracted text + chunks are persisted
//   (the original binary is not stored here). OCR runs only when
//   DOCUMENT_OCR_PROVIDER is configured; otherwise OCR-needing inputs surface
//   ocr_unavailable.
//
// Form fields:
//   - file       (required) the PDF/DOCX/image binary
//   - metadata   (optional) JSON string validated by DocumentMetadataSchema
//
// Contract (status via extractErrorToStatus):
//   - missing/!file               → 400 invalid_request
//   - file too large              → 413 payload_too_large
//   - unsupported type            → 415 unsupported_media_type
//   - invalid metadata JSON/shape → 400 invalid_request
//   - no text layer (scanned)     → 422 no_text_extracted
//   - parser failure              → 422 parse_failed
//   - OCR not configured          → 503 ocr_unavailable
//   - OCR provider call failed     → 502 ocr_failed
//   - database unreachable        → 503 database_unavailable
//   - success                     → 201 { id, chunkCount, status, kind, pageCount }

import { NextResponse } from "next/server";

import { checkWriteAuth } from "@/lib/apiAuth";
import {
  DocumentMetadataSchema,
  type DocumentMetadata,
} from "@/lib/documents/schemas";
import {
  DocumentService,
  DocumentServiceError,
} from "@/lib/documents/service";
import {
  DocumentExtractError,
  MAX_PARSE_BYTES,
  extractDocumentTextWithOcrFallback,
  extractErrorToStatus,
  inferMimeFromFilename,
  isParseableMime,
} from "@/lib/documents/extract";
import { isOcrSupportedMime } from "@/lib/documents/ocr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type UploadedFile = {
  name: string;
  type: string;
  size: number;
  arrayBuffer: () => Promise<ArrayBuffer>;
};

function isUploadedFile(value: unknown): value is UploadedFile {
  return (
    typeof value === "object" &&
    value !== null &&
    "arrayBuffer" in value &&
    typeof (value as { arrayBuffer?: unknown }).arrayBuffer === "function" &&
    typeof (value as { name?: unknown }).name === "string"
  );
}

export async function POST(req: Request) {
  const denied = checkWriteAuth(req);
  if (denied) return denied;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      {
        error: "invalid_request",
        message: "Expected multipart/form-data with a `file` field.",
      },
      { status: 400 },
    );
  }

  const file = form.get("file");
  if (!isUploadedFile(file)) {
    return NextResponse.json(
      { error: "invalid_request", message: "Missing `file` field." },
      { status: 400 },
    );
  }

  if (file.size > MAX_PARSE_BYTES) {
    return NextResponse.json(
      {
        error: "payload_too_large",
        message: `File exceeds ${MAX_PARSE_BYTES} bytes.`,
      },
      { status: 413 },
    );
  }

  const mimeType =
    (file.type && file.type.length > 0 ? file.type : undefined) ??
    inferMimeFromFilename(file.name) ??
    "";
  if (!isParseableMime(mimeType) && !isOcrSupportedMime(mimeType)) {
    return NextResponse.json(
      {
        error: "unsupported_media_type",
        message: `'${mimeType || file.name}' is not parseable. Supported inputs are PDF, DOCX, and OCR-supported images.`,
      },
      { status: 415 },
    );
  }

  // Optional metadata: a JSON string validated (and key-stripped) by Zod.
  let metadata: DocumentMetadata | undefined;
  const rawMeta = form.get("metadata");
  if (typeof rawMeta === "string" && rawMeta.trim().length > 0) {
    let parsedMeta: unknown;
    try {
      parsedMeta = JSON.parse(rawMeta);
    } catch {
      return NextResponse.json(
        { error: "invalid_request", message: "`metadata` is not valid JSON." },
        { status: 400 },
      );
    }
    const result = DocumentMetadataSchema.safeParse(parsedMeta);
    if (!result.success) {
      return NextResponse.json(
        { error: "invalid_request", details: result.error.flatten() },
        { status: 400 },
      );
    }
    metadata = result.data;
  }

  // Extract the text layer.
  const buffer = Buffer.from(await file.arrayBuffer());
  let extracted;
  try {
    extracted = await extractDocumentTextWithOcrFallback(buffer, mimeType, {
      filename: file.name,
    });
  } catch (err) {
    if (err instanceof DocumentExtractError) {
      // Shared status mapping (extractErrorToStatus) keeps this route in sync
      // with /api/documents/:id/extract: unsupported→415, ocr_unavailable→503,
      // ocr_failed→502, no_text_extracted/parse_failed→422.
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

  // Reuse the inline-intake persistence path with the extracted text.
  try {
    const created = await new DocumentService().create({
      filename: file.name,
      mimeType: "text/plain",
      content: extracted.text,
      category:
        extracted.extractionMethod === "ocr"
          ? `parsed_${extracted.kind}_ocr`
          : `parsed_${extracted.kind}`,
      metadata: {
        ...(metadata ?? {}),
        ...(extracted.extractionMethod
          ? { extractionMethod: extracted.extractionMethod }
          : {}),
        ...(extracted.ocrProvider
          ? { ocrProvider: extracted.ocrProvider }
          : {}),
      },
    });
    return NextResponse.json(
      {
        id: created.id,
        chunkCount: created.chunkCount,
        status: "chunked",
        kind: extracted.kind,
        pageCount: extracted.pageCount ?? null,
        extractedChars: extracted.text.length,
        extractionMethod: extracted.extractionMethod,
        ocrProvider: extracted.ocrProvider ?? null,
      },
      { status: 201 },
    );
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
