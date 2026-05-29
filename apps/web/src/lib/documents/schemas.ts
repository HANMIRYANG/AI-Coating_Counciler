// Document intake validation schemas.
//
// Step 3 scope: typed foundation for ingesting plain-text and Markdown
// internal documents. Binary parsing (PDF / DOCX / images / etc.) is
// explicitly out of scope and rejected at the API boundary with a 415.
//
// The rich `DocumentMetadata` block (issuer, testMethod, etc.) is validated
// here but is NOT yet persisted — the existing Prisma `Document` model has
// no metadata column. A follow-up migration will add one; until then the
// schema is published so callers can be written against a stable contract.

import { z } from "zod";
import { EvidenceDocumentTypeSchema } from "@/lib/council/evidence";

// Inline payload cap. The POST /api/documents endpoint accepts the file
// content in the JSON body — keep it modest so we never need to stream.
// 256KB of UTF-8 text comfortably covers a TDS / SDS / certification page
// and stays well under typical body-parser limits.
export const MAX_DOCUMENT_BYTES = 256 * 1024;

// Supported MIME types for the text-only intake path.
export const SupportedDocumentMimeSchema = z.enum([
  "text/plain",
  "text/markdown",
]);
export type SupportedDocumentMime = z.infer<typeof SupportedDocumentMimeSchema>;

// Well-known MIMEs we explicitly recognize as "you brought a binary; come
// back when Phase 2 ships a parser." Used by the route to surface a
// friendlier 415 message than the generic Zod enum error. Anything not in
// SupportedDocumentMimeSchema is rejected anyway — this list just labels
// the common offenders.
export const KNOWN_UNSUPPORTED_DOCUMENT_MIMES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/tiff",
  "application/octet-stream",
] as const;
export type KnownUnsupportedDocumentMime =
  (typeof KNOWN_UNSUPPORTED_DOCUMENT_MIMES)[number];

export function isKnownUnsupportedMime(
  value: string,
): value is KnownUnsupportedDocumentMime {
  return (KNOWN_UNSUPPORTED_DOCUMENT_MIMES as readonly string[]).includes(
    value,
  );
}

// Metadata fields tracked at intake time. Aligned with the list in
// docs/13_rag_document_strategy.md so a future retrieval step can use the
// same field names without renaming.
export const DocumentMetadataSchema = z.object({
  productName: z.string().max(255).optional(),
  documentType: EvidenceDocumentTypeSchema.optional(),
  version: z.string().max(64).optional(),
  issuedDate: z.string().max(32).optional(),
  issuer: z.string().max(255).optional(),
  testMethod: z.string().max(255).optional(),
  substrate: z.string().max(255).optional(),
  coatingThickness: z.string().max(64).optional(),
  temperatureCondition: z.string().max(255).optional(),
});
export type DocumentMetadata = z.infer<typeof DocumentMetadataSchema>;

export const CreateDocumentRequestSchema = z.object({
  filename: z.string().min(1).max(255),
  // Defaults to filename if not supplied.
  originalName: z.string().min(1).max(255).optional(),
  mimeType: SupportedDocumentMimeSchema,
  content: z
    .string()
    .min(1, "content must be non-empty")
    // Zod's .max(n) on a string counts JS string length (UTF-16 code units),
    // not UTF-8 bytes. A Korean / CJK payload whose code-unit count is well
    // under the limit can still encode to >256KB of UTF-8 once it hits the
    // wire. Enforce the cap in actual UTF-8 bytes — the unit the body
    // parser and downstream Prisma column actually care about.
    .superRefine((value, ctx) => {
      const bytes = Buffer.byteLength(value, "utf8");
      if (bytes > MAX_DOCUMENT_BYTES) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `content exceeds 256KB inline limit (utf8 bytes: ${bytes})`,
        });
      }
    }),
  category: z.string().max(64).optional(),
  version: z.string().max(64).optional(),
  metadata: DocumentMetadataSchema.optional(),
});
export type CreateDocumentRequest = z.infer<typeof CreateDocumentRequestSchema>;
