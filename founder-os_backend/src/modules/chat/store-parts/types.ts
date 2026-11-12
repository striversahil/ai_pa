// Extracted verbatim from store.ts by scripts/refactor/split-module.mjs.
// store.ts re-exports everything public here, so existing imports keep working.


export interface ChatUser {
  id: string;
  name: string;
  picture: string | null;
  email?: string | null;
}

export interface ChatChannel {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  type: "channel" | "dm";
  createdBy: string;
  createdAt: string;
  otherUser?: ChatUser | null;
}

export interface ChatAttachment {
  key: string;
  name: string;
  size: number;
  type: string;
}

export interface ChatMessage {
  id: number;
  channelId: string;
  senderId: string;
  senderName: string;
  senderPicture: string | null;
  body: string;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  attachments: ChatAttachment[];
  replyToId: number | null;
  replyTo?: { id: number; senderName: string; body: string } | null;
}

export interface ChatReaction {
  messageId: number;
  emoji: string;
  userId: string;
  userName: string;
}

export interface ChatStore {
  listChannels(userId: string, isAdmin?: boolean): Promise<ChatChannel[]>;
  listChannelsWithUnread(userId: string, isAdmin?: boolean): Promise<Array<ChatChannel & { unread: number }>>;
  createChannel(input: { name: string; description: string | null; category: string | null; createdBy: string; memberIds?: string[] }): Promise<ChatChannel>;
  createDm(userA: string, userB: string): Promise<ChatChannel>;
  canAccessChannel(channelId: string, userId: string, isAdmin?: boolean): Promise<boolean>;
  listUsers(): Promise<ChatUser[]>;
  listChannelMembers(channelId: string): Promise<ChatUser[]>;
  addChannelMembers(channelId: string, userIds: string[]): Promise<void>;
  removeChannelMember(channelId: string, userId: string): Promise<void>;
  listMessages(channelId: string, before?: number | null, limit?: number): Promise<ChatMessage[]>;
  getMessage(id: number): Promise<ChatMessage | null>;
  getUnreadCounts(userId: string): Promise<Record<string, number>>;
  markChannelRead(userId: string, channelId: string, lastReadId: number): Promise<void>;
  createMessage(input: { channelId: string; senderId: string; body: string; attachments?: ChatAttachment[]; replyToId?: number | null }): Promise<ChatMessage>;
  updateMessage(id: number, body: string): Promise<ChatMessage | null>;
  deleteMessage(id: number): Promise<void>;
  listReactions(channelId: string): Promise<Record<number, ChatReaction[]>>;
  toggleReaction(messageId: number, userId: string, userName: string, emoji: string): Promise<{ active: boolean; reactions: ChatReaction[] }>;
}
