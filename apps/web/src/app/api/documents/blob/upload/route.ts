// POST /api/documents/blob/upload
//
// Vercel Blob CLIENT-UPLOAD handler (Step 14). The large binary original is
// uploaded directly from the browser to Vercel Blob — this route only:
//   1. issues a scoped, size/type-validated upload token (onBeforeGenerateToken)
//   2. records the original's metadata when the upload completes
//      (onUploadCompleted, called server-to-server by Vercel Blob).
//
// It NEVER proxies the file body through Next.js. It does NOT parse / OCR /
// chunk / embed the binary. The existing inline text/markdown intake
// (POST /api/documents) is unchanged.
//
// Requires `BLOB_READ_WRITE_TOKEN`. The blob store should use PRIVATE access;
// the resulting blob URL is treated as internal and is not exposed elsewhere.

import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";

import {
  MAX_ORIGINAL_BLOB_BYTES,
  SUPPORTED_ORIGINAL_MIME_TYPES,
  validateOriginalUpload,
  type OriginalUploadDescriptor,
} from "@/lib/documents/blobStorage";
import { DocumentService } from "@/lib/documents/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseDescriptor(
  tokenPayload: string | null | undefined,
): Partial<OriginalUploadDescriptor> {
  if (!tokenPayload) return {};
  try {
    return JSON.parse(tokenPayload) as Partial<OriginalUploadDescriptor>;
  } catch {
    return {};
  }
}

export async function POST(req: Request) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      {
        error: "blob_not_configured",
        message:
          "Original-file upload requires BLOB_READ_WRITE_TOKEN. Configure a Vercel Blob store (private access).",
      },
      { status: 503 },
    );
  }

  let body: HandleUploadBody;
  try {
    body = (await req.json()) as HandleUploadBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  try {
    const result = await handleUpload({
      request: req,
      body,
      onBeforeGenerateToken: async (_pathname, clientPayload) => {
        // Validate filename / content type / size BEFORE issuing a token.
        const check = validateOriginalUpload(clientPayload);
        if (!check.ok) {
          throw new Error(check.error);
        }
        return {
          allowedContentTypes: [...SUPPORTED_ORIGINAL_MIME_TYPES],
          maximumSizeInBytes: MAX_ORIGINAL_BLOB_BYTES,
          // Vercel adds a random suffix for uniqueness; our pathname prefix
          // is deterministic (see buildOriginalBlobPathname, client-side).
          addRandomSuffix: true,
          // Carry the validated descriptor to onUploadCompleted (the blob
          // result does not include the original size).
          tokenPayload: JSON.stringify(check.descriptor),
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        const descriptor = parseDescriptor(tokenPayload);
        await new DocumentService().recordOriginalUpload({
          filename: descriptor.filename ?? blob.pathname,
          contentType:
            blob.contentType ??
            descriptor.contentType ??
            "application/octet-stream",
          sizeBytes: descriptor.sizeBytes ?? 0,
          blobUrl: blob.url,
          blobPath: blob.pathname,
          uploadedAt: new Date(),
        });
      },
    });

    return NextResponse.json(result);
  } catch (err) {
    // Token-validation failures and Blob client errors land here.
    return NextResponse.json(
      {
        error: "blob_upload_error",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 400 },
    );
  }
}
