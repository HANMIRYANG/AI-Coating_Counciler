// Binary document text extraction (PDF / DOCX), with an optional OCR fallback.
//
// Two entry points:
//   - `extractDocumentText`            — text-layer only (PDF/DOCX). A scanned /
//     image-only PDF has no text layer and surfaces a typed `no_text_extracted`
//     error rather than silently persisting an empty document.
//   - `extractDocumentTextWithOcrFallback` — runs text-layer extraction first
//     and, for a PDF with no text layer (or an image input), falls back to OCR
//     (lib/documents/ocr.ts). Used by the parse + lazy-extract routes.
// Both feed the SAME deterministic chunking + persistence path as the inline
// text/markdown intake (DocumentService.create).
//
// The heavy parser libraries (unpdf, mammoth) are loaded lazily via dynamic
// import inside `defaultExtractors`, and the extractors are injectable so the
// dispatch / normalization logic can be unit-tested without them.

// PARSEABLE_MIME_TO_KIND below is the TEXT-LAYER set only (PDF/DOCX). Images
// have no text layer and are handled via the OCR fallback path, not here;
// spreadsheets are unsupported.
import {
  DocumentOcrError,
  OCR_SUPPORTED_MIME_TO_KIND,
  defaultOcrEngine,
  isOcrSupportedMime,
  type OcrEngine,
} from "./ocr";

export const PARSEABLE_MIME_TO_KIND = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "docx",
} as const;

export type ParseableMime = keyof typeof PARSEABLE_MIME_TO_KIND;
export type DocumentKind = (typeof PARSEABLE_MIME_TO_KIND)[ParseableMime];
export type ExtractionMethod = "text_layer" | "ocr";

// Hard cap on the uploaded binary (matches the Blob original cap).
export const MAX_PARSE_BYTES = 25 * 1024 * 1024; // 25 MB
// Cap on extracted text length so a huge document can't produce an unbounded
// number of chunks. Reject (not truncate) so data loss is never silent.
export const MAX_EXTRACTED_CHARS = 1_000_000;

export function isParseableMime(value: string): value is ParseableMime {
  return value in PARSEABLE_MIME_TO_KIND;
}

// Best-effort kind inference from a filename extension when the browser does
// not supply a content type.
export function inferMimeFromFilename(name: string): string | undefined {
  const lower = name.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".docx"))
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".tif") || lower.endsWith(".tiff")) return "image/tiff";
  if (lower.endsWith(".gif")) return "image/gif";
  return undefined;
}

export type ExtractErrorCode =
  | "unsupported_type"
  | "no_text_extracted"
  | "parse_failed"
  | "ocr_unavailable"
  | "ocr_failed";

export class DocumentExtractError extends Error {
  constructor(
    public readonly code: ExtractErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DocumentExtractError";
  }
}

// Single source of truth for the HTTP status of an extraction failure. Both
// the inline parse route and the lazy Blob-extract route map errors through
// this so the same cause never returns different statuses (e.g. a disabled
// OCR config is 503 from both, not 422 from one and 503 from the other).
//   unsupported_type → 415  (caller sent a type we cannot handle)
//   ocr_unavailable  → 503  (OCR is disabled / misconfigured — retry once set up)
//   ocr_failed       → 502  (OCR provider call failed — upstream error)
//   no_text_extracted / parse_failed → 422  (the file itself is unprocessable)
export function extractErrorToStatus(code: ExtractErrorCode): number {
  switch (code) {
    case "unsupported_type":
      return 415;
    case "ocr_unavailable":
      return 503;
    case "ocr_failed":
      return 502;
    case "no_text_extracted":
    case "parse_failed":
      return 422;
  }
}

export type ExtractResult = {
  text: string;
  kind: DocumentKind | "image";
  pageCount?: number;
  extractionMethod: ExtractionMethod;
  ocrProvider?: "google_document_ai";
};

// Injectable extractors. `pdf` receives a Uint8Array (unpdf's expected input);
// `docx` receives a Node Buffer (mammoth's expected input).
export type Extractors = {
  pdf: (bytes: Uint8Array) => Promise<{ text: string; pageCount?: number }>;
  docx: (buffer: Buffer) => Promise<{ text: string }>;
};

export const defaultExtractors: Extractors = {
  pdf: async (bytes) => {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(bytes);
    const { totalPages, text } = await extractText(pdf, { mergePages: true });
    return {
      text: Array.isArray(text) ? text.join("\n") : text,
      pageCount: totalPages,
    };
  },
  docx: async (buffer) => {
    const mammoth = (await import("mammoth")).default;
    const { value } = await mammoth.extractRawText({ buffer });
    return { text: value };
  },
};

// Normalize extracted text: normalize CRLF → LF and trim. Pure + deterministic.
function normalizeExtracted(raw: string): string {
  return raw.replace(/\r\n/g, "\n").trim();
}

