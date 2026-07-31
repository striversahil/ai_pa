import { prisma } from '../shared/prisma';
import { logger } from '../shared/logger';
import { Priority, TaskStatus } from '@prisma/client';
import type { StorageProvider, ContactData, StoredContact, MessageData, StoredMessage, EmailData, StoredEmail, DigestData, StoredDigest, TaskData, StoredTask, StoredNote, AuditEntry } from './interfaces';

export class PrismaStorageProvider implements StorageProvider {
  async upsertContact(data: ContactData): Promise<StoredContact> {
    const contact = await prisma.contact.upsert({
      where: { chatId: data.chatId },
      update: {
        name: data.name,
        pushName: data.pushName || null,
        phoneNumber: data.phoneNumber,
        isGroup: data.isGroup ?? false,
        lastMessageAt: data.lastMessageAt || undefined,
        lastMessageBody: data.lastMessageBody || undefined,
        unreadCount: data.unreadCount !== undefined ? data.unreadCount : { increment: 1 },
      },
      create: {
        chatId: data.chatId,
        name: data.name,
        pushName: data.pushName || null,
        phoneNumber: data.phoneNumber,
        isGroup: data.isGroup ?? false,
        lastMessageAt: data.lastMessageAt || null,
        lastMessageBody: data.lastMessageBody || null,
        unreadCount: data.unreadCount || 1,
      },
    });
    return contact as StoredContact;
  }

  async fetchContacts(): Promise<StoredContact[]> {
    return prisma.contact.findMany({ orderBy: { lastMessageAt: 'desc' } }) as Promise<StoredContact[]>;
  }

  async fetchContactByChatId(chatId: string): Promise<StoredContact | null> {
    const contact = await prisma.contact.findUnique({ where: { chatId } });
    return contact as StoredContact | null;
  }

  async fetchContactByPhoneNumber(phoneNumber: string): Promise<StoredContact | null> {
    if (!phoneNumber) return null;
    const contact = await prisma.contact.findFirst({ where: { phoneNumber } });
    return contact as StoredContact | null;
  }

  async updateContactUnread(chatId: string, delta: number): Promise<void> {
    const contact = await prisma.contact.findUnique({ where: { chatId } });
    if (contact) {
      const newCount = Math.max(0, (contact.unreadCount || 0) + delta);
      await prisma.contact.update({ where: { chatId }, data: { unreadCount: newCount } });
    }
  }

  async saveMessage(data: MessageData): Promise<StoredMessage> {
    logger.info({ chatId: data.chatId, sender: data.sender }, 'Saving raw message to storage');
    const msg = await prisma.message.create({
      data: { chatId: data.chatId, sender: data.sender, body: data.body, timestamp: data.timestamp, processed: false, isHistorical: data.isHistorical || false, wahaMessageId: data.wahaMessageId || null }
    });
    return msg as StoredMessage;
  }

  async fetchUnprocessedMessages(): Promise<StoredMessage[]> {
    logger.debug('Fetching unprocessed messages from storage');
    return prisma.message.findMany({ where: { processed: false }, orderBy: { timestamp: 'asc' } }) as Promise<StoredMessage[]>;
  }

  async markMessagesProcessed(messageIds: string[]): Promise<void> {
    if (messageIds.length === 0) return;
    logger.info({ count: messageIds.length }, 'Marking messages as processed');
    await prisma.message.updateMany({ where: { id: { in: messageIds } }, data: { processed: true } });
  }

  async fetchMessagesByChatId(chatId: string, limit = 50): Promise<StoredMessage[]> {
    logger.debug({ chatId, limit }, 'Fetching messages for chat');
    return prisma.message.findMany({ where: { chatId }, orderBy: { timestamp: 'desc' }, take: limit }) as Promise<StoredMessage[]>;
  }

