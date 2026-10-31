-- 0090_sales_holidays.sql — national holidays excluded from the sales deficit.
--
-- One global date list (not per-region): every region owes ₹1L per working
-- day, so a holiday knocks ₹1L off each region's target for that day.
-- The carry ledger (targets.ts) is recomputed from the start on every
-- dashboard load, so backdated holidays automatically shrink past dues —
-- no backfill needed. Sundays are already non-working; marking one is a
-- stored no-op the API reports but the ledger ignores.

CREATE TABLE IF NOT EXISTS SalesHoliday (
  day           TEXT PRIMARY KEY,   -- YYYY-MM-DD (IST)
  label         TEXT NOT NULL DEFAULT '',
  markedBy      TEXT NOT NULL DEFAULT '',
  markedByName  TEXT NOT NULL DEFAULT '',
  createdAt     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sales_holiday_day ON SalesHoliday(day);
