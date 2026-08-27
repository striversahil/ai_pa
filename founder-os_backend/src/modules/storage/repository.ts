import { logger } from '../../shared/logger';
import { getStorageProvider } from '../../storage';
import type { StorageProvider, ContactData, StoredContact, ChatPendingItemData, StoredChatPendingItem, StoredChatNote } from '../../storage/interfaces';

function getProvider(): StorageProvider {
  return getStorageProvider();
}

export class StorageRepository {
  static async upsertContact(data: ContactData): Promise<StoredContact> {
    logger.info({ chatId: data.chatId, name: data.name }, 'Upserting contact');
    return getProvider().upsertContact(data);
  }

  static async fetchContacts(): Promise<StoredContact[]> {
    logger.debug('Fetching contacts');
    return getProvider().fetchContacts();
  }

  static async fetchContactByChatId(chatId: string): Promise<StoredContact | null> {
    logger.debug({ chatId }, 'Fetching contact by chatId');
    return getProvider().fetchContactByChatId(chatId);
  }

  static async fetchContactByPhoneNumber(phoneNumber: string): Promise<StoredContact | null> {
    logger.debug({ phoneNumber }, 'Fetching contact by phone number');
    return getProvider().fetchContactByPhoneNumber(phoneNumber);
  }

  static async updateContactUnread(chatId: string, delta: number): Promise<void> {
    logger.debug({ chatId, delta }, 'Updating contact unread count');
    return getProvider().updateContactUnread(chatId, delta);
  }

  static async saveMessage(data: { chatId: string; sender: string; body: string; timestamp: Date; wahaMessageId?: string | null }) {
    logger.info({ chatId: data.chatId, sender: data.sender }, 'Saving message');
    return getProvider().saveMessage(data);
  }

  static async fetchUnprocessedMessages() {
    logger.debug('Fetching unprocessed messages');
    return getProvider().fetchUnprocessedMessages();
  }

  static async markMessagesProcessed(messageIds: string[]) {
    logger.info({ count: messageIds.length }, 'Marking messages processed');
    return getProvider().markMessagesProcessed(messageIds);
  }

  static async fetchMessagesByChatId(chatId: string, limit = 50, before?: Date | null) {
    logger.debug({ chatId, limit }, 'Fetching messages for chat');
    return getProvider().fetchMessagesByChatId(chatId, limit, before);
  }

  static async updateContactPicture(chatId: string, picture: string | null) {
    return getProvider().updateContactPicture(chatId, picture);
  }

  static async hasInboundMessages(chatId: string): Promise<boolean> {
    logger.debug({ chatId }, 'Checking whether chat has ever messaged us (allowlist)');
    return getProvider().hasInboundMessages(chatId);
  }

  static async updateMessageClassification(messageId: string, classification: string, reason: string, classifiedAt: Date, slaDeadline: Date) {
    logger.debug({ messageId, classification }, 'Updating message classification');
    return getProvider().updateMessageClassification(messageId, classification, reason, classifiedAt, slaDeadline);
  }

  static async storeEmail(data: { subject: string; sender: string; body: string }) {
    logger.info({ sender: data.sender, subject: data.subject }, 'Saving email');
    return getProvider().storeEmail(data);
  }

  static async fetchUnprocessedEmails() {
    logger.debug('Fetching unprocessed emails');
    return getProvider().fetchUnprocessedEmails();
  }

  static async markEmailsProcessed(emailIds: string[]) {
    logger.info({ count: emailIds.length }, 'Marking emails processed');
    return getProvider().markEmailsProcessed(emailIds);
  }

  static async saveDigest(data: { chatId: string; chatName: string; summary: string; priority: 'low' | 'medium' | 'high' | 'urgent'; category: string; sentiment: string; requiresFounder: boolean; suggestedReply?: string }) {
    logger.info({ chatId: data.chatId, priority: data.priority }, 'Saving digest');
    return getProvider().saveDigest(data);
  }

  static async fetchDigests(limit = 100) {
    logger.debug({ limit }, 'Fetching digests');
    return getProvider().fetchDigests(limit);
  }

  static async fetchLatestDigestByChatId(chatId: string) {
    logger.debug({ chatId }, 'Fetching latest digest for chat');
    return getProvider().fetchLatestDigestByChatId(chatId);
  }

  static async createTask(data: { title: string; owner: string; status?: string; deadline?: Date | null; source: string; sourceId?: string | null }) {
    logger.info({ title: data.title, owner: data.owner }, 'Creating task');
    return getProvider().createTask(data);
  }

  static async fetchTasks() {
    logger.debug('Fetching tasks');
    return getProvider().fetchTasks();
  }

  static async saveFounderNote(content: string) {
    logger.info('Saving founder briefing/note');
    return getProvider().saveFounderNote(content);
  }

  static async fetchLatestFounderNote() {
    logger.debug('Fetching latest founder note');
    return getProvider().fetchLatestFounderNote();
  }

  static async createChatPendingItem(data: ChatPendingItemData): Promise<StoredChatPendingItem> {
    logger.info({ chatId: data.chatId, description: data.description.substring(0, 60) }, 'Creating chat pending item');
    return getProvider().createChatPendingItem(data);
  }

  static async fetchOpenChatPendingItems(chatId?: string): Promise<StoredChatPendingItem[]> {
    logger.debug({ chatId }, 'Fetching open chat pending items');
    return getProvider().fetchOpenChatPendingItems(chatId);
  }

  static async fetchAllChatPendingItems(limit = 200): Promise<StoredChatPendingItem[]> {
    logger.debug({ limit }, 'Fetching all chat pending items');
    return getProvider().fetchAllChatPendingItems(limit);
  }

  static async resolveChatPendingItem(id: string, resolvedBy = 'MANUAL'): Promise<StoredChatPendingItem | null> {
    logger.info({ id, resolvedBy }, 'Resolving chat pending item');
    return getProvider().resolveChatPendingItem(id, resolvedBy);
  }

  static async resolveChatPendingItemsByChatId(chatId: string, resolvedBy = 'SEND'): Promise<number> {
    logger.info({ chatId, resolvedBy }, 'Resolving all open chat pending items for chat');
    return getProvider().resolveChatPendingItemsByChatId(chatId, resolvedBy);
  }

    static async cancelChatPendingItem(id: string): Promise<StoredChatPendingItem | null> {
    logger.info({ id }, 'Cancelling chat pending item');
    return getProvider().cancelChatPendingItem(id);
  }

  static async getChatNote(chatId: string): Promise<StoredChatNote | null> {
    return getProvider().getChatNote(chatId);
  }

  static async upsertChatNote(chatId: string, content: string): Promise<StoredChatNote> {
    logger.info({ chatId }, 'Saving private chat note');
    return getProvider().upsertChatNote(chatId, content);
  }

  static async recordAuditEntry(action: string, entityType: string, entityId?: string | null, metadata?: Record<string, any> | null) {
    return getProvider().recordAuditEntry(action, entityType, entityId, metadata);
  }

  static async queryAuditEntries(options: { action?: string; entityType?: string; limit?: number; since?: Date }) {
    return getProvider().queryAuditEntries(options);
  }
}
export default StorageRepository;
