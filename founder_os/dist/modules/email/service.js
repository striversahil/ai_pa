"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EmailService = exports.MockEmailProvider = void 0;
const repository_1 = require("../storage/repository");
const logger_1 = require("../../shared/logger");
// In-Memory / Mock Email Provider implementation
class MockEmailProvider {
    async fetchUnreadEmails() {
        logger_1.logger.debug('MockEmailProvider: checking for new emails');
        // Simulate finding mock emails
        return [
            {
                subject: 'Urgent: Feedback on Q3 slide deck',
                sender: 'investor-rahul@vcpartner.com',
                body: 'Hi Sahil, could you please review the Q3 slide deck and send over the revised valuations by tonight? Thanks!',
            },
            {
                subject: 'Weekly Team Update & Standup',
                sender: 'operations@startup.com',
                body: 'Hey team, here is the agenda for tomorrow morning\'s sync. Let me know if you want to add anything.',
            },
        ];
    }
}
exports.MockEmailProvider = MockEmailProvider;
class EmailService {
    static provider = new MockEmailProvider();
    /**
     * Swap out the active provider if needed (e.g. Gmail IMAP or MS Graph)
     */
    static setProvider(newProvider) {
        this.provider = newProvider;
    }
    /**
     * Syncs new emails from the provider and saves them to the database
     */
    static async syncEmails() {
        logger_1.logger.info('EmailService: starting email sync job');
        try {
            const newEmails = await this.provider.fetchUnreadEmails();
            logger_1.logger.info({ count: newEmails.length }, 'EmailService: retrieved unread emails');
            let savedCount = 0;
            for (const email of newEmails) {
                await repository_1.StorageRepository.storeEmail({
                    subject: email.subject,
                    sender: email.sender,
                    body: email.body,
                });
                savedCount++;
            }
            return savedCount;
        }
        catch (error) {
            logger_1.logger.error({ error: error.message }, 'EmailService: sync failed');
            throw error;
        }
    }
    /**
     * Fetch unread emails stored in database
     */
    static async fetchUnread() {
        logger_1.logger.debug('EmailService: fetching unprocessed emails from storage');
        return repository_1.StorageRepository.fetchUnprocessedEmails();
    }
    /**
     * Mark emails as processed
     */
    static async markProcessed(emailIds) {
        logger_1.logger.debug({ count: emailIds.length }, 'EmailService: marking emails processed');
        return repository_1.StorageRepository.markEmailsProcessed(emailIds);
    }
}
exports.EmailService = EmailService;
exports.default = EmailService;
