-- Persist the final-answer evidence usage contract (Step 10). Bounded
-- references + claim coverage so citations can be rendered later. No chunk
-- bodies stored here; no citation UI / verified-citation enforcement yet.

ALTER TABLE "FinalAnswer"
  ADD COLUMN "evidenceUsed"           JSONB,
  ADD COLUMN "coveredClaims"          JSONB,
  ADD COLUMN "uncoveredClaims"        JSONB,
  ADD COLUMN "evidenceCoverageStatus" TEXT;
