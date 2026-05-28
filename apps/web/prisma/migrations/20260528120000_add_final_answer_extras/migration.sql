-- Add round-trip fields for FinalAnswer so the Zod schema (followUpQuestions,
-- providerSummary, sessionStatus) survives a Prisma persist/restore cycle.

ALTER TABLE "FinalAnswer"
  ADD COLUMN "followUpQuestions" JSONB,
  ADD COLUMN "providerSummary"   JSONB,
  ADD COLUMN "sessionStatus"     TEXT;