  async updateMessageClassification(messageId: string, classification: string, reason: string, classifiedAt: Date, slaDeadline: Date): Promise<void> {
    await prisma.message.update({
      where: { id: messageId },
      data: { processed: true, classification, classificationReason: reason, classifiedAt, slaDeadline },
    });
  }

  async storeEmail(data: EmailData): Promise<StoredEmail> {
    logger.info({ sender: data.sender, subject: data.subject }, 'Saving email to storage');
    const email = await prisma.email.create({ data: { subject: data.subject, sender: data.sender, body: data.body, processed: false } });
    return email as StoredEmail;
  }

  async fetchUnprocessedEmails(): Promise<StoredEmail[]> {
    logger.debug('Fetching unprocessed emails from storage');
    return prisma.email.findMany({ where: { processed: false }, orderBy: { createdAt: 'asc' } }) as Promise<StoredEmail[]>;
  }

  async markEmailsProcessed(emailIds: string[]): Promise<void> {
    if (emailIds.length === 0) return;
    logger.info({ count: emailIds.length }, 'Marking emails as processed');
    await prisma.email.updateMany({ where: { id: { in: emailIds } }, data: { processed: true } });
  }

  async saveDigest(data: DigestData): Promise<StoredDigest> {
    logger.info({ chatId: data.chatId, priority: data.priority }, 'Saving digest to storage');
    const digest = await prisma.digest.create({
      data: { chatId: data.chatId, chatName: data.chatName, summary: data.summary, priority: data.priority as Priority, category: data.category, sentiment: data.sentiment, requiresFounder: data.requiresFounder, suggestedReply: data.suggestedReply || null }
    });
    return digest as StoredDigest;
  }

  async fetchDigests(limit = 100): Promise<StoredDigest[]> {
    logger.debug({ limit }, 'Fetching digests from storage');
    return prisma.digest.findMany({ orderBy: { createdAt: 'desc' }, take: limit }) as Promise<StoredDigest[]>;
  }

  async fetchLatestDigestByChatId(chatId: string): Promise<StoredDigest | null> {
    const digest = await prisma.digest.findFirst({ where: { chatId }, orderBy: { createdAt: 'desc' } });
    return digest as StoredDigest | null;
  }

  async createTask(data: TaskData): Promise<StoredTask> {
    logger.info({ title: data.title, owner: data.owner }, 'Creating task in storage');
    const task = await prisma.task.create({
      data: { title: data.title, owner: data.owner, status: (data.status as TaskStatus) || 'PENDING', deadline: data.deadline || null, source: data.source, sourceId: data.sourceId || null }
    });
    return task as StoredTask;
  }

  async fetchTasks(): Promise<StoredTask[]> {
    logger.debug('Fetching tasks from storage');
    return prisma.task.findMany({ orderBy: { createdAt: 'desc' } }) as Promise<StoredTask[]>;
  }

  async saveFounderNote(content: string): Promise<StoredNote> {
    logger.info('Saving founder briefing/note to storage');
    const note = await prisma.founderNote.create({ data: { content } });
    return note as StoredNote;
  }

  async fetchLatestFounderNote(): Promise<StoredNote | null> {
    logger.debug('Fetching latest founder note/briefing');
    const note = await prisma.founderNote.findFirst({ orderBy: { createdAt: 'desc' } });
    return note as StoredNote | null;
  }

  async recordAuditEntry(action: string, entityType: string, entityId?: string | null, metadata?: Record<string, any> | null): Promise<void> {
    await prisma.auditLog.create({
      data: { action, entityType, entityId: entityId || null, metadata: metadata ? JSON.stringify(metadata) : null },
    });
  }

  async queryAuditEntries(options: { action?: string; entityType?: string; limit?: number; since?: Date }): Promise<AuditEntry[]> {
    const where: any = {};
    if (options.action) where.action = options.action;
    if (options.entityType) where.entityType = options.entityType;
    if (options.since) where.createdAt = { gte: options.since };
    return prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, take: options.limit || 100 }) as Promise<AuditEntry[]>;
  }
}