import { AIService } from '../../modules/ai/service';
import { StorageRepository } from '../../modules/storage/repository';
import { EngineRegistry } from '../../shared/engine';
import { logger } from '../../shared/logger';

export async function generateAndSaveMorningBrief(): Promise<string> {
  logger.info('SchedulerService: generating morning brief');

  const meetings = 'No calendar meetings integration configured yet.';

  const whatsappEng = EngineRegistry.get('whatsapp');
  const whatsappContext = whatsappEng ? await whatsappEng.getBriefingContext() : 'No WhatsApp digests found.';

  const emailEng = EngineRegistry.get('email');
  const emailContext = emailEng ? await emailEng.getBriefingContext() : 'No unread emails.';

  const zohoEng = EngineRegistry.get('sales_copilot');
  const zohoContext = zohoEng ? await zohoEng.getBriefingContext() : '';

  const combinedEmailAndZohoContext = zohoContext
    ? `${emailContext}\n\n${zohoContext}`
    : emailContext;

  const tasks = await StorageRepository.fetchTasks();
  const activeTasks = tasks.filter((t) => t.status === 'PENDING' || t.status === 'IN_PROGRESS');
  const tasksContext = activeTasks.length > 0
    ? activeTasks
        .map((t) => `- Task: "${t.title}" | Owner: ${t.owner} | Source: ${t.source} | Deadline: ${t.deadline ? t.deadline.toISOString().split('T')[0] : 'None'}`)
        .join('\n')
    : 'No pending tasks in queue.';

  const briefMarkdown = await AIService.generateFounderBrief({
    meetings,
    whatsappDigests: whatsappContext,
    unreadEmails: combinedEmailAndZohoContext,
    pendingTasks: tasksContext,
  });

  await StorageRepository.saveFounderNote(briefMarkdown);
  logger.info('SchedulerService: successfully saved morning brief');

  return briefMarkdown;
}
