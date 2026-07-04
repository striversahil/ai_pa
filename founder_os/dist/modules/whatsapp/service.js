"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WhatsAppService = void 0;
const repository_1 = require("../storage/repository");
const logger_1 = require("../../shared/logger");
class WhatsAppService {
    /**
     * Save a newly received WhatsApp message
     */
    static async saveMessage(data) {
        logger_1.logger.debug({ chatId: data.chatId, sender: data.sender }, 'WhatsAppService: saving message');
        return repository_1.StorageRepository.saveMessage(data);
    }
    /**
     * Fetch WhatsApp messages that have not yet been batched into a digest
     */
    static async fetchUnprocessedMessages() {
        logger_1.logger.debug('WhatsAppService: fetching unprocessed messages');
        return repository_1.StorageRepository.fetchUnprocessedMessages();
    }
    /**
     * Mark a list of messages as processed
     */
    static async markProcessed(messageIds) {
        logger_1.logger.debug({ count: messageIds.length }, 'WhatsAppService: marking messages as processed');
        return repository_1.StorageRepository.markMessagesProcessed(messageIds);
    }
    /**
     * Fetch messages for a specific chat ID
     */
    static async fetchMessagesByChatId(chatId) {
        logger_1.logger.debug({ chatId }, 'WhatsAppService: fetching messages for chat');
        return repository_1.StorageRepository.fetchMessagesByChatId(chatId);
    }
}
exports.WhatsAppService = WhatsAppService;
exports.default = WhatsAppService;
