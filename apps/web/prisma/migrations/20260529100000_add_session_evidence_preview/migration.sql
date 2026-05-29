-- Persist the bounded internal-evidence retrieval preview (Step 7) on the
-- council session. Snippets only — never full chunk bodies. Null for
-- sessions created before the orchestrator preflight populated it.

ALTER TABLE "CouncilSession" ADD COLUMN "evidencePreview" JSONB;
