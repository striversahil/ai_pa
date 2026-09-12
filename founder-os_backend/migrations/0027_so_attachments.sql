-- 0027: SO document attachments (accounts uploads from the CRM dashboard:
-- invoice PDFs, LR copies, POD). Metadata is durable in D1 (keyed by SO
-- number, so snapshot refreshes can never wipe it); file bytes live in
-- Workers KV (CHAT_FILES). Served merged into the CRM pipeline payload.
--   kind        invoice | lr | pod | other
--   kvKey       unique KV object key under so/<soNumber>/
CREATE TABLE IF NOT EXISTS SoAttachment (
  id           TEXT PRIMARY KEY,
  soNumber     TEXT NOT NULL,
  kind         TEXT NOT NULL DEFAULT 'other',
  fileName     TEXT NOT NULL,
  mime         TEXT NOT NULL DEFAULT 'application/octet-stream',
  size         INTEGER NOT NULL DEFAULT 0,
  kvKey        TEXT NOT NULL UNIQUE,
  uploadedBy   TEXT NOT NULL DEFAULT '',
  createdAt    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_soattach_so ON SoAttachment(soNumber);
