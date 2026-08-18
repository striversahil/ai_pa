import { StorageRepository } from '../storage/repository';
import { logger } from '../../shared/logger';

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
}
export default WhatsAppService;
