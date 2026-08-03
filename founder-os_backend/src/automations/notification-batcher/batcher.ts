import { OutboundService, SendResult } from '../../modules/whatsapp/outbound';
import { MessageQueueService } from '../../modules/queue/service';
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

      if (result === 'outside_hours') {
        // Outside business hours: re-buffering would retry every flush and burn
        // the next morning's send budget without sending anything. Defer to the
        // next 8 AM IST window and drop the buffer entry.
        await MessageQueueService.enqueueDelayedMorning(chatId, summary);
        logger.info({ chatId }, 'Batcher: outside hours, deferred to morning queue');
      } else if (result !== 'sent') {
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
