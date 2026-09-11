-- Agent call-disposition tags on conversion follow-ups (Lead Conversion view).
-- callTag: NO_ANSWER | BUSY | CALLBACK (NULL = untagged). callbackDate is a
-- YYYY-MM-DD IST day, only meaningful with CALLBACK (UI caps it at +10 days).
-- callTagBy stores the Telecaller id that set it; callTagAt an ISO timestamp.
-- Engines never write these columns — sticky until the agent changes/clears.
ALTER TABLE Estimate ADD COLUMN callTag TEXT;
ALTER TABLE Estimate ADD COLUMN callbackDate TEXT;
ALTER TABLE Estimate ADD COLUMN callTagBy TEXT;
ALTER TABLE Estimate ADD COLUMN callTagAt TEXT;
CREATE INDEX IF NOT EXISTS idx_estimate_call_tag ON Estimate(callTag);
CREATE INDEX IF NOT EXISTS idx_estimate_callback_date ON Estimate(callbackDate);
