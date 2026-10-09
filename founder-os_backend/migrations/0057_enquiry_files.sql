-- 0057: enquiry item-media file locker (D1-backed).
-- Workers KV proved unable to persist worker-written keys (Oct 2026: PUT +
-- same-request read-back succeeded, keys gone <60s later, CLI-written keys
-- fine) — photo bytes move to D1, which every read/write path verifies.
-- URLs stay `/api/enquiries/files/<key>` so stored item media keeps working.
CREATE TABLE IF NOT EXISTS EnquiryFile (
  key TEXT PRIMARY KEY,
  mime TEXT NOT NULL DEFAULT 'application/octet-stream',
  name TEXT NOT NULL DEFAULT 'file',
  size INTEGER NOT NULL DEFAULT 0,
  data BLOB NOT NULL,
  createdAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_enquiryfile_created ON EnquiryFile(createdAt);
