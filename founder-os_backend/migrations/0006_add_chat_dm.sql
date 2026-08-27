-- Chat DMs: channel type column + per-channel membership.
ALTER TABLE chat_channel ADD COLUMN type TEXT NOT NULL DEFAULT 'channel';
CREATE TABLE IF NOT EXISTS chat_member (
  channelId TEXT NOT NULL,
  userId TEXT NOT NULL,
  PRIMARY KEY (channelId, userId),
  FOREIGN KEY (channelId) REFERENCES chat_channel(id) ON DELETE CASCADE,
  FOREIGN KEY (userId) REFERENCES auth_user(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_chat_member_user ON chat_member(userId);