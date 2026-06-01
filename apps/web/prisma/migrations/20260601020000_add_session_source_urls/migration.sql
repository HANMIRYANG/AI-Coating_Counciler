-- External official-source URLs for internal_docs_web (docs/23). Optional list
-- of user-provided URLs fetched server-side as a side-car. NULL for sessions
-- that did not request external sources.

ALTER TABLE "CouncilSession" ADD COLUMN "sourceUrls" JSONB;
