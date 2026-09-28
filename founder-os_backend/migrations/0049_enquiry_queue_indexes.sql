-- Cursor pagination + scoped lookups for the enquiry queues (2026-09-26).
-- Dashboards cap at the newest 100 rows and page by keyset
-- (createdAt, id); these indexes keep every page at a flat cost as the
-- table grows. OFFSET-based paging is intentionally NOT indexed for range
-- use — keyset is the only path the queues take.
CREATE INDEX IF NOT EXISTS idx_enquiry_created_id ON Enquiry(createdAt DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_enquiry_estnumber ON Enquiry(estNumber);
CREATE INDEX IF NOT EXISTS idx_enquiry_ratestatus ON Enquiry(rateStatus);
CREATE INDEX IF NOT EXISTS idx_estimate_number ON Estimate(estimateNumber);
CREATE INDEX IF NOT EXISTS idx_enquirycomment_enquiry ON EnquiryComment(enquiryId);
