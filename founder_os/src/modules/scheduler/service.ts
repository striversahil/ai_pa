import cron from 'node-cron';
import { DigestService } from '../digest/service';
import { EmailService } from '../email/service';
import { AIService } from '../ai/service';
import { StorageRepository } from '../storage/repository';
import { logger } from '../../shared/logger';

export class SchedulerService {
  /**
   * Initializes all cron schedules
   */
  static init() {
    logger.info('SchedulerService: initializing scheduled jobs');

    // 1. WhatsApp processing - runs every 15 minutes
    cron.schedule('*/15 * * * *', async () => {
      logger.info('Cron: Running WhatsApp digest job...');
      try {
        await DigestService.processMessagesToDigests();
      } catch (error: any) {
        logger.error({ error: error.message }, 'Cron Error: WhatsApp digest job failed');
      }
    });

    // 2. Email syncing - runs every 30 minutes
    cron.schedule('*/30 * * * *', async () => {
      logger.info('Cron: Running Email sync job...');
      try {
        await EmailService.syncEmails();
      } catch (error: any) {
        logger.error({ error: error.message }, 'Cron Error: Email sync job failed');
      }
    });

    // 3. Morning Founder Briefing - runs daily at 8:00 AM
    cron.schedule('0 8 * * *', async () => {
      logger.info('Cron: Running morning Founder Briefing job...');
      try {
        await SchedulerService.generateAndSaveMorningBrief();
      } catch (error: any) {
        logger.error({ error: error.message }, 'Cron Error: Morning briefing job failed');
      }
    });

    // 4. Evening EOD Summary - runs daily at 7:00 PM
    cron.schedule('0 19 * * *', async () => {
      logger.info('Cron: Running evening EOD Summary job...');
      try {
        await SchedulerService.generateAndSaveEveningSummary();
      } catch (error: any) {
        logger.error({ error: error.message }, 'Cron Error: Evening EOD summary job failed');
      }
    });

    logger.info('SchedulerService: all scheduled cron tasks successfully started');
  }

  /**
   * Orchestrates gathering context and generating the morning briefing
   */
  static async generateAndSaveMorningBrief(): Promise<string> {
    logger.info('SchedulerService: generating morning brief');

    // Gather meetings (placeholder for now)
    const meetings = 'No calendar meetings integration configured yet.';

    // Gather WhatsApp digests
    const digests = await StorageRepository.fetchDigests(15);
    const whatsappContext = digests.length > 0
      ? digests
          .map((d) => `- [${d.priority.toUpperCase()}] Chat: "${d.chatName}" (Category: ${d.category}) Summary: ${d.summary}`)
          .join('\n')
      : 'No recent chat digests found.';

    // Gather emails
    const unreadEmails = await EmailService.fetchUnread();
    const emailContext = unreadEmails.length > 0
      ? unreadEmails
          .map((e) => `- From: ${e.sender} | Subject: "${e.subject}" | Body Preview: ${e.body.substring(0, 80)}...`)
          .join('\n')
      : 'No new/unread emails.';

    // Gather pending tasks
    const tasks = await StorageRepository.fetchTasks();
    const activeTasks = tasks.filter((t) => t.status === 'PENDING' || t.status === 'IN_PROGRESS');
    const tasksContext = activeTasks.length > 0
      ? activeTasks
          .map((t) => `- Task: "${t.title}" | Owner: ${t.owner} | Source: ${t.source} | Deadline: ${t.deadline ? t.deadline.toISOString().split('T')[0] : 'None'}`)
          .join('\n')
      : 'No pending tasks in queue.';

    // Invoke AI module
    const briefMarkdown = await AIService.generateFounderBrief({
      meetings,
      whatsappDigests: whatsappContext,
      unreadEmails: emailContext,
      pendingTasks: tasksContext,
    });

    // Save briefing to database
    await StorageRepository.saveFounderNote(briefMarkdown);
    logger.info('SchedulerService: successfully saved morning brief');

    return briefMarkdown;
  }

  /**
   * Orchestrates gathering context and generating the evening EOD summary
   */
  static async generateAndSaveEveningSummary(): Promise<string> {
    logger.info('SchedulerService: generating daily EOD summary');

    // Count unprocessed/processed messages today (simple simulation based on database size)
    const unprocessedCount = (await StorageRepository.fetchUnprocessedMessages()).length;
    const digests = await StorageRepository.fetchDigests(10);
    const messagesCount = digests.length * 5 + unprocessedCount; // simulated count

    // Important conversations today
    const importantDigests = digests.filter((d) => d.priority === 'high' || d.priority === 'urgent');
    const importantConversations = importantDigests.length > 0
      ? importantDigests
          .map((d) => `- [${d.priority.toUpperCase()}] "${d.chatName}": ${d.summary}`)
          .join('\n')
      : 'No high-priority chats processed today.';

    // Tasks created today
    const tasks = await StorageRepository.fetchTasks();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayTasks = tasks.filter((t) => new Date(t.createdAt) >= today);
    const tasksCreated = todayTasks.length > 0
      ? todayTasks.map((t) => `- "${t.title}" (Assigned: ${t.owner})`).join('\n')
      : 'No new tasks created today.';

    // Pending approvals/action items
    const pendingTasks = tasks.filter((t) => t.status === 'PENDING');
    const pendingApprovals = pendingTasks.length > 0
      ? pendingTasks.map((t) => `- "${t.title}" from source: ${t.source}`).join('\n')
      : 'No pending items.';

    // Invoke AI module
    const summaryMarkdown = await AIService.generateDailySummary({
      messagesCount,
      importantConversations,
      tasksCreated,
      pendingApprovals,
    });

    // Save EOD summary to database
    await StorageRepository.saveFounderNote(summaryMarkdown);
    logger.info('SchedulerService: successfully saved evening EOD summary');

    return summaryMarkdown;
  }
}
export default SchedulerService;
