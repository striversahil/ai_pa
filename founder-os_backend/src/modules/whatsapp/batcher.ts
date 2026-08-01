import { OutboundService, SendResult } from './outbound';
import { logger } from '../../shared/logger';

// Spin-tax: the same batch body must not go out verbatim to many recipients —
// identical text across chats is Meta's clearest bulk-spam signature. Each chat
// gets a stable (hash-selected) heading variant so the body differs per
// recipient without ever looking chaotic or machine-randomized.
const SUMMARY_HEADINGS = [
  'Batch Summary',
  'Summary of updates',
  'Updates for you',
  'Your daily summary',
  'Here are the latest updates',
  'Today\u2019s update summary',
];

function pickHeading(chatId: string): string {
  let hash = 0;
  for (let i = 0; i < chatId.length; i++) {
    hash = (hash * 31 + chatId.charCodeAt(i)) >>> 0;
  }
  return SUMMARY_HEADINGS[hash % SUMMARY_HEADINGS.length];
}

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
      const summary = `${pickHeading(chatId)}\n\n${alerts.map((a, i) => `${i + 1}. ${a}`).join('\n')}`;
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
