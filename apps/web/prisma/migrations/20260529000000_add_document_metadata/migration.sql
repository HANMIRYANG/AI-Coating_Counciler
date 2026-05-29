-- Persist validated document intake metadata (issuer / testMethod /
-- substrate / etc.) on the Document row. Shaped by DocumentMetadataSchema;
-- unknown keys are stripped before write. Not yet used for retrieval.

ALTER TABLE "Document" ADD COLUMN "metadata" JSONB;
