import { Request, Response } from 'express';
import { WhatsAppService } from './service';
import { logger } from '../../shared/logger';
import { broadcastWhatsAppEvent } from '../../shared/sse';
import { MessageQueueService } from '../queue/service';
import { prisma, useInMemoryDb } from '../../shared/prisma';

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

function extractSenderName(payload: any): string {
  return payload.sender?.name || payload.sender?.pushname || payload.from?.split('@')[0] || 'Client';
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

export class WhatsAppController {
  /**
   * Endpoint to receive message webhook updates from the whatsapp-web.js client
   */
  static async handleWebhook(req: Request, res: Response) {
    try {
      logger.info({ body: req.body }, 'WhatsAppController: received webhook payload');

      // WAHA webhook format
      if (req.body.event === 'message' && req.body.payload) {
        const payload = req.body.payload;
        if (payload.fromMe) {
          res.status(200).json({ success: true });
          return;
        }

        const wahaMessageId = payload.id;
        if (wahaMessageId && !useInMemoryDb) {
          const existing = await prisma.message.findUnique({ where: { wahaMessageId } });
          if (existing) {
            logger.warn({ wahaMessageId }, 'Duplicate webhook delivery, skipping');
            res.status(200).json({ success: true, dedup: true });
            return;
          }
        }

        const from = payload.chatId || payload.from;
        const sender = extractSenderName(payload);
        const body = extractMessageBody(payload);
        const timestamp = new Date((payload.timestamp || 0) * 1000);
        const mediaType = payload.type !== 'text' ? payload.type : null;

        const saved = await WhatsAppService.saveMessage({ chatId: from, sender, body, timestamp, wahaMessageId });
        await MessageQueueService.enqueueClassification(saved.id, from, sender, body, timestamp, mediaType);
        broadcastWhatsAppEvent('message.received', { chatId: from, sender, body, timestamp });

        res.status(200).json({ success: true });
        return;
      }

      // Thundering herd: batch payloads array from WAHA replay
      if (Array.isArray(req.body.payloads)) {
        const BATCH_SIZE = 10;
        const batches = chunkArray(req.body.payloads, BATCH_SIZE);
        let savedCount = 0;

        for (const batch of batches) {
          const results = await Promise.allSettled(
            batch.map(async (p: any) => {
              if (p.fromMe) return null;

              const wahaMessageId = p.id;
              if (wahaMessageId && !useInMemoryDb) {
                const existing = await prisma.message.findUnique({ where: { wahaMessageId } });
                if (existing) return null;
              }

              const from = p.chatId || p.from;
              const sender = extractSenderName(p);
              const msgBody = extractMessageBody(p);
              const ts = new Date((p.timestamp || 0) * 1000);
              const mediaType = p.type !== 'text' ? p.type : null;

              const saved = await WhatsAppService.saveMessage({ chatId: from, sender, body: msgBody, timestamp: ts, wahaMessageId });
              await MessageQueueService.enqueueClassification(saved.id, from, sender, msgBody, ts, mediaType);
              broadcastWhatsAppEvent('message.received', { chatId: from, sender, body: msgBody, timestamp: ts });
              return saved;
            })
          );

          savedCount += results.filter(r => r.status === 'fulfilled' && r.value !== null).length;
          await new Promise(r => setTimeout(r, 100));
        }

        logger.info({ total: req.body.payloads.length, saved: savedCount }, 'Thundering herd batch processed');
        res.status(200).json({ success: true, saved: savedCount });
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
      } else if (req.body.event === 'message.received' || req.body.event === 'message.sent' || req.body.event === 'message.delivered') {
        const message = req.body.data?.message;
        const contact = req.body.data?.contact;
        if (!message) {
          logger.warn({ body: req.body }, 'Received WhatsJet event with missing message properties');
          res.status(400).json({ error: 'Missing message block in event data' });
          return;
        }
        from = contact?.uid || contact?.contact_uid || (contact?.wa_id ? `${contact.wa_id}@c.us` : (message.from_phone_number ? `${message.from_phone_number}@c.us` : 'unknown'));
        sender = message.direction === 'outbound' ? 'Founder' : (contact?.full_name || contact?.first_name || from);
        body = message.message_body || '[Media/System Message]';
        timestamp = message.created_at ? new Date(message.created_at) : new Date();
      } else {
        logger.warn({ body: req.body }, 'Received unrecognized WhatsApp webhook payload format');
        res.status(200).json({ success: true, message: 'Ignored unrecognized event format' });
        return;
      }

      logger.info({ chatId: from, sender, body }, 'Saving WhatsApp message from webhook');
      await WhatsAppService.saveMessage({
        chatId: from,
        sender,
        body,
        timestamp,
      });

      broadcastWhatsAppEvent('message.received', {
        chatId: from,
        sender,
        body,
        timestamp,
      });

      res.status(200).json({ success: true });
    } catch (error: any) {
      logger.error({ error: error.message }, 'Error handling WhatsApp webhook');
      res.status(500).json({ error: 'Internal Server Error' });
    }
  }
}
export default WhatsAppController;
