import { OutboundService, SendResult } from './outbound';
import { logger } from '../../shared/logger';

export class NotificationBatcher {
  private static buffer: Map<string, string[]> = new Map();

  static addAlert(chatId: string, alert: string) {
    if (!this.buffer.has(chatId)) this.buffer.set(chatId, []);
    this.buffer.get(chatId)!.push(alert);
  }

  static async flushAll() {
    const retries: Map<string, string[]> = new Map();

    for (const [chatId, alerts] of this.buffer.entries()) {
      if (alerts.length === 0) continue;
      const summary = `Batch Summary\n\n${alerts.map((a, i) => `${i + 1}. ${a}`).join('\n')}`;
      const result: SendResult = await OutboundService.sendWithJitter(chatId, summary);

      if (result !== 'sent') {
        retries.set(chatId, alerts);
        logger.warn({ chatId, result }, 'Batcher: message deferred, re-buffering for next flush');
      }
    }

    this.buffer.clear();
    for (const [chatId, alerts] of retries.entries()) {
      this.buffer.set(chatId, alerts);
    }
  }
}