/**
 * Extract plain text from a PDF/DOCX buffer.
 *
 *   - unsupported mimeType            → DocumentExtractError("unsupported_type")
 *   - extractor throws                → DocumentExtractError("parse_failed")
 *   - empty result (scanned PDF etc.) → DocumentExtractError("no_text_extracted")
 *   - text over MAX_EXTRACTED_CHARS   → DocumentExtractError("parse_failed")
 */
export async function extractDocumentText(
  buffer: Buffer,
  mimeType: string,
  extractors: Extractors = defaultExtractors,
): Promise<ExtractResult> {
  if (!isParseableMime(mimeType)) {
    throw new DocumentExtractError(
      "unsupported_type",
      `mimeType '${mimeType}' is not parseable. Only PDF and DOCX are supported (no OCR).`,
    );
  }
  const kind = PARSEABLE_MIME_TO_KIND[mimeType];

  let rawText: string;
  let pageCount: number | undefined;
  try {
    if (kind === "pdf") {
      const r = await extractors.pdf(new Uint8Array(buffer));
      rawText = r.text;
      pageCount = r.pageCount;
    } else {
      const r = await extractors.docx(buffer);
      rawText = r.text;
    }
  } catch (err) {
    throw new DocumentExtractError(
      "parse_failed",
      err instanceof Error ? err.message : String(err),
    );
  }

  const text = normalizeExtracted(rawText ?? "");
  if (text.length === 0) {
    throw new DocumentExtractError(
      "no_text_extracted",
      "추출된 텍스트가 없습니다. 텍스트 레이어가 없는 스캔/이미지 문서일 수 있습니다 (OCR 미지원).",
    );
  }
  if (text.length > MAX_EXTRACTED_CHARS) {
    throw new DocumentExtractError(
      "parse_failed",
      `추출 텍스트가 너무 큽니다 (${text.length}자 > ${MAX_EXTRACTED_CHARS}자). 문서를 분할해 업로드하세요.`,
    );
  }
  return { text, kind, pageCount, extractionMethod: "text_layer" };
}

/**
 * Extract text with OCR fallback.
 *
 * Flow:
 * 1. PDF/DOCX text-layer extraction first.
 * 2. If a PDF has no text layer, send the original PDF bytes to OCR.
 * 3. Images skip text-layer extraction and go straight to OCR.
 */
export async function extractDocumentTextWithOcrFallback(
  buffer: Buffer,
  mimeType: string,
  opts: {
    extractors?: Extractors;
    ocr?: OcrEngine;
    filename?: string;
  } = {},
): Promise<ExtractResult> {
  if (isParseableMime(mimeType)) {
    try {
      return await extractDocumentText(
        buffer,
        mimeType,
        opts.extractors ?? defaultExtractors,
      );
    } catch (err) {
      if (
        !(err instanceof DocumentExtractError) ||
        err.code !== "no_text_extracted" ||
        mimeType !== "application/pdf"
      ) {
        throw err;
      }
      return extractViaOcr(buffer, mimeType, opts);
    }
  }

  if (isOcrSupportedMime(mimeType)) {
    return extractViaOcr(buffer, mimeType, opts);
  }

  throw new DocumentExtractError(
    "unsupported_type",
    `mimeType '${mimeType}' is not parseable or OCR-supported.`,
  );
}

async function extractViaOcr(
  buffer: Buffer,
  mimeType: string,
  opts: { ocr?: OcrEngine; filename?: string },
): Promise<ExtractResult> {
  try {
    const result = await (opts.ocr ?? defaultOcrEngine)({
      buffer,
      mimeType,
      filename: opts.filename,
    });
    const text = normalizeExtracted(result.text);
    if (text.length === 0) {
      throw new DocumentExtractError(
        "no_text_extracted",
        "OCR completed but produced no text.",
      );
    }
    if (text.length > MAX_EXTRACTED_CHARS) {
      throw new DocumentExtractError(
        "parse_failed",
        `OCR text is too large (${text.length} > ${MAX_EXTRACTED_CHARS}). Split the document and upload smaller parts.`,
      );
    }
    return {
      text,
      kind:
        OCR_SUPPORTED_MIME_TO_KIND[
          mimeType as keyof typeof OCR_SUPPORTED_MIME_TO_KIND
        ],
      pageCount: result.pageCount,
      extractionMethod: "ocr",
      ocrProvider: result.provider,
    };
  } catch (err) {
    if (err instanceof DocumentExtractError) throw err;
    if (err instanceof DocumentOcrError) {
      if (err.code === "disabled" || err.code === "invalid_config") {
        throw new DocumentExtractError("ocr_unavailable", err.message);
      }
      if (err.code === "unsupported_type") {
        throw new DocumentExtractError("unsupported_type", err.message);
      }
      if (err.code === "no_text_extracted") {
        throw new DocumentExtractError("no_text_extracted", err.message);
      }
      throw new DocumentExtractError("ocr_failed", err.message);
    }
    throw new DocumentExtractError(
      "ocr_failed",
      err instanceof Error ? err.message : String(err),
    );
  }
}
