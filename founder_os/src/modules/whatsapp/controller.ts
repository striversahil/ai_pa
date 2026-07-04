import { Request, Response } from 'express';
import { WhatsAppService } from './service';
import { logger } from '../../shared/logger';

export class WhatsAppController {
  /**
   * Endpoint to receive message webhook updates from the whatsapp-web.js client
   */
  static async handleWebhook(req: Request, res: Response) {
    try {
      const { currentMessage } = req.body;

      if (!currentMessage) {
        logger.warn('Received webhook with missing currentMessage payload');
        res.status(400).json({ error: 'Missing currentMessage in request body' });
        return;
      }

      const { from, senderName, senderPushname, body, timestamp, fromMe } = currentMessage;

      // Extract sender label: use saved name, push name, or contact id
      let sender = senderName || senderPushname || from;
      if (fromMe) {
        sender = 'Founder';
      }

      await WhatsAppService.saveMessage({
        chatId: from,
        sender,
        body: body || '[Media/System Message]',
        timestamp: new Date(timestamp),
      });

      res.status(200).json({ success: true });
    } catch (error: any) {
      logger.error({ error: error.message }, 'Error handling WhatsApp webhook');
      res.status(500).json({ error: 'Internal Server Error' });
    }
  }
}
export default WhatsAppController;
