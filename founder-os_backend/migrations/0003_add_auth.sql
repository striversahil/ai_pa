-- Auth tables (Google login, sessions, category-based permissions).
CREATE TABLE IF NOT EXISTS auth_user (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  picture TEXT,
  isRoot INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS auth_session (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  expiresAt TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  FOREIGN KEY (userId) REFERENCES auth_user(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_auth_session_user ON auth_session(userId);
CREATE TABLE IF NOT EXISTS auth_scope (
  key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  description TEXT
);
CREATE TABLE IF NOT EXISTS auth_user_scope (
  userId TEXT NOT NULL,
  scopeKey TEXT NOT NULL,
  PRIMARY KEY (userId, scopeKey),
  FOREIGN KEY (userId) REFERENCES auth_user(id) ON DELETE CASCADE,
  FOREIGN KEY (scopeKey) REFERENCES auth_scope(key) ON DELETE CASCADE
);
