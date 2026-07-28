import { StorageRepository } from '../storage/repository';
import { logger } from '../../shared/logger';

// Provider interface abstraction
export interface EmailProvider {
  fetchUnreadEmails(): Promise<Array<{ subject: string; sender: string; body: string }>>;
}

// In-Memory / Mock Email Provider implementation
export class MockEmailProvider implements EmailProvider {
  async fetchUnreadEmails(): Promise<Array<{ subject: string; sender: string; body: string }>> {
    logger.debug('MockEmailProvider: checking for new emails');
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

export class EmailService {
  private static provider: EmailProvider = new MockEmailProvider();

  /**
   * Swap out the active provider if needed (e.g. Gmail IMAP or MS Graph)
   */
  static setProvider(newProvider: EmailProvider) {
    this.provider = newProvider;
  }

  /**
   * Syncs new emails from the provider and saves them to the database
   */
  static async syncEmails(): Promise<number> {
    logger.info('EmailService: starting email sync job');
    try {
      const newEmails = await this.provider.fetchUnreadEmails();
      logger.info({ count: newEmails.length }, 'EmailService: retrieved unread emails');

      let savedCount = 0;
      for (const email of newEmails) {
        await StorageRepository.storeEmail({
          subject: email.subject,
          sender: email.sender,
          body: email.body,
        });
        savedCount++;
      }
      return savedCount;
    } catch (error: any) {
      logger.error({ error: error.message }, 'EmailService: sync failed');
      throw error;
    }
  }

  /**
   * Fetch unread emails stored in database
   */
  static async fetchUnread() {
    logger.debug('EmailService: fetching unprocessed emails from storage');
    return StorageRepository.fetchUnprocessedEmails();
  }

  /**
   * Mark emails as processed
   */
  static async markProcessed(emailIds: string[]) {
    logger.debug({ count: emailIds.length }, 'EmailService: marking emails processed');
    return StorageRepository.markEmailsProcessed(emailIds);
  }
}
export default EmailService;
