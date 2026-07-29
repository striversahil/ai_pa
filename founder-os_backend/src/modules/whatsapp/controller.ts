import { Request, Response } from 'express';
import { WhatsAppService } from './service';
import { logger } from '../../shared/logger';
import { broadcastWhatsAppEvent } from '../../shared/sse';

export class WhatsAppController {
  /**
   * Endpoint to receive message webhook updates from the whatsapp-web.js client
   */
  static async handleWebhook(req: Request, res: Response) {
    try {
      logger.info({ body: req.body }, 'WhatsAppController: received webhook payload');

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
        
        // Prefer contact.uid to match frontend selections, fall back to phone string
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
