-- waba-worker schema (Cloudflare D1)
CREATE TABLE IF NOT EXISTS waba_payloads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  whatsapp_id TEXT NOT NULL UNIQUE,
  payload TEXT NOT NULL,
  direction TEXT DEFAULT 'inbound',
  processed INTEGER DEFAULT 0,
  ai_result TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  processed_at DATETIME
);
CREATE INDEX IF NOT EXISTS idx_waba_payloads_processed ON waba_payloads (processed, id);
CREATE INDEX IF NOT EXISTS idx_waba_payloads_direction ON waba_payloads (direction);