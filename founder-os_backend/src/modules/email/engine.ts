import { AnalysisEngine } from '../../shared/engine';
import { EmailService } from './service';

export class EmailEngine implements AnalysisEngine {
  public name = 'Email Sync Engine';

  public async runSync() {
    return EmailService.syncEmails();
  }

  public async getBriefingContext(): Promise<string> {
    const unreadEmails = await EmailService.fetchUnread();
    return unreadEmails.length > 0
      ? unreadEmails
          .map((e) => `- From: ${e.sender} | Subject: "${e.subject}" | Body Preview: ${e.body.substring(0, 80)}...`)
          .join('\n')
      : 'No new/unread emails.';
  }

  public async getEodContext(): Promise<string> {
    const unreadEmails = await EmailService.fetchUnread();
    return `Email sync status: ${unreadEmails.length} unread emails currently in inbox.`;
  }
}
