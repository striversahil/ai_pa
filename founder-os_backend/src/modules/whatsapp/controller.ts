import { Request, Response } from 'express';
import { StorageRepository } from '../storage/repository';
import { logger } from '../../shared/logger';
import { broadcastWhatsAppEvent } from '../../shared/sse';
import { config } from '../../config';
import { AuditService } from '../audit/service';
import { messageBuffer } from './message-buffer';
import { AutomationEngine } from '../automation/engine';

// Historical-replay threshold: payloads older than this (in seconds) are flagged
// is_historical and bypass all real-time triggers (classification, SSE, unread).
const HISTORICAL_THRESHOLD_MS = 120_000;

// Fast-path dedup cache for webhook replay storms. The DB ON CONFLICT DO NOTHING is
// the source of truth; this only avoids redundant contact/SSE/audit work.
const recentMessageIds = new Map<string, number>();
const RECENT_ID_CACHE_MAX = 10_000;

function noteRecentMessageId(id: string): boolean {
  const now = Date.now();
  if (recentMessageIds.has(id)) return true;
  recentMessageIds.set(id, now);
  if (recentMessageIds.size > RECENT_ID_CACHE_MAX) {
    for (const [key, ts] of recentMessageIds) {
      if (now - ts > 3_600_000) recentMessageIds.delete(key);
    }
  }
  return false;
}

function extractMessageBody(message: any): string {
  if (message.body) return message.body;
  if (message.text) return typeof message.text === 'string' ? message.text : (message.text.body || JSON.stringify(message.text));
  const type = message.type || message.media_type;
  const typeLabels: Record<string, string> = {
    image: '[Image]',
    video: '[Video]',
    audio: '[Audio]',
    document: message.filename ? `[Document: ${message.filename}]` : '[Document]',
    location: '[Location]',
    poll: '[Poll]',
    sticker: '[Sticker]',
    contact: '[Contact Card]',
    buttons: '[Button Reply]',
    list: '[List Selection]',
  };
  const label = typeLabels[type];
  // Media captions are shown WITH their type label ("[Image] the catalogue, sir")
  // so downstream LLMs keep the media context instead of a bare sentence.
  if (message.caption) return label ? `${label} ${message.caption}` : String(message.caption);
  return label || '[Media/System Message]';
}

// WA Engine Pro exposes the replied-to message on the inbound message. Returns
// quoted message metadata or empty fields when the message is not a reply.
function extractQuotedMessage(message: any): { quotedMessageId: string | null; quotedBody: string | null; quotedSender: string | null } {
  const q = message.replyTo || message.quotedMsg || message.quotedMessage;
  if (!q || typeof q !== 'object') {
    return { quotedMessageId: null, quotedBody: null, quotedSender: null };
  }
  let body: string | null = typeof q.body === 'string' && q.body ? q.body : null;
  if (!body && (q.hasMedia || q.media)) body = '[Media]';
  const participant = q.participant || q.from || q.sender?.id || q.chatId;
  const sender = typeof participant === 'string' && participant ? participant : null;
  return {
    quotedMessageId: typeof q.id === 'string' ? q.id : null,
    quotedBody: body,
    quotedSender: sender,
  };
}

function isHistorical(timestamp: Date): boolean {
  return Date.now() - timestamp.getTime() > HISTORICAL_THRESHOLD_MS;
}

function extractPhoneFromParticipant(participantId: string): string {
  return participantId.replace(/[@\-].*$/, '').replace(/[^0-9]/g, '');
}

async function resolveGroupSenderName(participantId: string): Promise<string | null> {
  if (!participantId) return null;
  const clean = extractPhoneFromParticipant(participantId);
  if (!clean || clean.length < 7) return null;
  const local = await StorageRepository.fetchContactByPhoneNumber(clean).catch(() => null);
  if (local?.name && local.name !== local.chatId && local.name !== clean) return local.name;
  return null;
}

function extractSenderName(message: any, contact?: any): string {
  if (contact?.name) return contact.name;
  if (message?.sender?.name) return message.sender.name;
  if (message?.sender?.pushname) return message.sender.pushname;
  if (contact?.first_name) return contact.first_name;
  const phone = extractPhoneFromParticipant(message?.from || message?.chatId || '');
  return phone || 'Client';
}

function extractPushName(message: any, contact?: any): string | null {
  return message?.sender?.pushname || message?.sender?.name || contact?.pushname || null;
}

function extractPhoneNumber(chatId: string): string {
  if (chatId.endsWith('@g.us')) return '';
  return chatId.replace(/@c\.us$/, '').replace(/[^0-9]/g, '');
}

