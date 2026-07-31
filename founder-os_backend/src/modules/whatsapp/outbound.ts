import { config } from '../../config';
import { logger } from '../../shared/logger';
import { getKolkataHour } from '../../shared/ist-time';
import { MessageQueueService } from '../queue/service';
import { AuditService } from '../audit/service';
import { StorageRepository } from '../storage/repository';

function randomUniform(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export type SendResult = 'sent' | 'rate_limited' | 'outside_hours' | 'failed';

export class OutboundService {
  // Global account-level mutex: every send waits for the previous one to fully
  // complete (sendSeen → pause → startTyping → typing delay → sendText) before it
  // starts. This guarantees that no two messages are ever sent at the same time to
  // different recipients, no matter how many are queued (10k+ still go one-by-one).
  private static globalSendLock: Promise<SendResult> = Promise.resolve('sent' as const);

  // Burst guard: only this many sends may sit in the queue at once. Anything
  // beyond it is rejected as 'rate_limited' so callers defer it — an accidental
  // 5,000-message push can never flood the send chain (or WhatsApp).
  private static pendingSendCount = 0;
  private static readonly MAX_PENDING_SENDS = 25;

  private static rateLimitCache = new Map<string, number[]>();
  private static readonly MAX_PER_CHAT_PER_MINUTE = 15;
  private static readonly MAX_PER_ACCOUNT_PER_HOUR_BASE = 175;
  private static readonly MAX_PER_ACCOUNT_PER_HOUR_JITTER = 25;
  private static accountTimestamps: number[] = [];
  private static currentHourLimit = OutboundService.computeHourLimit();

  private static computeHourLimit(): number {
    return this.MAX_PER_ACCOUNT_PER_HOUR_BASE + Math.floor(randomUniform(-this.MAX_PER_ACCOUNT_PER_HOUR_JITTER, this.MAX_PER_ACCOUNT_PER_HOUR_JITTER + 1));
  }

  private static checkChatRateLimit(chatId: string): boolean {
    const now = Date.now();
    const window = 60_000;
    const timestamps = (this.rateLimitCache.get(chatId) || [])
      .filter(t => now - t < window);
    if (timestamps.length >= this.MAX_PER_CHAT_PER_MINUTE) return false;
    timestamps.push(now);
    this.rateLimitCache.set(chatId, timestamps);
    return true;
  }

  private static checkAccountRateLimit(): boolean {
    const now = Date.now();
    const window = 3_600_000;
    this.accountTimestamps = this.accountTimestamps.filter(t => now - t < window);
    if (this.accountTimestamps.length >= this.currentHourLimit) return false;
    this.accountTimestamps.push(now);
    return true;
  }

  static async sendWithJitter(chatId: string, messageBody: string): Promise<SendResult> {
    // Hard flood guard: if too many sends are already waiting, reject immediately
    // instead of chaining on. The caller defers the message to a retry queue, so
    // nothing is fired in bulk and nothing is lost.
    if (this.pendingSendCount >= this.MAX_PENDING_SENDS) {
      logger.warn(
        { chatId, pending: this.pendingSendCount },
        'Send burst guard active: queue full, message deferred'
      );
      return 'rate_limited';
    }

    this.pendingSendCount++;
    const result = this.globalSendLock.then(() => this.executeSend(chatId, messageBody));
    // Keep the chain alive even when a send fails, so one failure never blocks
    // the sends queued behind it.
    this.globalSendLock = result.catch(() => 'sent' as SendResult);
    return result.finally(() => {
      this.pendingSendCount--;
    });
  }

  private static async executeSend(chatId: string, messageBody: string): Promise<SendResult> {
    if (!this.checkChatRateLimit(chatId)) {
      logger.warn({ chatId }, 'Chat rate limit reached (15/min). Deferring.');
      return 'rate_limited';
    }
    if (!this.checkAccountRateLimit()) {
      logger.warn('Account rate limit reached (250/hour). Deferring.');
      return 'rate_limited';
    }

    if (!this.isWithinWorkingHours()) {
      logger.info({ chatId }, 'Outside working hours. Deferring to morning queue.');
      await MessageQueueService.enqueueDelayedMorning(chatId, messageBody);
      return 'outside_hours';
    }

    AuditService.record('MESSAGE_SENT', 'MESSAGE', null, { chatId, bodyLength: messageBody.length }).catch(() => {});

    const wahaFetch = async (path: string, body: unknown): Promise<Response> => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30_000);
      try {
        return await fetch(`${config.WAHA_API_URL}${path}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Api-Key': config.WAHA_API_KEY,
          },
          body: JSON.stringify({ session: config.WAHA_SESSION_NAME, ...(body as object) }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }
    };

    // GROUP ROUTE (@g.us): WhatsApp manages group read status and typing metadata
    // differently. Running sendSeen/startTyping against a group forces WAHA to parse
    // every participant's state — it throws errors and creates a broken, machine-like
    // pattern that Meta can flag. Groups skip all behavioral steps and send directly
    // after a short micro-jitter so the server stream stays calm.
    const isGroup = chatId.endsWith('@g.us');

    if (isGroup) {
      await sleep(randomUniform(1500, 2500));
    } else {
      // INDIVIDUAL ROUTE (@c.us): simulate a human reading + typing the reply.

      // Only send a read receipt if the chat actually has unread messages. Reading a
      // chat we initiated (0 unread) is an impossible human action and is a dead give-
      // away to WhatsApp — so for outbound-first messages we skip sendSeen entirely and
      // go straight to typing. If we can't determine the unread state, default to NOT
      // sending the receipt (safer than the flagged pattern).
      let unreadCount = 0;
      try {
        const contact = await StorageRepository.fetchContactByChatId(chatId);
        unreadCount = contact?.unreadCount || 0;
      } catch (err: any) {
        logger.warn({ chatId, error: err.message }, 'Could not read unread count, skipping sendSeen');
      }

      if (unreadCount > 0) {
        const seenRes = await wahaFetch('/api/sendSeen', { chatId });
        if (!seenRes.ok) {
          logger.warn({ chatId, status: seenRes.status }, 'WAHA sendSeen failed (non-fatal)');
        } else {
          // Mark the chat as read locally so the next send doesn't repeat the receipt.
          await StorageRepository.updateContactUnread(chatId, -unreadCount).catch(() => {});
        }
      } else {
        logger.debug({ chatId }, 'Outbound-first message: skipping sendSeen (0 unread)');
      }

      await sleep(randomUniform(1500, 4500));

      const typingRes = await wahaFetch('/api/startTyping', { chatId });
      if (!typingRes.ok) {
        logger.warn({ chatId, status: typingRes.status }, 'WAHA startTyping failed (non-fatal)');
      }

      const typingDelay = Math.min(Math.max(messageBody.length * 50, 2000), 6000);
      const jitter = randomUniform(1000, 9000);
      await sleep(typingDelay + jitter);
    }

    const sendRes = await wahaFetch('/api/sendText', { chatId, text: messageBody });
    if (!sendRes.ok) {
      const errorBody = await sendRes.text().catch(() => '');
      logger.error(
        { chatId, status: sendRes.status, errorBody },
        'WAHA sendText failed — message was NOT delivered'
      );
      return 'failed';
    }

    // Post-send cooldown: varies the gap between successive sends widely so the
    // cadence never looks regular (anywhere from ~4.5s to ~21s+ between messages).
    await sleep(randomUniform(2000, 12000));

    return 'sent';
  }

  private static isWithinWorkingHours(startHour = 8, endHour = 22): boolean {
    const currentHour = getKolkataHour(new Date());
    return currentHour >= startHour && currentHour < endHour;
  }
}