-- 0051: LinkedIn daily content batches (5 drafts/day, founder picks 1).
-- Images live in KV (linkedin:img:<id>, 90-day TTL); D1 holds text + status.
CREATE TABLE IF NOT EXISTS LinkedinPost (
  id TEXT PRIMARY KEY,
  batchDate TEXT NOT NULL,
  topic TEXT NOT NULL,
  pillar TEXT NOT NULL DEFAULT '',
  format TEXT NOT NULL DEFAULT '',
  researchBrief TEXT NOT NULL DEFAULT '',
  postDraft TEXT NOT NULL DEFAULT '',
  postFinal TEXT NOT NULL DEFAULT '',
  hashtags TEXT NOT NULL DEFAULT '',
  visualBrief TEXT NOT NULL DEFAULT '',
  imagePrompt TEXT NOT NULL DEFAULT '',
  hasImage INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',
  picked INTEGER NOT NULL DEFAULT 0,
  postedAt TEXT,
  createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(batchDate, topic)
);
CREATE INDEX IF NOT EXISTS idx_linkedin_batch ON LinkedinPost(batchDate);
CREATE INDEX IF NOT EXISTS idx_linkedin_status ON LinkedinPost(status);
