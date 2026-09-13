-- 0029: scoped enquiry threads (sales vs procurement).
-- Default 'sales' preserves current behavior: every existing comment stays
-- sales-only. Procurement viewers only ever receive visibility='procurement'.
ALTER TABLE EnquiryComment ADD COLUMN visibility TEXT NOT NULL DEFAULT 'sales';
CREATE INDEX IF NOT EXISTS idx_enquiry_comment_scope ON EnquiryComment(enquiryId, visibility, createdAt);
