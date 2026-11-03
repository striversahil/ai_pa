-- 0094_client_segments.sql — final-consumer vs reseller classification.
--
-- The sales region owes ₹1L/day of ACCEPTED value from END CONSUMERS only
-- (founder decision 2026-11-02). The customer master types every mill
-- (Flour Mill / Chakki Mill / Maida Plant) but never flags resellers, and an
-- Estimate carries only a free-text customerName — no customer id — so the
-- classification below is name-keyed and deterministic:
--
--   ClientTypeRule   one row per master customerTypeBase (Flour Mill, …):
--                    which segment that whole family belongs to. Sales-head
--                    editable from the Controller. Seeded so the three mill
--                    families count as consumer; everything else starts unset.
--   ClientSegment    MANUAL overrides only (one row per normalised client
--                    name). Auto matches are computed on read against the
--                    customer master and never stored; a manual row always wins.
--
-- clientKey is the normalised client name (upper-cased, legal suffixes and
-- bracket qualifiers stripped — see client-segments.ts normalizeClientKey;
-- both sides must use the same function or keys will never join).

CREATE TABLE IF NOT EXISTS ClientTypeRule (
  typeBase    TEXT PRIMARY KEY,
  segment     TEXT NOT NULL DEFAULT '',
  updatedBy   TEXT NOT NULL DEFAULT '',
  updatedByName TEXT NOT NULL DEFAULT '',
  updatedAt   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO ClientTypeRule (typeBase, segment) VALUES
  ('Flour Mill', 'consumer'),
  ('Chakki Mill', 'consumer'),
  ('Maida Plant', 'consumer'),
  ('Other', ''),
  ('Unspecified', '');

CREATE TABLE IF NOT EXISTS ClientSegment (
  clientKey       TEXT PRIMARY KEY,
  displayName     TEXT NOT NULL DEFAULT '',
  segment         TEXT NOT NULL DEFAULT '',
  masterCustomerId TEXT NOT NULL DEFAULT '',
  masterName      TEXT NOT NULL DEFAULT '',
  matchKind       TEXT NOT NULL DEFAULT '',
  decidedBy       TEXT NOT NULL DEFAULT '',
  decidedByName   TEXT NOT NULL DEFAULT '',
  createdAt       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_client_segment_segment ON ClientSegment(segment);