function isGroupChat(chatId: string): boolean {
  return chatId.endsWith('@g.us');
}

async function upsertContactFromMessage(chatId: string, message: any, contact: any, opts: { skipUnreadIncrement?: boolean } = {}) {
  const group = isGroupChat(chatId);
  const pushName = extractPushName(message, contact);
  const phoneNumber = extractPhoneNumber(chatId);
  const senderName = extractSenderName(message, contact);
  const name = group ? chatId : senderName;

  const existing = await StorageRepository.fetchContactByChatId(chatId).catch(() => null);

  await StorageRepository.upsertContact({
    chatId,
    name,
    pushName: group ? null : pushName,
    phoneNumber,
    isGroup: group,
    lastMessageAt: new Date((message.timestamp || Date.now() / 1000) * 1000),
    lastMessageBody: extractMessageBody(message),
    hasInbound: true,
    ...(opts.skipUnreadIncrement ? { unreadCount: existing?.unreadCount ?? 0 } : {}),
  });
}

/**
 * Emits inbound-message events to the automation framework at ingest time
 * (before the classification queue), so event automations can react
 * near-real-time. Group chats get `whatsapp.group.message`; 1:1 chats get
 * `whatsapp.message.inbound`.
 */
function emitInboundEvents(chatId: string, sender: string, body: string, messageId: string | undefined, timestamp: Date) {
  const event = chatId.endsWith('@g.us') ? 'whatsapp.group.message' : 'whatsapp.message.inbound';
  AutomationEngine.trigger(event, {
    chatId,
    sender,
    body,
    messageId,
    timestamp: timestamp.toISOString(),
  }).catch((e: any) => {
    logger.error({ error: e.message }, 'Automation event emit failed');
  });
}

// WA Engine Pro message id can arrive as a bare string or an envelope —
// normalize both.
function extractMessageId(message: any): string | null {
  const raw = message.id || message.message_id || message.wa_id;
  if (!raw) return null;
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'object' && raw.id) return String(raw.id);
  return null;
}

/** Normalize a WA Engine Pro phone/contact id to a chatId (@c.us / @g.us). */
function toChatId(raw: string | undefined, message: any): string {
  const contactId = raw || message.from || message.chatId || '';
  const cleaned = contactId.replace(/[^0-9@]/g, '');
  if (cleaned.endsWith('@g.us')) return cleaned;
  if (cleaned.endsWith('@c.us') || cleaned.endsWith('@lid')) return cleaned;
  const digits = cleaned.replace(/[^0-9]/g, '');
  if (!digits) return contactId || 'unknown';
  return `${digits}@c.us`;
}

async function processInboundMessage(message: any, contact?: any): Promise<void> {
  const messageId = extractMessageId(message);
  if (messageId && noteRecentMessageId(messageId)) {
    logger.debug({ messageId }, 'Duplicate webhook delivery (recent cache), skipping');
    return;
  }

  const from = toChatId(message.phone || contact?.phone_number || contact?.wa_id, message);
  const group = isGroupChat(from);
  let sender = extractSenderName(message, contact);
  if (group) {
    const participantId = message.sender?.id || message.participant || message.from;
    const pushName = message.sender?.pushname || message.sender?.name;
    if (pushName && pushName !== participantId?.split('@')[0]) {
      sender = pushName;
    } else {
      const resolved = await resolveGroupSenderName(participantId);
      if (resolved) sender = resolved;
    }
  }
  const body = extractMessageBody(message);
  const timestamp = new Date((message.timestamp || Date.now() / 1000) * 1000);
  const mediaType = message.type && message.type !== 'text' ? message.type : null;
  const mediaUrl = typeof message.media?.url === 'string' && message.media.url ? message.media.url : null;
  const historical = isHistorical(timestamp);
  const quoted = extractQuotedMessage(message);

  // Real-time triggers are skipped for historical replays.
  if (!historical) {
    broadcastWhatsAppEvent('message.received', { chatId: from, sender, body, timestamp, ...quoted });
  }
  AuditService.record('MESSAGE_RECEIVED', 'MESSAGE', null, {
    chatId: from, sender, bodyLength: body.length, mediaType, isHistorical: historical,
  }).catch(() => {});
  await upsertContactFromMessage(from, message, contact, { skipUnreadIncrement: historical });
  emitInboundEvents(from, sender, body, messageId ?? undefined, timestamp);
  messageBuffer.push({ chatId: from, sender, body, timestamp, wahaMessageId: messageId, isHistorical: historical, mediaType, mediaUrl, ...quoted });
}

