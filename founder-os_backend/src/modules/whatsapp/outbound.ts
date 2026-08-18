import { config } from '../../config';
import { logger } from '../../shared/logger';
import { getKolkataHour } from '../../shared/ist-time';
import { AuditService } from '../audit/service';
import { getRateLimitState, persistRateLimitState } from './rate-limit-store';

function randomUniform(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export type SendResult = 'sent' | 'rate_limited' | 'outside_hours' | 'failed' | 'circuit_broken';

/** WA Engine Pro expects a bare phone number (country code, no +, no @suffix). */
function chatIdToPhone(chatId: string): string | null {
  if (chatId.endsWith('@c.us') || chatId.endsWith('@lid')) {
    const digits = chatId.replace(/@.*$/, '').replace(/[^0-9]/g, '');
    return digits || null;
  }
  if (chatId.endsWith('@g.us')) {
    // WA Engine Pro is a phone-based API; it has no group send endpoint.
    return null;
  }
  return chatId.replace(/[^0-9]/g, '') || null;
}

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

  // Rate limiting state is persisted to disk (see rate-limit-store) so a restart
  // keeps the throttling exactly where the previous process left off instead of
  // resetting counters to zero and triggering a post-restart burst.
  private static rateLimitState = getRateLimitState();
  private static readonly MAX_PER_CHAT_PER_MINUTE = 15;
  private static readonly MAX_PER_ACCOUNT_PER_HOUR_BASE = 50;
  private static readonly MAX_PER_ACCOUNT_PER_HOUR_JITTER = 10;
  private static currentHourLimit = OutboundService.initHourLimit();

  // Hard Circuit Breaker Strategy: protects the founder's personal line from infinite loops
  // caused by upstream AI agents or automated webhooks repeating payloads.
  private static dailyOutboundCount = 0;
  private static currentSystemDay = new Date().getDate();
  private static readonly HARD_DAILY_MAX_OUTBOUND = 120; // Hard cutoff for internal safeguards

  /**
   * Dynamically alters the maximum allowed hourly budget using a jitter vector
   * so that the macro-cadence variations cannot be fingerprint-profiled by Meta.
   */
  private static computeHourLimit(): number {
    return this.MAX_PER_ACCOUNT_PER_HOUR_BASE + Math.floor(randomUniform(-this.MAX_PER_ACCOUNT_PER_HOUR_JITTER, this.MAX_PER_ACCOUNT_PER_HOUR_JITTER + 1));
  }

  // Restore the daily randomized account limit across restarts. A persisted
  // value (from a previous process run) wins; otherwise compute and persist a
  // fresh one so a restart right before the morning burst keeps the same cap.
  private static initHourLimit(): number {
    const st = this.rateLimitState;
    if (st.hourLimit > 0) return st.hourLimit;
    const computed = this.computeHourLimit();
    st.hourLimit = computed;
    persistRateLimitState();
    return computed;
  }

  private static checkChatRateLimit(chatId: string): boolean {
    const now = Date.now();
    const window = 60_000;
    const timestamps = (this.rateLimitState.chatTimestamps[chatId] || [])
      .filter(t => now - t < window);
    if (timestamps.length >= this.MAX_PER_CHAT_PER_MINUTE) return false;
    timestamps.push(now);
    this.rateLimitState.chatTimestamps[chatId] = timestamps;
    persistRateLimitState();
    return true;
  }

  private static checkAccountRateLimit(): boolean {
    const now = Date.now();
    const window = 3_600_000;
    this.rateLimitState.accountTimestamps = this.rateLimitState.accountTimestamps.filter(t => now - t < window);
    if (this.rateLimitState.accountTimestamps.length >= this.currentHourLimit) return false;
    this.rateLimitState.accountTimestamps.push(now);
    persistRateLimitState();
    return true;
  }

  /**
   * Validates and updates the daily internal safety switch. Resolves multi-day server
   * runtime states by checking calendar date variations dynamically on execution.
   */
  private static checkDailyCircuitBreaker(): boolean {
    const today = new Date().getDate();

    // Reset counter if calendar date shifts forward
    if (this.currentSystemDay !== today) {
      this.currentSystemDay = today;
      this.dailyOutboundCount = 0;
      this.currentHourLimit = this.computeHourLimit(); // Rotate hourly budgets daily
    }

    if (this.dailyOutboundCount >= this.HARD_DAILY_MAX_OUTBOUND) {
      logger.error(
        { dailyCount: this.dailyOutboundCount, maxAllowed: this.HARD_DAILY_MAX_OUTBOUND },
        'CRITICAL: WhatsApp Daily Hard Circuit Breaker Triaged! Outbound blocked to preserve line authority.'
      );
      return false;
    }

    this.dailyOutboundCount++;
    return true;
  }

  /**
   * Gateway entry method exposing clean async job scheduling interfaces to external controllers.
   */
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
    // Daily hard circuit breaker first: if the internal daily safety cap has been
    // reached, refuse immediately regardless of windows or hourly budgets.
    if (!this.checkDailyCircuitBreaker()) {
      return 'circuit_broken';
    }

    // Outside-hours check before consuming any rate-limit budget. A deferred send
    // must never spend the chat or account rate limit for a message that isn't
    // being sent now. Callers own the deferral (the drain and send routes re-queue
    // to the morning queue), so outbound stays a pure sender and never imports the
    // queue layer.
    if (!this.isWithinWorkingHours()) {
      logger.info({ chatId }, 'Outside working hours. Deferring to morning queue.');
      return 'outside_hours';
    }

    if (!this.checkChatRateLimit(chatId)) {
      logger.warn({ chatId }, 'Chat rate limit reached (15/min). Deferring.');
      return 'rate_limited';
    }
    if (!this.checkAccountRateLimit()) {
      logger.warn('Account rate limit reached (40-60/hour). Deferring.');
      return 'rate_limited';
    }

    AuditService.record('MESSAGE_SENT', 'MESSAGE', null, { chatId, bodyLength: messageBody.length }).catch(() => {});

    const phone = chatIdToPhone(chatId);
    if (!phone) {
      logger.warn({ chatId }, 'WA Engine Pro cannot send to this chat (no phone number / group) — message NOT delivered');
      return 'failed';
    }

    // WA Engine Pro is a cloud SaaS API: no local session, no sendSeen/startTyping.
    // Send the message directly with a human-like cadence preserved through the
    // existing jitter + post-send cooldown below.
    const sendRes = await waEngineFetch('/messages/send', { phone, message: messageBody });
    if (!sendRes.ok) {
      const errorBody = await sendRes.text().catch(() => '');
      logger.error(
        { chatId, status: sendRes.status, errorBody },
        'WA Engine Pro /messages/send failed — message was NOT delivered'
      );
      return 'failed';
    }

    // Post-send cooldown: varies the gap between successive sends widely so the
    // cadence never looks regular (anywhere from ~4.5s to ~21s+ between messages).
    await sleep(randomUniform(4000, 14000));

    return 'sent';
  }

  /**
   * Confirms timezone operating window bounds using localized timestamp abstractions.
   */
  private static isWithinWorkingHours(startHour = 8, endHour = 22): boolean {
    const currentHour = getKolkataHour(new Date());
    return currentHour >= startHour && currentHour < endHour;
  }
}

/** Shared fetch helper for the WA Engine Pro API (X-API-Key auth, 30s timeout). */
async function waEngineFetch(path: string, body: unknown): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30_000);
  try {
    return await fetch(`${config.WA_ENGINE_BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': config.WA_ENGINE_API_KEY,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}