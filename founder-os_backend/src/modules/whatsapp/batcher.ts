import { OutboundService } from './outbound';

export class NotificationBatcher {
  private static buffer: Map<string, string[]> = new Map();

  static addAlert(chatId: string, alert: string) {
    if (!this.buffer.has(chatId)) this.buffer.set(chatId, []);
    this.buffer.get(chatId)!.push(alert);
  }

  static async flushAll() {
    for (const [chatId, alerts] of this.buffer.entries()) {
      if (alerts.length === 0) continue;
      const summary = `Batch Summary\n\n${alerts.map((a, i) => `${i + 1}. ${a}`).join('\n')}`;
      await OutboundService.sendWithJitter(chatId, summary);
    }
    this.buffer.clear();
  }
}