/**
 * Core webhook payload processor (framework-agnostic). Parses any of the
 * tolerated payload shapes and fans the messages out to ingest processing.
 */
export async function processWebhookPayload(body: any): Promise<void> {
  // WA Engine Pro primary format: { event: "message.received", data: { message, contact } }
  if (body.event === 'message.received') {
    const data = body.data || body;
    const message = data.message || body.message;
    if (message) {
      await processInboundMessage(message, data.contact || body.contact);
      return;
    }
  }

  // Thundering herd: batch payloads array
  if (Array.isArray(body.payloads)) {
    let processed = 0;
    for (const p of body.payloads) {
      const message = p.message || p.data?.message || p.payload;
      if (message) {
        await processInboundMessage(message, p.contact || p.data?.contact);
        processed++;
      }
    }
    logger.info({ total: body.payloads.length, processed }, 'Thundering herd batch processed');
    return;
  }

  // Legacy WAHA format { event: "message", payload: {...} } — tolerated for
  // relay replay during migration.
  if (body.event === 'message' && body.payload) {
    await processInboundMessage(body.payload);
    return;
  }

  // Legacy flat format { currentMessage: {...} } — tolerated during migration.
  if (body.currentMessage) {
    const { from: f, senderName, senderPushname, body: b, timestamp: ts, fromMe } = body.currentMessage;
    const from = toChatId(f, body.currentMessage);
    const sender = fromMe ? 'Founder' : (senderName || senderPushname || f);
    const msgBody = b || '[Media/System Message]';
    const timestamp = new Date(ts || Date.now());
    if (!fromMe) {
      const group = isGroupChat(from);
      await StorageRepository.upsertContact({
        chatId: from,
        name: group ? from : sender,
        pushName: group ? null : (senderPushname || senderName || null),
        phoneNumber: extractPhoneNumber(from),
        isGroup: group,
        lastMessageAt: timestamp,
        lastMessageBody: msgBody,
        hasInbound: true,
      });
      emitInboundEvents(from, sender, msgBody, undefined, timestamp);
      messageBuffer.push({ chatId: from, sender, body: msgBody, timestamp, isHistorical: isHistorical(timestamp) });
    }
    return;
  }

  // Legacy WhatsApp Cloud / WhatsJet format — tolerated during migration.
  if (body.message && body.contact) {
    const message = body.message;
    const contact = body.contact;
    const whatsapp_webhook_payload = body.whatsapp_webhook_payload;

    const phone = contact.phone_number || contact.wa_id || (whatsapp_webhook_payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.from);

    const from = contact.uid || contact.contact_uid || (phone ? `${phone}@c.us` : 'unknown');

    const sender = message.direction === 'outbound' ? 'Founder' : (contact.full_name || contact.first_name || phone || 'Client');
    const msgBody = message.body || message.message_body || '[Media/System Message]';

    const rawTimestamp = whatsapp_webhook_payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.timestamp;
    const timestamp = rawTimestamp ? new Date(parseInt(rawTimestamp) * 1000) : new Date();

    if (message.direction !== 'outbound') {
      const group = isGroupChat(from);
      await StorageRepository.upsertContact({
        chatId: from,
        name: group ? from : sender,
        pushName: group ? null : (contact.pushname || contact.first_name || null),
        phoneNumber: phone || extractPhoneNumber(from),
        isGroup: group,
        lastMessageAt: timestamp,
        lastMessageBody: msgBody,
        hasInbound: true,
      });
      emitInboundEvents(from, sender, msgBody, undefined, timestamp);
      messageBuffer.push({ chatId: from, sender, body: msgBody, timestamp, isHistorical: isHistorical(timestamp) });
    }
    return;
  }

  logger.warn({ body: body }, 'Received unrecognized WhatsApp webhook payload format');
}

export class WhatsAppController {
  /**
   * Endpoint to receive message webhook updates from WA Engine Pro.
   *
   * Returns 200 OK immediately — before any parsing, validation, or DB work — so
   * WA Engine Pro never enters its timeout-and-retry loop. All processing happens
   * in the background, writes are batched through the message buffer, and
   * replayed duplicates are discarded by the DB's ON CONFLICT DO NOTHING.
   */
  static async handleWebhook(req: Request, res: Response) {
    res.status(200).json({ success: true });

    void processWebhookPayload(req.body).catch((error: any) => {
      logger.error({ error: error.message }, 'Error processing WhatsApp webhook');
    });
  }
}
export default WhatsAppController;
