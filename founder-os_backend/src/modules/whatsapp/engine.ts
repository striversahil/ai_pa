import { AnalysisEngine } from '../../shared/engine';
import { DigestService } from '../digest/service';
import { StorageRepository } from '../storage/repository';

export class WhatsappEngine implements AnalysisEngine {
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
