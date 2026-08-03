import cron from 'node-cron';
import { AIService } from '../ai/service';
import { StorageRepository } from '../storage/repository';
import { EngineRegistry } from '../../shared/engine';
import { logger } from '../../shared/logger';
import { kolkataDayStartUtc } from '../../shared/ist-time';

/**
 * Morning founder briefing and evening EOD summary generation. Owned by the
 * scheduler domain but kept here so the scheduler service stays a thin
 * registrar and every concern lives with the logic that produces it.
 */

export async function generateAndSaveMorningBrief(): Promise<string> {
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

export async function generateAndSaveEveningSummary(): Promise<string> {
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

  // Tasks created today (IST day boundary, not host-local)
  const tasks = await StorageRepository.fetchTasks();
  const today = kolkataDayStartUtc(new Date());
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

export function registerBriefingJobs() {
  // Morning Founder Briefing - runs daily at 8:00 AM
  cron.schedule('0 8 * * *', async () => {
    logger.info('Cron: Running morning Founder Briefing job...');
    try {
      await generateAndSaveMorningBrief();
    } catch (error: any) {
      logger.error({ error: error.message }, 'Cron Error: Morning briefing job failed');
    }
  }, { timezone: 'Asia/Kolkata' });

  // Evening EOD Summary - runs daily at 7:00 PM
  cron.schedule('0 19 * * *', async () => {
    logger.info('Cron: Running evening EOD Summary job...');
    try {
      await generateAndSaveEveningSummary();
    } catch (error: any) {
      logger.error({ error: error.message }, 'Cron Error: Evening EOD summary job failed');
    }
  }, { timezone: 'Asia/Kolkata' });
}
