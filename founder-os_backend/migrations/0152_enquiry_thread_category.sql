-- 0152_enquiry_thread_category.sql — one conversation per query (2026-11-21).
--
-- category decides WHO ELSE takes part in a sales-facing thread:
--   'product_query'    → sales + management + procurement. Procurement sees the
--                        thread and replies in place; to Sales that reply reads
--                        as Management (name/desk never shown) and vendor names
--                        in it are scrubbed (messages.salesText).
--   'rate_negotiation' → sales + management only. Procurement never sees it.
--   NULL               → legacy row (created before categories): behaves exactly
--                        as before — procurement cannot see a sales-channel
--                        thread. Deliberately NOT backfilled (founder 2026-11-21).
--
-- Internal (management <-> procurement) threads keep category NULL and are
-- still never served to the sales desk.

ALTER TABLE EnquiryThread ADD COLUMN category TEXT;

CREATE INDEX IF NOT EXISTS idx_enquiry_thread_visibility
  ON EnquiryThread (channel, category, status, updatedAt);
