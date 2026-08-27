-- Chat message attachments (JSON array of { key, name, size, type } stored in KV).
ALTER TABLE chat_message ADD COLUMN attachments TEXT;