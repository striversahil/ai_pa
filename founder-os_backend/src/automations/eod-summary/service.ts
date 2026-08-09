import { AIService } from '../../modules/ai/service';
import { StorageRepository } from '../../modules/storage/repository';
import { EngineRegistry } from '../../shared/engine';
import { logger } from '../../shared/logger';
import { kolkataDayStartUtc } from '../../shared/ist-time';

export async function generateAndSaveEveningSummary(): Promise<string> {
  logger.info('SchedulerService: generating daily EOD summary');

  const whatsappEng = EngineRegistry.get('whatsapp');
  const whatsappContext = whatsappEng ? await whatsappEng.getEodContext() : 'No WhatsApp activity today.';

  const emailEng = EngineRegistry.get('email');
  const emailContext = emailEng ? await emailEng.getEodContext() : 'No email activity today.';

  const zohoEng = EngineRegistry.get('sales_copilot');
  const zohoContext = zohoEng ? await zohoEng.getEodContext() : '';

  const unprocessedCount = (await StorageRepository.fetchUnprocessedMessages()).length;
  const digests = await StorageRepository.fetchDigests(10);
  const messagesCount = digests.length * 5 + unprocessedCount;

  const importantConversations = [whatsappContext, emailContext, zohoContext]
    .filter(Boolean)
    .join('\n\n');

  const tasks = await StorageRepository.fetchTasks();
  const today = kolkataDayStartUtc(new Date());
  const todayTasks = tasks.filter((t) => new Date(t.createdAt) >= today);
  const tasksCreated = todayTasks.length > 0
    ? todayTasks.map((t) => `- "${t.title}" (Assigned: ${t.owner})`).join('\n')
    : 'No new tasks created today.';

  const pendingTasks = tasks.filter((t) => t.status === 'PENDING');
  const pendingApprovals = pendingTasks.length > 0
    ? pendingTasks.map((t) => `- "${t.title}" from source: ${t.source}`).join('\n')
    : 'No pending items.';

  const summaryMarkdown = await AIService.generateDailySummary({
    messagesCount,
    importantConversations,
    tasksCreated,
    pendingApprovals,
  });

  await StorageRepository.saveFounderNote(summaryMarkdown);
  logger.info('SchedulerService: successfully saved evening EOD summary');

  return summaryMarkdown;
}
