import { WhatsAppService } from '../../modules/whatsapp/service';
import { AIService } from '../../modules/ai/service';
import { StorageRepository } from '../../modules/storage/repository';
import { TasksService } from '../../modules/tasks/service';
import { logger } from '../../shared/logger';

/**
 * The WhatsApp digest batch job — owned by this automation.
 * Fetches all unprocessed messages, groups by chat, and summarizes each chat
 * via the AI module. Uses incremental summarization when a previous digest
 * exists for a chat. Extracted action items become tasks; processed messages
 * are then marked processed.
 */
export async function processMessagesToDigests(): Promise<{
  processedChatsCount: number;
  failedChatsCount: number;
  tasksCreatedCount: number;
}> {
  logger.info('WhatsAppDigest: starting message digest job');

  const messages = await WhatsAppService.fetchUnprocessedMessages();
  if (messages.length === 0) {
    logger.info('WhatsAppDigest: no unprocessed messages found. Exiting job.');
    return { processedChatsCount: 0, failedChatsCount: 0, tasksCreatedCount: 0 };
  }

  logger.info({ messageCount: messages.length }, 'WhatsAppDigest: fetched unprocessed messages');

  const chatsMap = new Map<string, typeof messages>();
  for (const msg of messages) {
    const chatList = chatsMap.get(msg.chatId) || [];
    chatList.push(msg);
    chatsMap.set(msg.chatId, chatList);
  }

  let processedChatsCount = 0;
  let failedChatsCount = 0;
  let tasksCreatedCount = 0;

  for (const [chatId, chatMessages] of chatsMap.entries()) {
    const sampleMsg = chatMessages[0];
    const chatName = sampleMsg.sender || chatId;

    logger.info({ chatId, chatName, msgCount: chatMessages.length }, 'WhatsAppDigest: processing chat group');

    try {
      const previousDigest = await StorageRepository.fetchLatestDigestByChatId(chatId);

      let summaryResult: any;
      if (previousDigest) {
        logger.info({ chatId }, 'WhatsAppDigest: previous digest found, using incremental summarization');
        const previousActionItemsStr = JSON.stringify(previousDigest.suggestedReply
          ? [{ task: previousDigest.summary.substring(0, 100) }]
          : []
        );
        summaryResult = await AIService.incrementalSummarizeConversation(
          chatName,
          chatMessages.map((m) => ({
            sender: m.sender,
            body: m.body,
            timestamp: m.timestamp,
          })),
          previousDigest.summary,
          previousDigest.priority,
          previousActionItemsStr,
        );
      } else {
        logger.info({ chatId }, 'WhatsAppDigest: no previous digest, full summarization');
        summaryResult = await AIService.summarizeConversation(
          chatName,
          chatMessages.map((m) => ({
            sender: m.sender,
            body: m.body,
            timestamp: m.timestamp,
          }))
        );
      }

      const digest = await StorageRepository.saveDigest({
        chatId,
        chatName: summaryResult.chatName || chatName,
        summary: summaryResult.summary,
        priority: summaryResult.priority,
        category: summaryResult.category,
        sentiment: summaryResult.sentiment,
        requiresFounder: summaryResult.requires_founder,
        suggestedReply: summaryResult.suggested_reply || undefined,
      });

      // Per-chat "Pending From Me" ledger: persist every item the founder owes
      // in this conversation so nothing slips through. A single chat can have
      // multiple open items. Items are auto-resolved when the founder sends a
      // message in the chat (see whatsapp-proxy send route).
      if (summaryResult.pending_from_founder && summaryResult.pending_from_founder.length > 0) {
        logger.info(
          { pendingCount: summaryResult.pending_from_founder.length },
          'WhatsAppDigest: saving pending-from-founder items'
        );
        for (const item of summaryResult.pending_from_founder) {
          if (!item.description) continue;
          let dueDate: Date | null = null;
          if (item.due_date) {
            const parsedDate = new Date(item.due_date);
            if (!isNaN(parsedDate.getTime())) {
              dueDate = parsedDate;
            }
          }
          await StorageRepository.createChatPendingItem({
            chatId,
            chatName: summaryResult.chatName || chatName,
            description: item.description,
            dueDate,
          });
        }
      }

      if (summaryResult.action_items && summaryResult.action_items.length > 0) {
        logger.info(
          { actionItemsCount: summaryResult.action_items.length },
          'WhatsAppDigest: creating extracted tasks'
        );
        for (const item of summaryResult.action_items) {
          if (!item.task) continue;

          let deadlineDate: Date | null = null;
          if (item.deadline) {
            const parsedDate = new Date(item.deadline);
            if (!isNaN(parsedDate.getTime())) {
              deadlineDate = parsedDate;
            }
          }

          await TasksService.createTask({
            title: item.task,
            owner: item.owner || 'Founder',
            status: 'PENDING',
            deadline: deadlineDate,
            source: 'WHATSAPP',
            sourceId: digest.id,
          });
          tasksCreatedCount++;
        }
      }

      const messageIds = chatMessages.map((m) => m.id);
      await WhatsAppService.markProcessed(messageIds);

      processedChatsCount++;
      logger.info({ chatId }, 'WhatsAppDigest: successfully processed chat group');
    } catch (err: any) {
      failedChatsCount++;
      logger.error(
        { chatId, error: err.message },
        'WhatsAppDigest: failed to process chat. Continuing with next chat.'
      );
    }
  }

  logger.info(
    { processedChatsCount, failedChatsCount, tasksCreatedCount },
    'WhatsAppDigest: message digest job complete'
  );

  return { processedChatsCount, failedChatsCount, tasksCreatedCount };
}
