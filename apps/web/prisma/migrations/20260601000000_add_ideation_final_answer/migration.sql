-- Ideation synthesis output (docs/23). taskType=application_ideas produces a
-- distinct IdeationFinalAnswer shape. `answerKind` discriminates standard vs
-- ideation answers; `ideation` holds the full IdeationFinalAnswer payload for
-- ideation rows. Existing rows default to 'standard'. The shared safety
-- columns (conclusion / finalMarkdown / missingEvidence / unsafePhrases /
-- recommendedSafeWording / riskLevel / evidence-usage) stay populated for both.

ALTER TABLE "FinalAnswer"
  ADD COLUMN "answerKind" TEXT NOT NULL DEFAULT 'standard',
  ADD COLUMN "ideation"   JSONB;
