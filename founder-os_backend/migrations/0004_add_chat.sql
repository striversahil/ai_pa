-- Team chat (Discord-style channels + messages).
CREATE TABLE IF NOT EXISTS chat_channel (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT,
  createdBy TEXT NOT NULL,
  createdAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS chat_message (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channelId TEXT NOT NULL,
  senderId TEXT NOT NULL,
  body TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  editedAt TEXT,
  deletedAt TEXT,
  FOREIGN KEY (channelId) REFERENCES chat_channel(id) ON DELETE CASCADE,
  FOREIGN KEY (senderId) REFERENCES auth_user(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_chat_message_channel ON chat_message(channelId, id);