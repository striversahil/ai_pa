-- 0129_core_credit.sql — Phase 3e: close-credit dual ledger (1:1 mirror).
--
-- Founder votes 2026-11-12: full history (every TelecallerScoreEvent row —
-- legacy full-slabs, generator/closer shares, -10/-15 penalties); 1:1 mirror
-- shape (same columns/semantics, new table, so diffing is trivial);
-- per-estimate per-kind sums must match; legacy writes stop only on human
-- confirmation after 7 days of closes with zero DIFFs.
--
-- core_credit.id REUSES TelecallerScoreEvent.id. Dual-write hooks
-- recordScoreEvent (the single funnel — scoring.ts) and deleteCloseHistory
-- (reset purges mirror the purge). DepartmentScoreEvent (CRM pipeline) is a
-- separate ledger and stays out of scope here.
-- NOTE: D1 rejects INSERT…SELECT…ON CONFLICT — INSERT OR IGNORE only.

CREATE TABLE IF NOT EXISTS "core_credit" (
  "id" TEXT PRIMARY KEY,
  "telecallerId" TEXT NOT NULL DEFAULT '',
  "estimateId" TEXT NOT NULL DEFAULT '',
  "kind" TEXT NOT NULL DEFAULT '',
  "delta" INTEGER NOT NULL DEFAULT 0,
  "day" TEXT NOT NULL DEFAULT '',
  "reason" TEXT,
  "createdAt" TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS "core_credit_estimate_idx" ON "core_credit" ("estimateId");
CREATE INDEX IF NOT EXISTS "core_credit_telecaller_idx" ON "core_credit" ("telecallerId");
CREATE INDEX IF NOT EXISTS "core_credit_day_idx" ON "core_credit" ("day");

-- Backfill: full history, idempotent.
INSERT OR IGNORE INTO "core_credit" ("id", "telecallerId", "estimateId", "kind", "delta", "day", "reason", "createdAt")
SELECT "id", "telecallerId", "estimateId", "kind", "delta", "day", "reason", "createdAt"
FROM "TelecallerScoreEvent";
