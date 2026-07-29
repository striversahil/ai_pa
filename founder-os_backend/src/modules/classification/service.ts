import { AIService } from '../ai/service';
import { WhatsAppService } from '../whatsapp/service';
import { StorageRepository } from '../storage/repository';
import { broadcastWhatsAppEvent } from '../../shared/sse';
import { heuristicClassify, ClassificationResult } from './heuristics';
import { logger } from '../../shared/logger';

export class ClassificationService {
  static async processSingleMessage(
    messageId: string, chatId: string, sender: string, body: string, timestamp: Date, mediaType?: string | null
  ) {
    const recentMessages = await WhatsAppService.fetchMessagesByChatId(chatId);
    const conversationContext = recentMessages
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
      .map(m => `[${m.timestamp.toISOString()}] ${m.sender}: ${m.body}`)
      .join('\n');

    const enrichedBody = mediaType ? `[${mediaType}] ${body}` : body;

    let result: ClassificationResult;
    try {
      const aiResult = await AIService.classifyMessage({ sender, body: enrichedBody, timestamp: timestamp.toISOString(), conversationContext });
      result = {
        isPending: aiResult.is_pending,
        confidence: aiResult.confidence,
        reason: aiResult.reason,
        suggestedAction: aiResult.suggested_action,
        priority: aiResult.priority,
        category: aiResult.category,
      };
    } catch {
      logger.warn({ messageId }, 'AI classification failed, falling back to heuristics');
      result = heuristicClassify(enrichedBody);
    }

    await this.storeClassification(messageId, chatId, sender, result, timestamp);
  }

  private static async storeClassification(
    messageId: string, chatId: string, sender: string, result: ClassificationResult, timestamp: Date
  ) {
    const slaMinutes = 15;
    await StorageRepository.updateMessageClassification(
      messageId,
      result.isPending ? 'PENDING' : 'NOT_PENDING',
      result.reason,
      new Date(),
      new Date(timestamp.getTime() + slaMinutes * 60 * 1000),
    );

    if (result.isPending) {
      const digest = await StorageRepository.saveDigest({
        chatId,
        chatName: sender,
        summary: result.reason,
        priority: result.priority,
        category: result.category,
        sentiment: 'neutral',
        requiresFounder: result.priority === 'high' || result.priority === 'urgent',
        suggestedReply: result.suggestedAction || undefined,
      });

      if (result.suggestedAction) {
        const { default: TasksService } = await import('../tasks/service');
        await TasksService.createTask({
          title: result.suggestedAction,
          owner: 'Founder',
          status: 'PENDING',
          source: 'WHATSAPP',
          sourceId: digest.id,
        });
      }
    }

    broadcastWhatsAppEvent('message.classified', {
      messageId, chatId,
      isPending: result.isPending,
      priority: result.priority,
      reason: result.reason,
    });
  }
}