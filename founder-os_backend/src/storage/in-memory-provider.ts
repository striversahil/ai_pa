import { logger } from '../shared/logger';
import type { StorageProvider, ContactData, StoredContact, MessageData, StoredMessage, EmailData, StoredEmail, DigestData, StoredDigest, TaskData, StoredTask, StoredNote, AuditEntry, ChatPendingItemData, StoredChatPendingItem, StoredChatNote } from './interfaces';

function generateId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).substr(2, 9)}`;
}

export class InMemoryStorageProvider implements StorageProvider {
  private contacts: any[] = [];
  private messages: any[] = [];
  private emails: any[] = [];
  private digests: any[] = [];
  private tasks: any[] = [];
  private founderNotes: any[] = [];
  private auditLogs: any[] = [];
  private chatPendingItems: any[] = [];
  private chatNotes: any[] = [];

  constructor() {
    this.seed();
  }

  private seed() {
    const now = new Date();
    const chatRahul = '918595563952@c.us';
    const chatOps = '120363023032@g.us';

    this.contacts = [
      { id: 'contact-1', chatId: chatRahul, name: 'Rahul (Investor)', pushName: 'Rahul', phoneNumber: '918595563952', isGroup: false, lastMessageAt: new Date(now.getTime() - 18 * 60 * 1000), lastMessageBody: 'Also need the pitch deck updated with the latest revenue run-rate.', unreadCount: 0, createdAt: now, updatedAt: now },
      { id: 'contact-2', chatId: chatOps, name: 'Amit (Ops Manager)', pushName: 'Amit', phoneNumber: '120363023032', isGroup: true, lastMessageAt: new Date(now.getTime() - 14 * 60 * 1000), lastMessageBody: 'Yes, the database migrations are failing because of a locked connection.', unreadCount: 2, createdAt: now, updatedAt: now },
    ];

    this.messages = [
      { id: 'msg-1', wahaMessageId: null, chatId: chatRahul, sender: 'Rahul (Investor)', body: 'Hey Sahil, hope you are doing well.', timestamp: new Date(now.getTime() - 20 * 60 * 1000), processed: true, classification: 'PENDING', classificationReason: 'Investor follow-up', classifiedAt: now, slaDeadline: new Date(now.getTime() + 15 * 60 * 1000), createdAt: now },
      { id: 'msg-2', wahaMessageId: null, chatId: chatRahul, sender: 'Rahul (Investor)', body: 'Wanted to follow up on the Q3 growth figures. Can we jump on a call tomorrow at 10 AM to discuss?', timestamp: new Date(now.getTime() - 19 * 60 * 1000), processed: true, classification: 'PENDING', classificationReason: 'Meeting request', classifiedAt: now, slaDeadline: new Date(now.getTime() + 15 * 60 * 1000), createdAt: now },
      { id: 'msg-3', wahaMessageId: null, chatId: chatRahul, sender: 'Rahul (Investor)', body: 'Also need the pitch deck updated with the latest revenue run-rate.', timestamp: new Date(now.getTime() - 18 * 60 * 1000), processed: true, classification: 'PENDING', classificationReason: 'Action item', classifiedAt: now, slaDeadline: new Date(now.getTime() + 15 * 60 * 1000), createdAt: now },
      { id: 'msg-4', wahaMessageId: null, chatId: chatOps, sender: 'Amit (Ops Manager)', body: 'Hi guys, we are facing an issue with the staging server deployment.', timestamp: new Date(now.getTime() - 15 * 60 * 1000), processed: false, classification: null, classificationReason: null, classifiedAt: null, slaDeadline: null, createdAt: now },
      { id: 'msg-5', wahaMessageId: null, chatId: chatOps, sender: 'Neha (Tech Lead)', body: 'Yes, the database migrations are failing because of a locked connection. I need someone to check the database logs.', timestamp: new Date(now.getTime() - 14 * 60 * 1000), processed: false, classification: null, classificationReason: null, classifiedAt: null, slaDeadline: null, createdAt: now },
    ];

    this.emails = [
      { id: 'email-1', subject: 'URGENT: Stripe Account Verification Action Needed', sender: 'support@stripe.com', body: 'Hello Sahil, your account requires additional identity verification. Please upload the requested documents within 48 hours to avoid payout disruptions.', processed: false, createdAt: now },
      { id: 'email-2', subject: 'Partnership Proposal - TechCorp', sender: 'john.doe@techcorp.com', body: 'Hi Sahil, I am John from TechCorp. We love what you are building and would love to explore a distribution partnership. Are you free for an introductory call next Tuesday?', processed: false, createdAt: now },
    ];

    this.digests = [{
      id: 'digest-1', chatId: chatRahul, chatName: 'Rahul (Investor)',
      summary: 'Rahul followed up on the Q3 growth figures, requested a meeting at 10 AM tomorrow, and asked for an updated pitch deck with current run-rate revenue.',
      priority: 'high', category: 'Investor', sentiment: 'neutral', requiresFounder: true,
      suggestedReply: 'Thanks Rahul, I will make sure the revised valuations and pitch deck are in your inbox tonight. Let sync tomorrow at 10 AM.',
      createdAt: new Date(now.getTime() - 15 * 60 * 1000)
    }];

    this.tasks = [
      { id: 'task-1', title: 'Update pitch deck with latest revenue run-rate', owner: 'Founder', status: 'PENDING', deadline: new Date(now.getTime() + 24 * 3600 * 1000), source: 'WHATSAPP', sourceId: 'digest-1', createdAt: now },
      { id: 'task-2', title: 'Prepare Q3 valuations & growth slide deck figures', owner: 'Founder', status: 'PENDING', deadline: new Date(now.getTime() + 24 * 3600 * 1000), source: 'WHATSAPP', sourceId: 'digest-1', createdAt: now },
    ];

    this.founderNotes = [{
      id: 'brief-1',
      content: `# Morning Briefing - ${now.toLocaleDateString()}\n\n## Today Schedule & Meetings\n- 10:00 AM: Review Call with Rahul (Investor) - Prep valuations deck.\n\n## Urgent Matters\n- WhatsApp: Rahul (Investor) requested Q3 growth figures and updated pitch deck revenue numbers.\n- Email: Stripe Support requested verification documents within 48 hours to prevent account lockout.\n\n## High-Priority Conversations\n- Rahul (Investor): Active discussions regarding Q3 slide deck valuations.\n\n## Pending Action Items\n- [PENDING] Update pitch deck with latest revenue run-rate (Due: Tomorrow)\n- [PENDING] Prepare Q3 valuations & growth slide deck figures (Due: Tomorrow)\n\n## Suggested Focus Areas\n1. Update pitch deck revenue run-rates before the 10:00 AM call.\n2. Complete Stripe document uploads to avoid payout disruption.\n3. Review staging server deployment issues with Amit.`,
      createdAt: now
    }];
  }

  async upsertContact(data: ContactData): Promise<StoredContact> {
    const existing = this.contacts.find((c: any) => c.chatId === data.chatId);
    if (existing) {
      existing.name = data.name;
      existing.pushName = data.pushName || existing.pushName;
      existing.phoneNumber = data.phoneNumber;
      if (data.lastMessageAt) existing.lastMessageAt = data.lastMessageAt;
      if (data.lastMessageBody) existing.lastMessageBody = data.lastMessageBody;
      existing.unreadCount = data.unreadCount !== undefined ? data.unreadCount : (existing.unreadCount || 0) + 1;
      if (data.hasInbound === true) existing.hasInbound = true;
      existing.updatedAt = new Date();
      return existing;
    }
    const newContact = {
      id: generateId('contact'),
      chatId: data.chatId,
      name: data.name,
      pushName: data.pushName || null,
      phoneNumber: data.phoneNumber,
      isGroup: data.isGroup ?? false,
      lastMessageAt: data.lastMessageAt || null,
      lastMessageBody: data.lastMessageBody || null,
      unreadCount: data.unreadCount || 1,
      hasInbound: data.hasInbound === true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.contacts.push(newContact);
    return newContact;
  }

  async fetchContacts(): Promise<StoredContact[]> {
    return [...this.contacts].sort((a: any, b: any) => {
      if (!a.lastMessageAt) return 1;
      if (!b.lastMessageAt) return -1;
      return b.lastMessageAt.getTime() - a.lastMessageAt.getTime();
    });
  }

  async fetchContactByChatId(chatId: string): Promise<StoredContact | null> {
    return this.contacts.find((c: any) => c.chatId === chatId) || null;
  }

  async fetchContactByPhoneNumber(phoneNumber: string): Promise<StoredContact | null> {
    if (!phoneNumber) return null;
    return this.contacts.find((c: any) => c.phoneNumber === phoneNumber) || null;
  }

  async updateContactUnread(chatId: string, delta: number): Promise<void> {
    const contact = this.contacts.find((c: any) => c.chatId === chatId);
    if (contact) {
      contact.unreadCount = Math.max(0, (contact.unreadCount || 0) + delta);
    }
  }

  async saveMessage(data: MessageData): Promise<StoredMessage> {
    const newMsg = {
      id: generateId('msg'), wahaMessageId: data.wahaMessageId || null, chatId: data.chatId, sender: data.sender, body: data.body,
      timestamp: data.timestamp, processed: false, isHistorical: data.isHistorical || false,
      quotedMessageId: data.quotedMessageId || null, quotedBody: data.quotedBody || null, quotedSender: data.quotedSender || null,
      classification: null, classificationReason: null, classifiedAt: null, slaDeadline: null, createdAt: new Date()
    };
    this.messages.push(newMsg);
    return newMsg;
  }

  async fetchUnprocessedMessages(): Promise<StoredMessage[]> {
    return this.messages.filter((m: any) => !m.processed);
  }

  async markMessagesProcessed(messageIds: string[]): Promise<void> {
    this.messages = this.messages.map((m: any) => messageIds.includes(m.id) ? { ...m, processed: true } : m);
  }

  async fetchMessagesByChatId(chatId: string, limit = 50): Promise<StoredMessage[]> {
    return this.messages.filter((m: any) => m.chatId === chatId).sort((a: any, b: any) => b.timestamp.getTime() - a.timestamp.getTime()).slice(0, limit);
  }

  async hasInboundMessages(chatId: string): Promise<boolean> {
    const contact = this.contacts.find((c: any) => c.chatId === chatId);
    if (contact) return contact.hasInbound === true;
    return this.messages.some(
      (m: any) => m.chatId === chatId && (m.wahaMessageId != null || !['You', 'Founder'].includes(m.sender))
    );
  }

  async updateMessageClassification(messageId: string, classification: string, reason: string, classifiedAt: Date, slaDeadline: Date): Promise<void> {
    this.messages = this.messages.map((m: any) =>
      m.id === messageId ? { ...m, processed: true, classification, classificationReason: reason, classifiedAt, slaDeadline } : m
    );
  }

  async storeEmail(data: EmailData): Promise<StoredEmail> {
    const newEmail = { id: generateId('email'), subject: data.subject, sender: data.sender, body: data.body, processed: false, createdAt: new Date() };
    this.emails.push(newEmail);
    return newEmail;
  }

  async fetchUnprocessedEmails(): Promise<StoredEmail[]> {
    return this.emails.filter((e: any) => !e.processed);
  }

  async markEmailsProcessed(emailIds: string[]): Promise<void> {
    this.emails = this.emails.map((e: any) => emailIds.includes(e.id) ? { ...e, processed: true } : e);
  }

  async saveDigest(data: DigestData): Promise<StoredDigest> {
    const newDigest = { id: generateId('digest'), ...data, suggestedReply: data.suggestedReply || null, createdAt: new Date() };
    this.digests.push(newDigest);
    return newDigest;
  }

  async fetchDigests(limit = 100): Promise<StoredDigest[]> {
    return [...this.digests].sort((a: any, b: any) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, limit);
  }

  async fetchLatestDigestByChatId(chatId: string): Promise<StoredDigest | null> {
    const matches = this.digests.filter((d: any) => d.chatId === chatId);
    if (matches.length === 0) return null;
    return matches.sort((a: any, b: any) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  }

  async createTask(data: TaskData): Promise<StoredTask> {
    const newTask = { id: generateId('task'), title: data.title, owner: data.owner, status: data.status || 'PENDING', deadline: data.deadline || null, source: data.source, sourceId: data.sourceId || null, createdAt: new Date() };
    this.tasks.push(newTask);
    return newTask;
  }

  async fetchTasks(): Promise<StoredTask[]> {
    return [...this.tasks].sort((a: any, b: any) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async saveFounderNote(content: string): Promise<StoredNote> {
    const newNote = { id: generateId('brief'), content, createdAt: new Date() };
    this.founderNotes.push(newNote);
    return newNote;
  }

  async fetchLatestFounderNote(): Promise<StoredNote | null> {
    if (this.founderNotes.length === 0) return null;
    return [...this.founderNotes].sort((a: any, b: any) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  }

  async createChatPendingItem(data: ChatPendingItemData): Promise<StoredChatPendingItem> {
    const newItem = {
      id: generateId('pending'),
      chatId: data.chatId,
      chatName: data.chatName,
      description: data.description,
      status: data.status || 'OPEN',
      dueDate: data.dueDate || null,
      sourceMessageId: data.sourceMessageId || null,
      resolvedBy: data.resolvedBy || null,
      createdAt: new Date(),
      resolvedAt: null,
    };
    this.chatPendingItems.push(newItem);
    return newItem;
  }

  async fetchOpenChatPendingItems(chatId?: string): Promise<StoredChatPendingItem[]> {
    let items = this.chatPendingItems.filter((i: any) => i.status === 'OPEN');
    if (chatId) items = items.filter((i: any) => i.chatId === chatId);
    return [...items].sort((a: any, b: any) => {
      if (a.dueDate && b.dueDate) return a.dueDate.getTime() - b.dueDate.getTime();
      if (a.dueDate) return -1;
      if (b.dueDate) return 1;
      return b.createdAt.getTime() - a.createdAt.getTime();
    });
  }

  async fetchAllChatPendingItems(limit = 200): Promise<StoredChatPendingItem[]> {
    return [...this.chatPendingItems].sort((a: any, b: any) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, limit);
  }

  async resolveChatPendingItem(id: string, resolvedBy = 'MANUAL'): Promise<StoredChatPendingItem | null> {
    const item = this.chatPendingItems.find((i: any) => i.id === id);
    if (!item) return null;
    item.status = 'DONE';
    item.resolvedBy = resolvedBy;
    item.resolvedAt = new Date();
    return item;
  }

  async resolveChatPendingItemsByChatId(chatId: string, resolvedBy = 'SEND'): Promise<number> {
    let count = 0;
    this.chatPendingItems = this.chatPendingItems.map((i: any) => {
      if (i.chatId === chatId && i.status === 'OPEN') {
        count++;
        return { ...i, status: 'DONE', resolvedBy, resolvedAt: new Date() };
      }
      return i;
    });
    return count;
  }

  async cancelChatPendingItem(id: string): Promise<StoredChatPendingItem | null> {
    const item = this.chatPendingItems.find((i: any) => i.id === id);
    if (!item) return null;
    item.status = 'CANCELLED';
    item.resolvedBy = 'MANUAL';
    item.resolvedAt = new Date();
    return item;
  }

  async getChatNote(chatId: string): Promise<StoredChatNote | null> {
    const note = this.chatNotes.find((n: any) => n.chatId === chatId);
    return note || null;
  }

  async upsertChatNote(chatId: string, content: string): Promise<StoredChatNote> {
    const existing = this.chatNotes.find((n: any) => n.chatId === chatId);
    if (existing) {
      existing.content = content;
      existing.updatedAt = new Date();
      return existing;
    }
    const note = {
      chatId,
      content,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.chatNotes.push(note);
    return note;
  }

  async recordAuditEntry(action: string, entityType: string, entityId?: string | null, metadata?: Record<string, any> | null): Promise<void> {
    this.auditLogs.push({ id: generateId('audit'), action, entityType, entityId: entityId || null, metadata: metadata ? JSON.stringify(metadata) : null, createdAt: new Date() });
  }

  async queryAuditEntries(options: { action?: string; entityType?: string; limit?: number; since?: Date }): Promise<AuditEntry[]> {
    let results = [...this.auditLogs];
    if (options.action) results = results.filter((e: any) => e.action === options.action);
    if (options.entityType) results = results.filter((e: any) => e.entityType === options.entityType);
    if (options.since) results = results.filter((e: any) => e.createdAt >= options.since!);
    return results.sort((a: any, b: any) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, options.limit || 100);
  }
}