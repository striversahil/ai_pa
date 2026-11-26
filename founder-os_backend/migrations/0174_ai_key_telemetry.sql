-- 0174_ai_key_telemetry.sql — per-call AI gateway telemetry (key health input).
--
-- One row per provider call (never contains key material: keyId is the
-- provider:first6...last4 fingerprint already exposed by /api/ai/health).
-- Written by the Worker metric sink with ctx.waitUntil; read by the native
-- 5-minute health sweep and the Settings drill-down. Playground probes are
-- stored with source='playground' and excluded from health scoring.
-- Retention: 30 days (the sweep prunes older rows).

CREATE TABLE IF NOT EXISTS AiKeyCall (
  id                TEXT PRIMARY KEY,
  provider          TEXT NOT NULL,
  keyId             TEXT NOT NULL,
  ok                INTEGER NOT NULL DEFAULT 0,
  status            INTEGER,
  errorKind         TEXT,
  latencyMs         INTEGER NOT NULL DEFAULT 0,
  ttftMs            INTEGER,
  promptTokens      INTEGER,
  completionTokens  INTEGER,
  totalTokens       INTEGER,
  streamed          INTEGER NOT NULL DEFAULT 0,
  source            TEXT NOT NULL DEFAULT 'app',
  createdAt         TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_key_call_key_at ON AiKeyCall(keyId, createdAt DESC);
CREATE INDEX IF NOT EXISTS idx_ai_key_call_at ON AiKeyCall(createdAt);
