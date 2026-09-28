-- Server search support for the enquiry queues (2026-09-26).
-- Substring search itself scans; these cover the exact fast paths
-- (daily-No jumps, enquiry-number prefixes) and keep the matched-row
-- comment/thread lookups indexed.
CREATE INDEX IF NOT EXISTS idx_enquiry_dailyno ON Enquiry(dailyNo);
CREATE INDEX IF NOT EXISTS idx_enquiry_enquirynumber ON Enquiry(enquiryNumber);
