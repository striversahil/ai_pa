import { WhatsAppService } from '../whatsapp/service';
import { AIService } from '../ai/service';
import { StorageRepository } from '../storage/repository';
import { TasksService } from '../tasks/service';
import { logger } from '../../shared/logger';

export class DigestService {
  /**
   * Run the message digesting batch job.
   * Fetches all unprocessed messages, groups by chat, and processes them in batches via the AI module.
   * Uses incremental summarization when a previous digest exists for a chat.
   */
  static async processMessagesToDigests(): Promise<{
    processedChatsCount: number;
    failedChatsCount: number;
    tasksCreatedCount: number;
  }> {
    logger.info('DigestService: starting message digest job');

    // 1. Fetch all unprocessed messages
    const messages = await WhatsAppService.fetchUnprocessedMessages();
    if (messages.length === 0) {
      logger.info('DigestService: no unprocessed messages found. Exiting job.');
      return { processedChatsCount: 0, failedChatsCount: 0, tasksCreatedCount: 0 };
    }

    logger.info({ messageCount: messages.length }, 'DigestService: fetched unprocessed messages');

    // 2. Group messages by chatId
    const chatsMap = new Map<string, typeof messages>();
    for (const msg of messages) {
      const chatList = chatsMap.get(msg.chatId) || [];
      chatList.push(msg);
      chatsMap.set(msg.chatId, chatList);
    }

    let processedChatsCount = 0;
    let failedChatsCount = 0;
    let tasksCreatedCount = 0;

    // 3. Process each chat group independently
    for (const [chatId, chatMessages] of chatsMap.entries()) {
      const sampleMsg = chatMessages[0];
      const chatName = sampleMsg.sender || chatId;

      logger.info({ chatId, chatName, msgCount: chatMessages.length }, 'DigestService: processing chat group');

      try {
        // Check if a previous digest exists for this chat (incremental mode)
        const previousDigest = await StorageRepository.fetchLatestDigestByChatId(chatId);

        let summaryResult: any;
        if (previousDigest) {
          logger.info({ chatId }, 'DigestService: previous digest found, using incremental summarization');
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
          logger.info({ chatId }, 'DigestService: no previous digest, full summarization');
          summaryResult = await AIService.summarizeConversation(
            chatName,
            chatMessages.map((m) => ({
              sender: m.sender,
              body: m.body,
              timestamp: m.timestamp,
            }))
          );
        }

        // 4. Save the digest record to database
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

        // 5. If action items exist, create tasks
        if (summaryResult.action_items && summaryResult.action_items.length > 0) {
          logger.info(
            { actionItemsCount: summaryResult.action_items.length },
            'DigestService: creating extracted tasks'
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

        // 6. Mark messages in this chat as processed
        const messageIds = chatMessages.map((m) => m.id);
        await WhatsAppService.markProcessed(messageIds);

        processedChatsCount++;
        logger.info({ chatId }, 'DigestService: successfully processed chat group');
      } catch (err: any) {
        failedChatsCount++;
        logger.error(
          { chatId, error: err.message },
          'DigestService: failed to process chat. Continuing with next chat.'
        );
      }
    }

    logger.info(
      { processedChatsCount, failedChatsCount, tasksCreatedCount },
      'DigestService: message digest job complete'
    );

    return { processedChatsCount, failedChatsCount, tasksCreatedCount };
  }

  /**
   * Retrieve all generated digests
   */
  static async fetchAllDigests() {
    logger.debug('DigestService: fetching all digests');
    return StorageRepository.fetchDigests();
  }
}
export default DigestService;
