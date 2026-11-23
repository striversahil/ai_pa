-- 0163_view_as.sql — root "view as" (impersonation) audit trail.
--
-- The impersonation itself needs NO table: root sets a `fos_view_as` cookie and
-- worker/viewer.ts overlays that identity for the request (read-only, enforced
-- in worker/context.ts). This table is the paper trail — who looked at whom,
-- for how long — so the founder can answer "did anyone see my dashboard?".
CREATE TABLE IF NOT EXISTS hlp_view_as (
  id            TEXT PRIMARY KEY,
  rootUserId    TEXT NOT NULL,
  rootEmail     TEXT,
  targetUserId  TEXT NOT NULL,
  targetEmail   TEXT,
  targetName    TEXT,
  startedAt     TEXT NOT NULL,
  endedAt       TEXT,
  ip            TEXT,
  userAgent     TEXT
);

CREATE INDEX IF NOT EXISTS idx_hlp_view_as_started
  ON hlp_view_as (startedAt DESC);

CREATE INDEX IF NOT EXISTS idx_hlp_view_as_root
  ON hlp_view_as (rootUserId, startedAt DESC);
