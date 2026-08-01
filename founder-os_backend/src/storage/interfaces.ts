export interface ContactData {
  chatId: string;
  name: string;
  pushName?: string | null;
  phoneNumber: string;
  isGroup?: boolean;
  lastMessageAt?: Date | null;
  lastMessageBody?: string | null;
  unreadCount?: number;
  hasInbound?: boolean;
}

export interface StoredContact {
  id: string;
  chatId: string;
  name: string;
  pushName: string | null;
  phoneNumber: string;
  isGroup: boolean;
  lastMessageAt: Date | null;
  lastMessageBody: string | null;
  unreadCount: number;
  hasInbound: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface MessageData {
  chatId: string;
  sender: string;
  body: string;
  timestamp: Date;
  wahaMessageId?: string | null;
  isHistorical?: boolean;
  quotedMessageId?: string | null;
  quotedBody?: string | null;
  quotedSender?: string | null;
}

export interface StoredMessage {
  id: string;
  chatId: string;
  sender: string;
  body: string;
  timestamp: Date;
  processed: boolean;
  wahaMessageId: string | null;
  isHistorical: boolean;
  quotedMessageId: string | null;
  quotedBody: string | null;
  quotedSender: string | null;
  classification: string | null;
  classificationReason: string | null;
  classifiedAt: Date | null;
  slaDeadline: Date | null;
  createdAt: Date;
}

export interface EmailData {
  subject: string;
  sender: string;
  body: string;
}

export interface StoredEmail {
  id: string;
  subject: string;
  sender: string;
  body: string;
  processed: boolean;
  createdAt: Date;
}

export interface DigestData {
  chatId: string;
  chatName: string;
  summary: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  category: string;
  sentiment: string;
  requiresFounder: boolean;
  suggestedReply?: string;
}

export interface StoredDigest {
  id: string;
  chatId: string;
  chatName: string;
  summary: string;
  priority: string;
  category: string;
  sentiment: string;
  requiresFounder: boolean;
  suggestedReply: string | null;
  createdAt: Date;
}

export interface TaskData {
  title: string;
  owner: string;
  status?: string;
  deadline?: Date | null;
  source: string;
  sourceId?: string | null;
}

export interface StoredTask {
  id: string;
  title: string;
  owner: string;
  status: string;
  deadline: Date | null;
  source: string;
  sourceId: string | null;
  createdAt: Date;
}

export interface StoredNote {
  id: string;
  content: string;
  createdAt: Date;
}

export interface StorageProvider {
  upsertContact(data: ContactData): Promise<StoredContact>;
  fetchContacts(): Promise<StoredContact[]>;
  fetchContactByChatId(chatId: string): Promise<StoredContact | null>;
  fetchContactByPhoneNumber(phoneNumber: string): Promise<StoredContact | null>;
  updateContactUnread(chatId: string, delta: number): Promise<void>;
  saveMessage(data: MessageData): Promise<StoredMessage>;
  fetchUnprocessedMessages(): Promise<StoredMessage[]>;
  markMessagesProcessed(messageIds: string[]): Promise<void>;
  fetchMessagesByChatId(chatId: string, limit?: number): Promise<StoredMessage[]>;
  hasInboundMessages(chatId: string): Promise<boolean>;
  updateMessageClassification(messageId: string, classification: string, reason: string, classifiedAt: Date, slaDeadline: Date): Promise<void>;
  storeEmail(data: EmailData): Promise<StoredEmail>;
  fetchUnprocessedEmails(): Promise<StoredEmail[]>;
  markEmailsProcessed(emailIds: string[]): Promise<void>;
  saveDigest(data: DigestData): Promise<StoredDigest>;
  fetchDigests(limit?: number): Promise<StoredDigest[]>;
  fetchLatestDigestByChatId(chatId: string): Promise<StoredDigest | null>;
  createTask(data: TaskData): Promise<StoredTask>;
  fetchTasks(): Promise<StoredTask[]>;
  saveFounderNote(content: string): Promise<StoredNote>;
  fetchLatestFounderNote(): Promise<StoredNote | null>;

  recordAuditEntry(action: string, entityType: string, entityId?: string | null, metadata?: Record<string, any> | null): Promise<void>;
  queryAuditEntries(options: { action?: string; entityType?: string; limit?: number; since?: Date }): Promise<AuditEntry[]>;
}

export interface AuditEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: string | null;
  createdAt: Date;
}