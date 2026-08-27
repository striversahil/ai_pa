-- Member-gated channels: existing public channels get their creator as a
-- member so they remain visible/manageable after the gating change.
INSERT OR IGNORE INTO chat_member (channelId, userId)
SELECT id, createdBy FROM chat_channel WHERE type = 'channel';