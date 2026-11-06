-- 0110_neodove_team_lead_agents.sql
-- Team-Lead campaign targets (founder decision 2026-11-05): the two TLs get
-- their own NeoDove campaign routing so a push can send a region+state's full
-- customer copy to the covering Team Lead (single-mode full copy).
--
-- Design (hash-stability): the region PAIR split is untouched — TL rows carry
-- kind='team_lead' and are NEVER part of `split` assignment (adding a third
-- bucket would reshuffle every repeat push across different agents). TLs only
-- ever receive `single` pushes (the whole state copy, coverage model).
--
-- Fail-closed as usual: no URL (DB mapping or NEODOVE_AGENT_TL_*_URL secret)
-- means a TL push is refused, never half-routed. URLs are mapped from the
-- Controller exactly like pair agents (same endpoint, keyed by agent id).

ALTER TABLE NeoDoveAgent ADD COLUMN kind TEXT NOT NULL DEFAULT 'agent';

UPDATE NeoDoveAgent SET kind = 'agent' WHERE kind IS NULL OR kind = '';

INSERT INTO NeoDoveAgent (id, region, name, secretName, active, campaignUrl, kind, createdAt, updatedAt)
SELECT 'TL_RAJIV_KAPOOR', 'R4', 'Rajiv Kapoor', 'NEODOVE_AGENT_TL_RAJIV_KAPOOR_URL', 1, '', 'team_lead', datetime('now'), datetime('now')
WHERE NOT EXISTS (SELECT 1 FROM NeoDoveAgent WHERE id = 'TL_RAJIV_KAPOOR');

INSERT INTO NeoDoveAgent (id, region, name, secretName, active, campaignUrl, kind, createdAt, updatedAt)
SELECT 'TL_SANJAY_SHARMA', 'R3', 'Sanjay Sharma', 'NEODOVE_AGENT_TL_SANJAY_SHARMA_URL', 1, '', 'team_lead', datetime('now'), datetime('now')
WHERE NOT EXISTS (SELECT 1 FROM NeoDoveAgent WHERE id = 'TL_SANJAY_SHARMA');
