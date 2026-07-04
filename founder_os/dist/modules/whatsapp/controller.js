"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WhatsAppController = void 0;
const service_1 = require("./service");
const logger_1 = require("../../shared/logger");
class WhatsAppController {
    /**
     * Endpoint to receive message webhook updates from the whatsapp-web.js client
     */
    static async handleWebhook(req, res) {
        try {
            const { currentMessage } = req.body;
            if (!currentMessage) {
                logger_1.logger.warn('Received webhook with missing currentMessage payload');
                res.status(400).json({ error: 'Missing currentMessage in request body' });
                return;
            }
            const { from, senderName, senderPushname, body, timestamp, fromMe } = currentMessage;
            // Extract sender label: use saved name, push name, or contact id
            let sender = senderName || senderPushname || from;
            if (fromMe) {
                sender = 'Founder';
            }
            await service_1.WhatsAppService.saveMessage({
                chatId: from,
                sender,
                body: body || '[Media/System Message]',
                timestamp: new Date(timestamp),
            });
            res.status(200).json({ success: true });
        }
        catch (error) {
            logger_1.logger.error({ error: error.message }, 'Error handling WhatsApp webhook');
            res.status(500).json({ error: 'Internal Server Error' });
        }
    }
}
exports.WhatsAppController = WhatsAppController;
exports.default = WhatsAppController;
