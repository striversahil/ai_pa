-- Chat reply + unread tracking.
ALTER TABLE chat_message ADD COLUMN replyToId INTEGER;
CREATE TABLE IF NOT EXISTS chat_read_state (
  userId TEXT NOT NULL,
  channelId TEXT NOT NULL,
  lastReadId INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (userId, channelId),
  FOREIGN KEY (userId) REFERENCES auth_user(id) ON DELETE CASCADE,
  FOREIGN KEY (channelId) REFERENCES chat_channel(id) ON DELETE CASCADE
);