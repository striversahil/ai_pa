-- Token table for storing web authentication tokens (NeoDove, Zoho, Google, etc.)
CREATE TABLE IF NOT EXISTS Token (
  id           TEXT PRIMARY KEY,
  source       TEXT NOT NULL UNIQUE,
  token        TEXT NOT NULL,
  metadata     TEXT,
  createdAt    TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_token_source ON Token (source);