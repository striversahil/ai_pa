-- 0151_enquiry_thread_parent_index.sql — index the forward lookup (2026-11-21).
--
-- "Ask Procurement" now transfers the COMPLETE sales query into the internal
-- thread and reuses that one child on every re-forward (delta only). The
-- service looks the child up by parentThreadId on every forward, so index it
-- instead of scanning the table.

CREATE INDEX IF NOT EXISTS idx_enquiry_thread_parent ON EnquiryThread (parentThreadId);
