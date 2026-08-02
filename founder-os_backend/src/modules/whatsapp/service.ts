import { StorageRepository } from '../storage/repository';
import { config } from '../../config';
import { logger } from '../../shared/logger';

interface WahaMessage {
  id: string;
  chatId: string;
  sender: string;
  body: string;
  timestamp: string;
  fromMe: boolean;
}

export class WhatsAppService {
  /**
   * Save a newly received WhatsApp message
   */
  static async saveMessage(data: {
    chatId: string;
    sender: string;
    body: string;
    timestamp: Date;
    wahaMessageId?: string | null;
    quotedMessageId?: string | null;
    quotedBody?: string | null;
    quotedSender?: string | null;
  }) {
    logger.debug({ chatId: data.chatId, sender: data.sender }, 'WhatsAppService: saving message');
    return StorageRepository.saveMessage(data);
  }

  /**
   * Fetch WhatsApp messages that have not yet been batched into a digest
   */
  static async fetchUnprocessedMessages() {
    logger.debug('WhatsAppService: fetching unprocessed messages');
    return StorageRepository.fetchUnprocessedMessages();
  }

  /**
   * Mark a list of messages as processed
   */
  static async markProcessed(messageIds: string[]) {
    logger.debug({ count: messageIds.length }, 'WhatsAppService: marking messages as processed');
    return StorageRepository.markMessagesProcessed(messageIds);
  }

  /**
   * Fetch messages for a specific chat ID from local storage
   */
  static async fetchMessagesByChatId(chatId: string) {
    logger.debug({ chatId }, 'WhatsAppService: fetching messages for chat');
    return StorageRepository.fetchMessagesByChatId(chatId);
  }

  /**
   * Fetch recent messages from WAHA API for a given chatId
   */
  static async fetchWahaMessages(chatId: string, limit = 50): Promise<WahaMessage[]> {
    try {
      const url = `${config.WAHA_API_URL}/api/${config.WAHA_SESSION_NAME}/messages?chatId=${encodeURIComponent(chatId)}&limit=${limit}&downloadMedia=false`;
      const res = await fetch(url, {
        headers: { 'X-Api-Key': config.WAHA_API_KEY },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        logger.warn({ status: res.status, chatId }, 'WAHA messages fetch returned non-ok');
        return [];
      }
      const data = await res.json() as any[];
      if (!Array.isArray(data)) return [];
      return data.map((m: any) => ({
        id: m.id || String(Math.random()),
        chatId: m.chatId || chatId,
        sender: m.fromMe ? 'You' : 'Client',
        body: m.body || '',
        timestamp: m.timestamp ? new Date(parseInt(m.timestamp) * 1000).toISOString() : new Date().toISOString(),
        fromMe: !!m.fromMe,
      }));
    } catch (e: any) {
      logger.warn({ error: e.message, chatId }, 'Failed to fetch messages from WAHA');
      return [];
    }
  }

  /**
   * Fetch all chats from WAHA to get contact names
   */
  static async fetchWahaChats(): Promise<{ id: string; name: string }[]> {
    try {
      const url = `${config.WAHA_API_URL}/api/${config.WAHA_SESSION_NAME}/chats`;
      const res = await fetch(url, {
        headers: { 'X-Api-Key': config.WAHA_API_KEY },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return [];
      const data = await res.json() as any[];
      if (!Array.isArray(data)) return [];
      return data.map((c: any) => ({
        id: c.id || '',
        name: c.name || c.id?.split('@')[0] || 'Unknown',
      })).filter(c => c.id);
    } catch (e: any) {
      logger.warn({ error: e.message }, 'Failed to fetch chats from WAHA');
      return [];
    }
  }
}
export default WhatsAppService;
