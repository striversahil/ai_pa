import cron from 'node-cron';
import { DigestService } from '../digest/service';
import { EmailService } from '../email/service';
import { AIService } from '../ai/service';
import { StorageRepository } from '../storage/repository';
import { logger } from '../../shared/logger';
import { EngineRegistry, AnalysisEngine } from '../../shared/engine';
import { SalesCopilotService } from '../sales_copilot/service';
import { BrainService } from '../brain/service';
import { SLAChecker } from '../monitoring/sla-check';
import { NotificationBatcher } from '../whatsapp/batcher';
import { prisma } from '../../shared/prisma';
import { MessageQueueService } from '../queue/service';
import { config } from '../../config';

class WhatsappEngine implements AnalysisEngine {
  public name = 'WhatsApp Digest Engine';

  public async runSync() {
    return DigestService.processMessagesToDigests();
  }

  public async getBriefingContext(): Promise<string> {
    const digests = await StorageRepository.fetchDigests(15);
    return digests.length > 0
      ? digests
          .map((d) => `- [${d.priority.toUpperCase()}] Chat: "${d.chatName}" (Category: ${d.category}) Summary: ${d.summary}`)
          .join('\n')
      : 'No recent chat digests found.';
  }

  public async getEodContext(): Promise<string> {
    const unprocessedCount = (await StorageRepository.fetchUnprocessedMessages()).length;
    const digests = await StorageRepository.fetchDigests(10);
    const messagesCount = digests.length * 5 + unprocessedCount;
    const importantDigests = digests.filter((d) => d.priority === 'high' || d.priority === 'urgent');
    const importantConversations = importantDigests.length > 0
      ? importantDigests
          .map((d) => `- [${d.priority.toUpperCase()}] "${d.chatName}": ${d.summary}`)
          .join('\n')
      : 'No high-priority chats processed today.';
    return `WhatsApp Messages processed: ${messagesCount}\nKey conversations:\n${importantConversations}`;
  }
}

