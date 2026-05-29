// Vercel Blob original-file storage foundation (Step 14).
//
// Pure helpers + types for storing LARGE BINARY ORIGINALS (PDF / DOCX / etc.)
// in Vercel Blob via the client-upload flow. This is storage-only:
//   - It does NOT change the inline text/markdown intake (POST /api/documents).
//   - It does NOT parse / OCR / chunk / embed the binary originals.
//   - Blob URLs are treated as INTERNAL — never surfaced in list / search /
//     evidence responses.
//
// The blob store should be created with PRIVATE access (originals can contain
// confidential test reports). Even so, never echo `originalBlobUrl` into any
// public payload.

import { z } from "zod";

// Hard cap for an uploaded original. Bounded so a misconfigured client can't
// request an unbounded token. (Vercel Blob itself supports much larger, but
// we keep originals modest for this foundation.)
export const MAX_ORIGINAL_BLOB_BYTES = 25 * 1024 * 1024; // 25 MB

// Content types accepted as binary originals. The inline intake path
// (text/plain, text/markdown) is unchanged and handled elsewhere; text is
// included here too so a text original can also be archived as a blob.
export const SUPPORTED_ORIGINAL_MIME_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "image/png",
  "image/jpeg",
  "image/tiff",
  "text/plain",
  "text/markdown",
] as const;

export type SupportedOriginalMime =
  (typeof SUPPORTED_ORIGINAL_MIME_TYPES)[number];

export function isSupportedOriginalMime(
  value: string,
): value is SupportedOriginalMime {
  return (SUPPORTED_ORIGINAL_MIME_TYPES as readonly string[]).includes(value);
}

// Deterministic, collision-resistant-by-prefix blob pathname. The Vercel
// client-upload flow adds a random suffix (addRandomSuffix) for uniqueness;
// this builds the stable, sanitized prefix under a fixed namespace.
//
// Sanitization: keep the basename, lowercase, replace any run of characters
// outside [a-z0-9._-] with a single "-", trim leading/trailing separators.
export function buildOriginalBlobPathname(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? filename;
  const sanitized = base
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  const safe = sanitized.length > 0 ? sanitized : "original";
  return `documents/originals/${safe}`;
}

// Client-supplied upload descriptor (sent as `clientPayload` JSON on the
// client `upload()` call, validated before a token is issued).
export const OriginalUploadDescriptorSchema = z.object({
  filename: z.string().min(1).max(255),
  contentType: z.string().min(1).max(255),
  sizeBytes: z.number().int().positive(),
});
export type OriginalUploadDescriptor = z.infer<
  typeof OriginalUploadDescriptorSchema
>;

export type OriginalUploadValidation =
  | { ok: true; descriptor: OriginalUploadDescriptor }
  | { ok: false; error: string };

// Parse + validate the client payload BEFORE generating an upload token.
// Rejects missing payloads, unsupported content types, and oversize uploads.
export function validateOriginalUpload(
  rawClientPayload: string | null | undefined,
): OriginalUploadValidation {
  if (!rawClientPayload) {
    return { ok: false, error: "missing upload descriptor (clientPayload)" };
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawClientPayload);
  } catch {
    return { ok: false, error: "clientPayload is not valid JSON" };
  }
  const parsed = OriginalUploadDescriptorSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return { ok: false, error: "invalid upload descriptor shape" };
  }
  const d = parsed.data;
  if (!isSupportedOriginalMime(d.contentType)) {
    return {
      ok: false,
      error: `unsupported original content type: ${d.contentType}`,
    };
  }
  if (d.sizeBytes > MAX_ORIGINAL_BLOB_BYTES) {
    return {
      ok: false,
      error: `file exceeds max original size (${MAX_ORIGINAL_BLOB_BYTES} bytes)`,
    };
  }
  return { ok: true, descriptor: d };
}

// Document fields written when an original blob is recorded. Mirrors the
// nullable columns added to the Prisma `Document` model.
export type OriginalBlobMetadata = {
  originalBlobUrl: string;
  originalBlobPath: string;
  originalBlobSizeBytes: number;
  originalBlobContentType: string;
  originalUploadedAt: Date;
};

// Map a completed upload (blob result + validated descriptor) into the
// persisted metadata shape. Deterministic given its inputs.
export function toOriginalBlobMetadata(input: {
  url: string;
  pathname: string;
  contentType: string;
  sizeBytes: number;
  uploadedAt: Date;
}): OriginalBlobMetadata {
  return {
    originalBlobUrl: input.url,
    originalBlobPath: input.pathname,
    originalBlobSizeBytes: input.sizeBytes,
    originalBlobContentType: input.contentType,
    originalUploadedAt: input.uploadedAt,
  };
}
