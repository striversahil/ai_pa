// Extracted verbatim from d1-provider.ts by scripts/refactor/split-module.mjs.
// d1-provider.ts re-exports everything public here, so existing imports keep working.
import type { StorageProvider, ContactData, StoredContact, MessageData, StoredMessage, EmailData, StoredEmail, DigestData, StoredDigest, TaskData, StoredTask, StoredNote, ChatPendingItemData, StoredChatPendingItem, StoredChatNote, AuditEntry } from "../interfaces";
import type { Row } from "./types";
import { boolToInt, iso, uuid, contactFromRow, messageFromRow, toBool, emailFromRow, digestFromRow, taskFromRow, noteFromRow, pendingFromRow, chatNoteFromRow, auditFromRow } from "./pure";

export class D1StorageProvider implements StorageProvider {
  private db: D1Database;
  constructor(db: D1Database) {
    this.db = db;
  }

  async upsertContact(data: ContactData): Promise<StoredContact> {
    const now = new Date();
    const existing = await this.db.prepare('SELECT * FROM Contact WHERE chatId = ?').bind(data.chatId).first();
    let row: Row;
    if (existing) {
      const unread = data.unreadCount !== undefined ? data.unreadCount : ((existing.unreadCount as number) || 0) + 1;
      await this.db.prepare(
        `UPDATE Contact SET name=?, pushName=?, phoneNumber=?, isGroup=?, lastMessageAt=?, lastMessageBody=?, unreadCount=?, hasInbound=?, updatedAt=?
         WHERE chatId=?`
      ).bind(
        data.name, data.pushName || null, data.phoneNumber, boolToInt(data.isGroup ?? false),
        iso(data.lastMessageAt || existing.lastMessageAt), data.lastMessageBody ?? (existing.lastMessageBody as string),
        unread, data.hasInbound === true ? 1 : (existing.hasInbound as number), now.toISOString(), data.chatId,
      ).run();
      row = await this.db.prepare('SELECT * FROM Contact WHERE chatId = ?').bind(data.chatId).first() as Row;
    } else {
      await this.db.prepare(
        `INSERT INTO Contact (id, chatId, name, pushName, phoneNumber, isGroup, lastMessageAt, lastMessageBody, unreadCount, hasInbound, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        uuid(), data.chatId, data.name, data.pushName || null, data.phoneNumber,
        boolToInt(data.isGroup ?? false), iso(data.lastMessageAt || null), data.lastMessageBody || null,
        data.unreadCount || 1, boolToInt(data.hasInbound === true), now.toISOString(), now.toISOString(),
      ).run();
      row = await this.db.prepare('SELECT * FROM Contact WHERE chatId = ?').bind(data.chatId).first() as Row;
    }
    return contactFromRow(row);
  }

  async fetchContacts(): Promise<StoredContact[]> {
    const { results } = await this.db.prepare('SELECT * FROM Contact ORDER BY lastMessageAt DESC').all();
    return results.map(contactFromRow);
  }

  async fetchContactByChatId(chatId: string): Promise<StoredContact | null> {
    const row = await this.db.prepare('SELECT * FROM Contact WHERE chatId = ?').bind(chatId).first() as Row | null;
    return row ? contactFromRow(row) : null;
  }

  async fetchContactByPhoneNumber(phoneNumber: string): Promise<StoredContact | null> {
    if (!phoneNumber) return null;
    const row = await this.db.prepare('SELECT * FROM Contact WHERE phoneNumber = ?').bind(phoneNumber).first() as Row | null;
    return row ? contactFromRow(row) : null;
  }

  async updateContactUnread(chatId: string, delta: number): Promise<void> {
    const contact = await this.db.prepare('SELECT unreadCount FROM Contact WHERE chatId = ?').bind(chatId).first() as Row | null;
    if (contact) {
      const newCount = Math.max(0, ((contact.unreadCount as number) || 0) + delta);
      await this.db.prepare('UPDATE Contact SET unreadCount = ?, updatedAt = ? WHERE chatId = ?')
        .bind(newCount, new Date().toISOString(), chatId).run();
    }
  }

  async saveMessage(data: MessageData): Promise<StoredMessage> {
    const now = new Date();
    const id = uuid();
    await this.db.prepare(
      `INSERT INTO Message (id, wahaMessageId, chatId, sender, body, timestamp, processed, isHistorical, quotedMessageId, quotedBody, quotedSender, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`
    ).bind(
      id, data.wahaMessageId || null, data.chatId, data.sender, data.body,
      iso(data.timestamp)!, boolToInt(data.isHistorical ?? false),
      data.quotedMessageId || null, data.quotedBody || null, data.quotedSender || null, now.toISOString(),
    ).run();
    const sel = await this.db.prepare('SELECT * FROM Message WHERE id = ?').bind(id).first() as Row;
    return messageFromRow(sel);
  }

  async fetchUnprocessedMessages(): Promise<StoredMessage[]> {
    const { results } = await this.db.prepare('SELECT * FROM Message WHERE processed = 0 ORDER BY timestamp ASC').all();
    return results.map(messageFromRow);
  }

  async markMessagesProcessed(messageIds: string[]): Promise<void> {
    if (messageIds.length === 0) return;
    const placeholders = messageIds.map(() => '?').join(',');
    await this.db.prepare(`UPDATE Message SET processed = 1 WHERE id IN (${placeholders})`).bind(...messageIds).run();
  }

  async fetchMessagesByChatId(chatId: string, limit = 50, before?: Date | null): Promise<StoredMessage[]> {
    const stmt = before
      ? this.db.prepare('SELECT * FROM Message WHERE chatId = ? AND timestamp < ? ORDER BY timestamp DESC LIMIT ?').bind(chatId, iso(before), limit)
      : this.db.prepare('SELECT * FROM Message WHERE chatId = ? ORDER BY timestamp DESC LIMIT ?').bind(chatId, limit);
    const { results } = await stmt.all();
    return results.map(messageFromRow);
  }

  async updateContactPicture(chatId: string, picture: string | null): Promise<void> {
    await this.db.prepare('UPDATE Contact SET picture = ?, updatedAt = ? WHERE chatId = ?')
      .bind(picture, new Date().toISOString(), chatId).run();
  }

  async hasInboundMessages(chatId: string): Promise<boolean> {
    const contact = await this.db.prepare('SELECT hasInbound FROM Contact WHERE chatId = ?').bind(chatId).first() as Row | null;
    if (contact) return toBool(contact.hasInbound as number);
    const row = await this.db.prepare(
      `SELECT COUNT(*) as c FROM Message WHERE chatId = ? AND (wahaMessageId IS NOT NULL OR sender NOT IN ('You','Founder'))`
    ).bind(chatId).first() as Row;
    return (row?.c as number) > 0;
  }

  async updateMessageClassification(messageId: string, classification: string, reason: string, classifiedAt: Date, slaDeadline: Date): Promise<void> {
    await this.db.prepare(
      `UPDATE Message SET processed = 1, classification = ?, classificationReason = ?, classifiedAt = ?, slaDeadline = ?
       WHERE id = ? AND processed = 0`
    ).bind(classification, reason, iso(classifiedAt), iso(slaDeadline), messageId).run();
  }

  async storeEmail(data: EmailData): Promise<StoredEmail> {
    const now = new Date();
    await this.db.prepare('INSERT INTO Email (id, subject, sender, body, processed, createdAt) VALUES (?, ?, ?, ?, 0, ?)')
      .bind(uuid(), data.subject, data.sender, data.body, now.toISOString()).run();
    const row = await this.db.prepare('SELECT * FROM Email WHERE createdAt = ? ORDER BY id DESC LIMIT 1').bind(now.toISOString()).first() as Row;
    return emailFromRow(row);
  }

  async fetchUnprocessedEmails(): Promise<StoredEmail[]> {
    const { results } = await this.db.prepare('SELECT * FROM Email WHERE processed = 0 ORDER BY createdAt ASC').all();
    return results.map(emailFromRow);
  }

  async markEmailsProcessed(emailIds: string[]): Promise<void> {
    if (emailIds.length === 0) return;
    const placeholders = emailIds.map(() => '?').join(',');
    await this.db.prepare(`UPDATE Email SET processed = 1 WHERE id IN (${placeholders})`).bind(...emailIds).run();
  }

  async saveDigest(data: DigestData): Promise<StoredDigest> {
    const now = new Date();
    await this.db.prepare(
      `INSERT INTO Digest (id, chatId, chatName, summary, priority, category, sentiment, requiresFounder, suggestedReply, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(uuid(), data.chatId, data.chatName, data.summary, data.priority, data.category, data.sentiment,
      boolToInt(data.requiresFounder), data.suggestedReply || null, now.toISOString()).run();
    const row = await this.db.prepare('SELECT * FROM Digest WHERE createdAt = ? ORDER BY id DESC LIMIT 1').bind(now.toISOString()).first() as Row;
    return digestFromRow(row);
  }

  async fetchDigests(limit = 100): Promise<StoredDigest[]> {
    const { results } = await this.db.prepare('SELECT * FROM Digest ORDER BY createdAt DESC LIMIT ?').bind(limit).all();
    return results.map(digestFromRow);
  }

  async fetchLatestDigestByChatId(chatId: string): Promise<StoredDigest | null> {
    const row = await this.db.prepare('SELECT * FROM Digest WHERE chatId = ? ORDER BY createdAt DESC LIMIT 1').bind(chatId).first() as Row | null;
    return row ? digestFromRow(row) : null;
  }

  async createTask(data: TaskData): Promise<StoredTask> {
    const now = new Date();
    await this.db.prepare(
      'INSERT INTO Task (id, title, owner, status, deadline, source, sourceId, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(uuid(), data.title, data.owner, data.status || 'PENDING', iso(data.deadline), data.source, data.sourceId || null, now.toISOString()).run();
    const row = await this.db.prepare('SELECT * FROM Task WHERE createdAt = ? ORDER BY id DESC LIMIT 1').bind(now.toISOString()).first() as Row;
    return taskFromRow(row);
  }

  async fetchTasks(): Promise<StoredTask[]> {
    const { results } = await this.db.prepare('SELECT * FROM Task ORDER BY createdAt DESC').all();
    return results.map(taskFromRow);
  }

  async saveFounderNote(content: string): Promise<StoredNote> {
    const now = new Date();
    await this.db.prepare('INSERT INTO FounderNote (id, content, createdAt) VALUES (?, ?, ?)').bind(uuid(), content, now.toISOString()).run();
    const row = await this.db.prepare('SELECT * FROM FounderNote WHERE createdAt = ? ORDER BY id DESC LIMIT 1').bind(now.toISOString()).first() as Row;
    return noteFromRow(row);
  }

  async fetchLatestFounderNote(): Promise<StoredNote | null> {
    const row = await this.db.prepare('SELECT * FROM FounderNote ORDER BY createdAt DESC LIMIT 1').first() as Row | null;
    return row ? noteFromRow(row) : null;
  }

  async createChatPendingItem(data: ChatPendingItemData): Promise<StoredChatPendingItem> {
    const now = new Date();
    await this.db.prepare(
      `INSERT INTO ChatPendingItem (id, chatId, chatName, description, status, dueDate, sourceMessageId, resolvedBy, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(uuid(), data.chatId, data.chatName, data.description, data.status || 'OPEN',
      iso(data.dueDate), data.sourceMessageId || null, data.resolvedBy || null, now.toISOString()).run();
    const row = await this.db.prepare('SELECT * FROM ChatPendingItem WHERE createdAt = ? ORDER BY id DESC LIMIT 1').bind(now.toISOString()).first() as Row;
    return pendingFromRow(row);
  }

  async fetchOpenChatPendingItems(chatId?: string): Promise<StoredChatPendingItem[]> {
    let sql = 'SELECT * FROM ChatPendingItem WHERE status = \'OPEN\'';
    const params: unknown[] = [];
    if (chatId) { sql += ' AND chatId = ?'; params.push(chatId); }
    sql += ' ORDER BY dueDate ASC, createdAt DESC';
    const { results } = await this.db.prepare(sql).bind(...params).all();
    return results.map(pendingFromRow);
  }

  async fetchAllChatPendingItems(limit = 200): Promise<StoredChatPendingItem[]> {
    const { results } = await this.db.prepare('SELECT * FROM ChatPendingItem ORDER BY createdAt DESC LIMIT ?').bind(limit).all();
    return results.map(pendingFromRow);
  }

  async resolveChatPendingItem(id: string, resolvedBy = 'MANUAL'): Promise<StoredChatPendingItem | null> {
    const res = await this.db.prepare('UPDATE ChatPendingItem SET status = \'DONE\', resolvedBy = ?, resolvedAt = ? WHERE id = ? AND status = \'OPEN\'')
      .bind(resolvedBy, new Date().toISOString(), id).run();
    if (res.meta.changes === 0) return null;
    const row = await this.db.prepare('SELECT * FROM ChatPendingItem WHERE id = ?').bind(id).first() as Row;
    return pendingFromRow(row);
  }

  async resolveChatPendingItemsByChatId(chatId: string, resolvedBy = 'SEND'): Promise<number> {
    const res = await this.db.prepare('UPDATE ChatPendingItem SET status = \'DONE\', resolvedBy = ?, resolvedAt = ? WHERE chatId = ? AND status = \'OPEN\'')
      .bind(resolvedBy, new Date().toISOString(), chatId).run();
    return res.meta.changes ?? 0;
  }

  async cancelChatPendingItem(id: string): Promise<StoredChatPendingItem | null> {
    const res = await this.db.prepare('UPDATE ChatPendingItem SET status = \'CANCELLED\', resolvedBy = \'MANUAL\', resolvedAt = ? WHERE id = ? AND status = \'OPEN\'')
      .bind(new Date().toISOString(), id).run();
    if (res.meta.changes === 0) return null;
    const row = await this.db.prepare('SELECT * FROM ChatPendingItem WHERE id = ?').bind(id).first() as Row;
    return pendingFromRow(row);
  }

  async getChatNote(chatId: string): Promise<StoredChatNote | null> {
    const row = await this.db.prepare('SELECT * FROM ChatNote WHERE chatId = ?').bind(chatId).first() as Row | null;
    return row ? chatNoteFromRow(row) : null;
  }

  async upsertChatNote(chatId: string, content: string): Promise<StoredChatNote> {
    const now = new Date();
    await this.db.prepare(
      `INSERT INTO ChatNote (chatId, content, createdAt, updatedAt) VALUES (?, ?, ?, ?)
       ON CONFLICT(chatId) DO UPDATE SET content = excluded.content, updatedAt = excluded.updatedAt`
    ).bind(chatId, content, now.toISOString(), now.toISOString()).run();
    const row = await this.db.prepare('SELECT * FROM ChatNote WHERE chatId = ?').bind(chatId).first() as Row;
    return chatNoteFromRow(row);
  }

  async recordAuditEntry(action: string, entityType: string, entityId?: string | null, metadata?: Record<string, any> | null): Promise<void> {
    await this.db.prepare('INSERT INTO AuditLog (id, action, entityType, entityId, metadata, createdAt) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(uuid(), action, entityType, entityId || null, metadata ? JSON.stringify(metadata) : null, new Date().toISOString()).run();
  }

  async queryAuditEntries(options: { action?: string; entityType?: string; limit?: number; since?: Date }): Promise<AuditEntry[]> {
    let sql = 'SELECT * FROM AuditLog WHERE 1=1';
    const params: unknown[] = [];
    if (options.action) { sql += ' AND action = ?'; params.push(options.action); }
    if (options.entityType) { sql += ' AND entityType = ?'; params.push(options.entityType); }
    if (options.since) { sql += ' AND createdAt >= ?'; params.push(options.since.toISOString()); }
    sql += ' ORDER BY createdAt DESC LIMIT ?';
    params.push(options.limit || 100);
    const { results } = await this.db.prepare(sql).bind(...params).all();
    return results.map(auditFromRow);
  }
}