class EmailEngine implements AnalysisEngine {
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

export class SchedulerService {
  /**
   * Initializes all cron schedules
   */
  static init() {
    logger.info('SchedulerService: initializing scheduled jobs');

    // Register modular engines
    EngineRegistry.register('whatsapp', new WhatsappEngine());
    EngineRegistry.register('email', new EmailEngine());
    EngineRegistry.register('sales_copilot', new SalesCopilotService());
    EngineRegistry.register('brain', new BrainService());

    // 1. WhatsApp processing - runs every 5 minutes
    cron.schedule('*/5 * * * *', async () => {
      logger.info('Cron: Running WhatsApp digest job...');
      try {
        const eng = EngineRegistry.get('whatsapp');
        if (eng) await eng.runSync();
      } catch (error: any) {
        logger.error({ error: error.message }, 'Cron Error: WhatsApp digest job failed');
      }

      // Drain Redis queue and batch-classify messages (written to Redis RAM by webhook handler)
      try {
        await MessageQueueService.drainAndProcessBatch();
      } catch (error: any) {
        logger.error({ error: error.message }, 'Cron Error: Classification batch processing failed');
      }
    });

    // 2. Email & Zoho syncing - runs every 30 minutes
    cron.schedule('*/30 * * * *', async () => {
      logger.info('Cron: Running Email, Sales Copilot, and Brain index jobs...');
      try {
        const emailEng = EngineRegistry.get('email');
        if (emailEng) await emailEng.runSync();
      } catch (error: any) {
        logger.error({ error: error.message }, 'Cron Error: Email sync job failed');
      }

      try {
        const zohoEng = EngineRegistry.get('sales_copilot');
        if (zohoEng) await zohoEng.runSync();
      } catch (error: any) {
        logger.error({ error: error.message }, 'Cron Error: Sales Copilot sync job failed');
      }

      try {
        const brainEng = EngineRegistry.get('brain');
        if (brainEng) await brainEng.runSync();
      } catch (error: any) {
        logger.error({ error: error.message }, 'Cron Error: Brain indexing job failed');
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

    // 5. SLA Monitor - runs every minute
    cron.schedule('* * * * *', async () => {
      try {
        await SLAChecker.check();
      } catch (error: any) {
        logger.error({ error: error.message }, 'Cron Error: SLA check failed');
      }
    });

    // 6. Notification Batcher - flushes grouped alerts every 15 minutes
    cron.schedule('*/15 * * * *', async () => {
      try {
        await NotificationBatcher.flushAll();
      } catch (error: any) {
        logger.error({ error: error.message }, 'Cron Error: Notification batcher flush failed');
      }
    });

    // 7. Data retention - runs daily at 3:00 AM, deletes messages older than 90 days
    cron.schedule('0 3 * * *', async () => {
      logger.info('Cron: Running data retention cleanup...');
      try {
        const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
        let totalDeleted = 0;
        let batchDeleted = 0;

        do {
          const batch = await prisma.message.findMany({
            where: { createdAt: { lt: cutoff } },
            select: { id: true },
            take: 1000,
          });
          if (batch.length === 0) break;

          const ids = batch.map(b => b.id);
          const res = await prisma.message.deleteMany({ where: { id: { in: ids } } });
          batchDeleted = res.count;
          totalDeleted += batchDeleted;
        } while (batchDeleted > 0);

        logger.info({ totalDeleted }, 'Cleaned up messages older than 90 days');
      } catch (error: any) {
        logger.error({ error: error.message }, 'Cron Error: Data retention cleanup failed');
      }
    });

    // 8. WAHA session restart - runs daily at 4:00 AM (lowest activity period)
    // Avoids detection from 24/7 connection; session persists via mounted volume
    cron.schedule('0 4 * * *', async () => {
      logger.info('Cron: Restarting WAHA session for connection hygiene...');
      try {
        const response = await fetch(`${config.WAHA_API_URL}/api/sessions/${config.WAHA_SESSION_NAME}/logout`, {
          method: 'POST',
          headers: { 'X-Api-Key': config.WAHA_API_KEY },
        });
        if (response.ok) {
          logger.info('WAHA session logged out successfully');
        }
        await new Promise(r => setTimeout(r, 5000));
        const startRes = await fetch(`${config.WAHA_API_URL}/api/sessions/${config.WAHA_SESSION_NAME}/start`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Api-Key': config.WAHA_API_KEY },
        });
        if (startRes.ok) {
          logger.info('WAHA session restarted successfully');
        }
      } catch (error: any) {
        logger.error({ error: error.message }, 'Cron Error: WAHA restart failed');
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

    // Gather context from modules
    const whatsappEng = EngineRegistry.get('whatsapp');
    const whatsappContext = whatsappEng ? await whatsappEng.getBriefingContext() : 'No WhatsApp digests found.';

    const emailEng = EngineRegistry.get('email');
    const emailContext = emailEng ? await emailEng.getBriefingContext() : 'No unread emails.';

    const zohoEng = EngineRegistry.get('sales_copilot');
    const zohoContext = zohoEng ? await zohoEng.getBriefingContext() : '';

    const combinedEmailAndZohoContext = zohoContext 
      ? `${emailContext}\n\n${zohoContext}` 
      : emailContext;

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
      unreadEmails: combinedEmailAndZohoContext,
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

    // Gather context from modules
    const whatsappEng = EngineRegistry.get('whatsapp');
    const whatsappContext = whatsappEng ? await whatsappEng.getEodContext() : 'No WhatsApp activity today.';

    const emailEng = EngineRegistry.get('email');
    const emailContext = emailEng ? await emailEng.getEodContext() : 'No email activity today.';

    const zohoEng = EngineRegistry.get('sales_copilot');
    const zohoContext = zohoEng ? await zohoEng.getEodContext() : '';

    // Count unprocessed/processed messages today
    const unprocessedCount = (await StorageRepository.fetchUnprocessedMessages()).length;
    const digests = await StorageRepository.fetchDigests(10);
    const messagesCount = digests.length * 5 + unprocessedCount; // simulated count

    // Important conversations today
    const importantConversations = [whatsappContext, emailContext, zohoContext]
      .filter(Boolean)
      .join('\n\n');

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
