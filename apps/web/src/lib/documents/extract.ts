// Binary document text extraction (PDF / DOCX) — text layer only, no OCR.
//
// Extracts a plain-text representation from an uploaded PDF or DOCX so it can
// flow into the SAME deterministic chunking + persistence path as the inline
// text/markdown intake (DocumentService.create). Scanned / image-only PDFs
// have no text layer and surface a typed `no_text_extracted` error rather
// than silently persisting an empty document.
//
// The heavy parser libraries (unpdf, mammoth) are loaded lazily via dynamic
// import inside `defaultExtractors`, and the extractors are injectable so the
// dispatch / normalization logic can be unit-tested without them.

// Supported binary MIME types → internal kind. Spreadsheets / images are not
// parseable here (no text layer / OCR) and are rejected.
export const PARSEABLE_MIME_TO_KIND = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "docx",
} as const;

export type ParseableMime = keyof typeof PARSEABLE_MIME_TO_KIND;
export type DocumentKind = (typeof PARSEABLE_MIME_TO_KIND)[ParseableMime];

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
  return undefined;
}

export type ExtractErrorCode =
  | "unsupported_type"
  | "no_text_extracted"
  | "parse_failed";

export class DocumentExtractError extends Error {
  constructor(
    public readonly code: ExtractErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DocumentExtractError";
  }
}

export type ExtractResult = {
  text: string;
  kind: DocumentKind;
  pageCount?: number;
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
  return { text, kind, pageCount };
}
