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

// Fast-path dedup cache for WAHA replay storms. The DB ON CONFLICT DO NOTHING is
// the source of truth; this only avoids redundant contact/SSE/audit work.
const recentMessageIds = new Map<string, number>();
const RECENT_ID_CACHE_MAX = 10_000;

// WEBJS increasingly addresses individual chats by LID (@lid) instead of phone
// (@c.us). The rest of the system (sends, allowlist, message history) keys on
// @c.us, so LID chatIds are resolved to their @c.us form at ingestion. WAHA
// exposes the reverse mapping (LID -> @c.us); the map is cached per LID.
const lidToCusCache = new Map<string, string | null>();

// Contact/group-name lookups against WAHA are memoized (TTL 1h, including
// negative results) so the contacts/groups API is not hit on every message.
const contactNameCache = new Map<string, { name: string | null; at: number }>();
const CONTACT_NAME_CACHE_TTL_MS = 60 * 60 * 1000;

async function resolveLidToCus(chatId: string): Promise<string> {
  if (!chatId.endsWith('@lid')) return chatId;
  if (lidToCusCache.has(chatId)) return lidToCusCache.get(chatId) || chatId;
  try {
    const encoded = encodeURIComponent(chatId);
    const res = await fetch(`${config.WAHA_API_URL}/api/${config.WAHA_SESSION_NAME}/contacts/${encoded}`, {
      headers: { 'X-Api-Key': config.WAHA_API_KEY },
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const data = await res.json();
      const cus = data?.id || data?.chatId || null;
      if (cus && cus.endsWith('@c.us')) {
        lidToCusCache.set(chatId, cus);
        return cus;
      }
    }
  } catch (err: any) {
    logger.warn({ chatId, error: err.message }, 'Could not resolve LID to @c.us, keeping LID');
  }
  lidToCusCache.set(chatId, null);
  return chatId;
}

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

function extractMessageBody(payload: any): string {
  if (payload.body) return payload.body;
  if (payload.caption) return payload.caption;
  const typeLabels: Record<string, string> = {
    image: '[Image]',
    video: '[Video]',
    audio: '[Audio]',
    document: payload.filename ? `[Document: ${payload.filename}]` : '[Document]',
    location: '[Location]',
    poll: '[Poll]',
    sticker: '[Sticker]',
    contact: '[Contact Card]',
    buttons: '[Button Reply]',
    list: '[List Selection]',
  };
  return typeLabels[payload.type] || '[Media/System Message]';
}

// WAHA WEBJS exposes the replied-to message as payload.replyTo
// ({ id, participant, body, hasMedia, media }); other engines use quotedMsg.
// Returns quoted message metadata or empty fields when the message is not a reply.
function extractQuotedMessage(payload: any): { quotedMessageId: string | null; quotedBody: string | null; quotedSender: string | null } {
  const q = payload.replyTo || payload.quotedMsg || payload.quotedMessage;
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

// WAHA message id can arrive as a bare string or as a { id, fromMe, participant... }
// envelope — normalize both.
function extractWahaMessageId(payload: any): string | null {
  const raw = payload.id;
  if (!raw) return null;
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'object' && raw.id) return String(raw.id);
  return null;
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
  if (config.WAHA_API_URL) {
    for (const suffix of ['@c.us', '@lid']) {
      const resolved = await fetchContactNameFromWAHA(clean + suffix).catch(() => null);
      if (resolved) return resolved;
    }
  }
  return null;
}

function extractSenderName(payload: any): string {
  return payload.sender?.name || payload.sender?.pushname || payload.from?.split('@')[0] || 'Client';
}

function extractPushName(payload: any): string | null {
  return payload.sender?.pushname || payload.sender?.name || null;
}

function extractPhoneNumber(chatId: string): string {
  if (chatId.endsWith('@g.us')) return '';
  return chatId.replace(/@c\.us$/, '').replace(/[^0-9]/g, '');
}

function isGroupChat(chatId: string): boolean {
  return chatId.endsWith('@g.us');
}

async function fetchContactNameFromWAHA(chatId: string): Promise<string | null> {
  const cached = contactNameCache.get(chatId);
  if (cached && Date.now() - cached.at < CONTACT_NAME_CACHE_TTL_MS) return cached.name;
  let result: string | null = null;
  try {
    const encoded = encodeURIComponent(chatId);
    if (chatId.endsWith('@g.us')) {
      const res = await fetch(`${config.WAHA_API_URL}/api/${config.WAHA_SESSION_NAME}/groups/${encoded}`, {
        headers: { 'X-Api-Key': config.WAHA_API_KEY },
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const data = await res.json();
        result = data?.groupMetadata?.subject || null;
      }
    } else {
      const res = await fetch(`${config.WAHA_API_URL}/api/${config.WAHA_SESSION_NAME}/contacts/${encoded}`, {
        headers: { 'X-Api-Key': config.WAHA_API_KEY },
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const data = await res.json();
        const displayName = data?.name || data?.pushname || data?.shortName || null;
        if (displayName && displayName !== chatId.split('@')[0]) result = displayName;
      }
    }
  } catch {
    result = null;
  }
  contactNameCache.set(chatId, { name: result, at: Date.now() });
  return result;
}

async function upsertContactFromPayload(chatId: string, payload: any, opts: { skipUnreadIncrement?: boolean } = {}) {
  const group = isGroupChat(chatId);
  const pushName = extractPushName(payload);
  const phoneNumber = extractPhoneNumber(chatId);
  const senderName = extractSenderName(payload);
  let name = group ? chatId : senderName;

  const existing = await StorageRepository.fetchContactByChatId(chatId).catch(() => null);

  if (config.WAHA_API_URL) {
    const nameIsRawId = !existing || existing.name === chatId || existing.name === chatId.split('@')[0];
    if (nameIsRawId) {
      const resolved = await fetchContactNameFromWAHA(chatId);
      if (resolved) name = resolved;
    } else {
      name = existing.name;
    }
  }

  await StorageRepository.upsertContact({
    chatId,
    name,
    pushName: group ? null : pushName,
    phoneNumber,
    isGroup: group,
    lastMessageAt: new Date((payload.timestamp || 0) * 1000),
    lastMessageBody: extractMessageBody(payload),
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
function emitInboundEvents(chatId: string, sender: string, body: string, wahaMessageId: string | undefined, timestamp: Date) {
  const event = chatId.endsWith('@g.us') ? 'whatsapp.group.message' : 'whatsapp.message.inbound';
  AutomationEngine.trigger(event, {
    chatId,
    sender,
    body,
    wahaMessageId,
    timestamp: timestamp.toISOString(),
  }).catch((e: any) => {
    logger.error({ error: e.message }, 'Automation event emit failed');
  });
}

async function processWahaMessage(payload: any): Promise<void> {
  if (payload.fromMe) return;

  const wahaMessageId = extractWahaMessageId(payload);
  if (wahaMessageId && noteRecentMessageId(wahaMessageId)) {
    logger.debug({ wahaMessageId }, 'Duplicate webhook delivery (recent cache), skipping');
    return;
  }

  const fromRaw = payload.chatId || payload.from;
  const from = isGroupChat(fromRaw) ? fromRaw : await resolveLidToCus(fromRaw);
  const group = isGroupChat(from);
  let sender = extractSenderName(payload);
  if (group) {
    const participantId = payload.sender?.id || payload.participant || payload.from;
    const pushName = payload.sender?.pushname || payload.sender?.name;
    if (pushName && pushName !== participantId?.split('@')[0]) {
      sender = pushName;
    } else {
      const resolved = await resolveGroupSenderName(participantId);
      if (resolved) sender = resolved;
    }
  }
  const body = extractMessageBody(payload);
  const timestamp = new Date((payload.timestamp || 0) * 1000);
  const mediaType = payload.type !== 'text' ? payload.type : null;
  const historical = isHistorical(timestamp);
  const quoted = extractQuotedMessage(payload);

  // Real-time triggers are skipped for historical replays.
  if (!historical) {
    broadcastWhatsAppEvent('message.received', { chatId: from, sender, body, timestamp, ...quoted });
  }
  AuditService.record('MESSAGE_RECEIVED', 'MESSAGE', null, {
    chatId: from, sender, bodyLength: body.length, mediaType, isHistorical: historical,
  }).catch(() => {});
  await upsertContactFromPayload(from, payload, { skipUnreadIncrement: historical });
  emitInboundEvents(from, sender, body, wahaMessageId ?? undefined, timestamp);
  messageBuffer.push({ chatId: from, sender, body, timestamp, wahaMessageId, isHistorical: historical, mediaType, ...quoted });
}

export class WhatsAppController {
  /**
   * Endpoint to receive message webhook updates from the whatsapp-web.js client.
   *
   * Returns 200 OK immediately — before any parsing, validation, or DB work — so
   * WAHA never enters its timeout-and-retry loop. All processing happens in the
   * background, writes are batched through the message buffer, and replayed
   * duplicates are discarded by the DB's ON CONFLICT DO NOTHING.
   */
  static async handleWebhook(req: Request, res: Response) {
    res.status(200).json({ success: true });

    void (async () => {
      try {
        // WAHA webhook format
        if (req.body.event === 'message' && req.body.payload) {
          await processWahaMessage(req.body.payload);
          return;
        }

        // Thundering herd: batch payloads array from WAHA replay
        if (Array.isArray(req.body.payloads)) {
          let processed = 0;
          for (const p of req.body.payloads) {
            await processWahaMessage(p);
            processed++;
          }
          logger.info({ total: req.body.payloads.length, processed }, 'Thundering herd batch processed');
          return;
        }

        let from = '';
        let sender = 'Client';
        let body = '';
        let timestamp = new Date();

        if (req.body.currentMessage) {
          const { from: f, senderName, senderPushname, body: b, timestamp: ts, fromMe } = req.body.currentMessage;
          from = f;
          sender = fromMe ? 'Founder' : (senderName || senderPushname || f);
          body = b || '[Media/System Message]';
          timestamp = new Date(ts);
          if (!fromMe) {
            const group = isGroupChat(from);
            await StorageRepository.upsertContact({
              chatId: from,
              name: group ? from : sender,
              pushName: group ? null : (senderPushname || senderName || null),
              phoneNumber: extractPhoneNumber(from),
              isGroup: group,
              lastMessageAt: timestamp,
              lastMessageBody: body,
              hasInbound: true,
            });
          }
        } else if (req.body.message && req.body.contact) {
          const message = req.body.message;
          const contact = req.body.contact;
          const whatsapp_webhook_payload = req.body.whatsapp_webhook_payload;

          const phone = contact.phone_number || contact.wa_id || (whatsapp_webhook_payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.from);

          from = contact.uid || contact.contact_uid || (phone ? `${phone}@c.us` : 'unknown');

          sender = message.direction === 'outbound' ? 'Founder' : (contact.full_name || contact.first_name || phone || 'Client');
          body = message.body || message.message_body || '[Media/System Message]';

          const rawTimestamp = whatsapp_webhook_payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.timestamp;
          timestamp = rawTimestamp ? new Date(parseInt(rawTimestamp) * 1000) : new Date();

          if (message.direction !== 'outbound') {
            const group = isGroupChat(from);
            await StorageRepository.upsertContact({
              chatId: from,
              name: group ? from : sender,
              pushName: group ? null : (contact.pushname || contact.first_name || null),
              phoneNumber: phone || extractPhoneNumber(from),
              isGroup: group,
              lastMessageAt: timestamp,
              lastMessageBody: body,
              hasInbound: true,
            });
          }
        } else if (req.body.event === 'message.received' || req.body.event === 'message.sent' || req.body.event === 'message.delivered') {
          const message = req.body.data?.message;
          const contact = req.body.data?.contact;
          if (!message) {
            logger.warn({ body: req.body }, 'Received WhatsJet event with missing message properties');
            return;
          }
          from = contact?.uid || contact?.contact_uid || (contact?.wa_id ? `${contact.wa_id}@c.us` : (message.from_phone_number ? `${message.from_phone_number}@c.us` : 'unknown'));
          sender = message.direction === 'outbound' ? 'Founder' : (contact?.full_name || contact?.first_name || from);
          body = message.message_body || '[Media/System Message]';
          timestamp = message.created_at ? new Date(message.created_at) : new Date();

          if (message.direction !== 'outbound') {
            const group = isGroupChat(from);
            await StorageRepository.upsertContact({
              chatId: from,
              name: group ? from : sender,
              pushName: group ? null : (contact?.pushname || contact?.first_name || null),
              phoneNumber: contact?.wa_id || extractPhoneNumber(from),
              isGroup: group,
              lastMessageAt: timestamp,
              lastMessageBody: body,
              hasInbound: true,
            });
          }
        } else {
          logger.warn({ body: req.body }, 'Received unrecognized WhatsApp webhook payload format');
          return;
        }

        logger.info({ chatId: from, sender, body }, 'Saving WhatsApp message from webhook');
        const historical = isHistorical(timestamp);
        if (!historical) {
          broadcastWhatsAppEvent('message.received', {
            chatId: from,
            sender,
            body,
            timestamp,
          });
        }
        emitInboundEvents(from, sender, body, undefined, timestamp);
        messageBuffer.push({ chatId: from, sender, body, timestamp, isHistorical: historical });
      } catch (error: any) {
        logger.error({ error: error.message }, 'Error processing WhatsApp webhook');
      }
    })();
  }
}
export default WhatsAppController;
