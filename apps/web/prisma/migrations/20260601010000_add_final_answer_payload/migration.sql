-- Generic payload column for non-standard synthesis outputs (docs/23).
-- Ideation / certification_checklist (and future kinds) persist their full
-- answer object here, keyed by FinalAnswer.answerKind. The legacy `ideation`
-- column is retained only for backward-compatible reads of pre-existing rows.

ALTER TABLE "FinalAnswer" ADD COLUMN "payload" JSONB;
