-- 0091_agent_url_override.sql — per-agent campaign URL editable from the Controller.
--
-- The Worker-secret model (NEODOVE_AGENT_<KEY>_URL) stays as the fallback, but
-- a sales-head can now paste a URL (or a full curl command — the server
-- extracts the URL) into the Controller and map it to an agent without a
-- redeploy. A DB value wins over the secret; empty means "use the secret".
--
-- The full URL is NEVER returned by any endpoint — only the host (for history)
-- and a source flag (db | secret | none). SSRF guard lives in service.ts:
-- DB-sourced URLs must be https NeoDove integration URLs.

ALTER TABLE NeoDoveAgent ADD COLUMN campaignUrl TEXT NOT NULL DEFAULT '';
