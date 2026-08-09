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

  // Per-chat "Pending From Me" ledger: surface every open item the founder owes,
  // overdue items first, so nothing slips through. These are the "what I owe in
  // each conversation" items extracted by the WhatsApp digest automation.
  const openPending = await StorageRepository.fetchOpenChatPendingItems();
  const now = Date.now();
  const sortedPending = openPending.sort((a, b) => {
    const aOverdue = a.dueDate && new Date(a.dueDate).getTime() < now ? 0 : 1;
    const bOverdue = b.dueDate && new Date(b.dueDate).getTime() < now ? 0 : 1;
    if (aOverdue !== bOverdue) return aOverdue - bOverdue;
    const aDue = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
    const bDue = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
    return aDue - bDue;
  });
  const pendingFromFounderContext = sortedPending.length > 0
    ? sortedPending
        .map((item) => {
          const overdue = item.dueDate && new Date(item.dueDate).getTime() < now;
          const due = item.dueDate ? ` | Due: ${item.dueDate.toISOString().split('T')[0]}` : ' | Due: None';
          return `- [${item.chatName || item.chatId}] "${item.description}"${due}${overdue ? ' ⚠️ OVERDUE' : ''}`;
        })
        .join('\n')
    : 'No open items pending from your side. ✅';

  const briefMarkdown = await AIService.generateFounderBrief({
    meetings,
    whatsappDigests: whatsappContext,
    unreadEmails: combinedEmailAndZohoContext,
    pendingTasks: tasksContext,
    pendingFromFounder: pendingFromFounderContext,
  });

  await StorageRepository.saveFounderNote(briefMarkdown);
  logger.info('SchedulerService: successfully saved morning brief');

  return briefMarkdown;
}
