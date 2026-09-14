-- Accounts automation: proof files on task logs (bytes in CHAT_FILES KV).
CREATE TABLE IF NOT EXISTS "AccountsTaskAttachment" (
  "id" TEXT PRIMARY KEY,
  "logId" TEXT NOT NULL REFERENCES "AccountsTaskLog"("id") ON DELETE CASCADE,
  "fileName" TEXT NOT NULL,
  "mime" TEXT NOT NULL DEFAULT 'application/octet-stream',
  "size" INTEGER NOT NULL DEFAULT 0,
  "kvKey" TEXT NOT NULL UNIQUE,
  "uploadedBy" TEXT NOT NULL DEFAULT '',
  "createdAt" TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS "AccountsTaskAttachment_logId_idx" ON "AccountsTaskAttachment" ("logId");
