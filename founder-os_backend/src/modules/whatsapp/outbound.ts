import { config } from '../../config';
import { logger } from '../../shared/logger';
import { MessageQueueService } from '../queue/service';

function randomUniform(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export type SendResult = 'sent' | 'rate_limited' | 'outside_hours';

export class OutboundService {
  private static sendLocks = new Map<string, Promise<SendResult>>();

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
    const prev = this.sendLocks.get(chatId) || Promise.resolve('sent' as const);
    const next = prev.then(() => this.executeSend(chatId, messageBody));
    this.sendLocks.set(chatId, next);
    return next;
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

    await fetch(`${config.WAHA_API_URL}/api/sendSeen`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': config.WAHA_API_KEY,
      },
      body: JSON.stringify({
        session: config.WAHA_SESSION_NAME,
        chatId,
      }),
    });

    await sleep(randomUniform(1000, 2500));

    await fetch(`${config.WAHA_API_URL}/api/startTyping`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': config.WAHA_API_KEY,
      },
      body: JSON.stringify({
        session: config.WAHA_SESSION_NAME,
        chatId,
      }),
    });

    const typingDelay = Math.min(Math.max(messageBody.length * 50, 2000), 6000);
    const jitter = randomUniform(500, 3000);
    await sleep(typingDelay + jitter);

    await fetch(`${config.WAHA_API_URL}/api/sendText`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': config.WAHA_API_KEY,
      },
      body: JSON.stringify({
        session: config.WAHA_SESSION_NAME,
        chatId,
        text: messageBody,
      }),
    });

    return 'sent';
  }

  private static isWithinWorkingHours(startHour = 8, endHour = 22): boolean {
    const currentHour = new Date().getHours();
    return currentHour >= startHour && currentHour < endHour;
  }
}