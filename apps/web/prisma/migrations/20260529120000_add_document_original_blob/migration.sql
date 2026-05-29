-- Original-file storage foundation (Step 14, Vercel Blob). Nullable columns
-- on Document hold metadata for a large binary original uploaded via the
-- client-upload flow. NULL for the existing inline text/markdown intake.
-- The blob URL is internal and never exposed in list/search/evidence. No
-- extraction/parsing/RAG over these originals yet.

ALTER TABLE "Document"
  ADD COLUMN "originalBlobUrl"         TEXT,
  ADD COLUMN "originalBlobPath"        TEXT,
  ADD COLUMN "originalBlobSizeBytes"   INTEGER,
  ADD COLUMN "originalBlobContentType" TEXT,
  ADD COLUMN "originalUploadedAt"      TIMESTAMP(3);
