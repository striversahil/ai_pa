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

export type SendResult = 'sent' | 'rate_limited' | 'outside_hours' | 'failed' | 'circuit_broken';

export class OutboundService {
  // Global account-level mutex: every send waits for the previous one to fully
  // complete (sendSeen → pause → startTyping → typing delay → sendText → cooldown) before it
  // starts. This guarantees that no two messages are ever sent at the same time to
  // different recipients, maintaining a singular human-like stream.
  private static globalSendLock: Promise<SendResult> = Promise.resolve('sent' as const);

  // Burst guard: limits how many concurrent send operations can sit waiting in memory.
  // Anything beyond this threshold is immediately rejected as 'rate_limited' so the upper
  // application layer/queues can handle backoff gracefully.
  private static pendingSendCount = 0;
  private static readonly MAX_PENDING_SENDS = 25;

  // Rate Limiting Cache & Constants
  private static rateLimitCache = new Map<string, number[]>();
  private static readonly MAX_PER_CHAT_PER_MINUTE = 15;
  private static readonly MAX_PER_ACCOUNT_PER_HOUR_BASE = 50;
  private static readonly MAX_PER_ACCOUNT_PER_HOUR_JITTER = 10;
  private static accountTimestamps: number[] = [];
  private static currentHourLimit = OutboundService.computeHourLimit();

  // Hard Circuit Breaker Strategy: Protects the founder's personal line from infinite loops
  // caused by upstream AI agents or automated webhooks repeating payloads.
  private static dailyOutboundCount = 0;
  private static currentSystemDay = new Date().getDate();
  private static readonly HARD_DAILY_MAX_OUTBOUND = 120; // Hard cutoff for internal safeguards

  /**
   * Dynamically alters the maximum allowed hourly budget using a jitter vector
   * so that the macro-cadence variations cannot be fingerprint-profiled by Meta.
   */
  private static computeHourLimit(): number {
    return (
      this.MAX_PER_ACCOUNT_PER_HOUR_BASE +
      Math.floor(randomUniform(-this.MAX_PER_ACCOUNT_PER_HOUR_JITTER, this.MAX_PER_ACCOUNT_PER_HOUR_JITTER + 1))
    );
  }

  /**
   * Enforces specific transmission ceilings per distinct chat thread.
   */
  private static checkChatRateLimit(chatId: string): boolean {
    const now = Date.now();
    const window = 60_000;
    const timestamps = (this.rateLimitCache.get(chatId) || []).filter(t => now - t < window);
    
    if (timestamps.length >= this.MAX_PER_CHAT_PER_MINUTE) return false;
    
    timestamps.push(now);
    this.rateLimitCache.set(chatId, timestamps);
    return true;
  }

  /**
   * Tracks global account delivery volume across rolling hourly windows.
   */
  private static checkAccountRateLimit(): boolean {
    const now = Date.now();
    const window = 3_600_000;
    this.accountTimestamps = this.accountTimestamps.filter(t => now - t < window);
    
    if (this.accountTimestamps.length >= this.currentHourLimit) return false;
    
    this.accountTimestamps.push(now);
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
    // Hard flood guard check
    if (this.pendingSendCount >= this.MAX_PENDING_SENDS) {
      logger.warn(
        { chatId, pending: this.pendingSendCount },
        'Send burst guard active: queue capacity saturated, message deferred'
      );
      return 'rate_limited';
    }

    this.pendingSendCount++;
    
    // Append operation execution payload directly to the running sequential Promise chain
    const result = this.globalSendLock.then(() => this.executeSend(chatId, messageBody));
    
    // Maintain chain health regardless of isolated operational errors
    this.globalSendLock = result.catch(() => 'sent' as SendResult);
    
    return result.finally(() => {
      this.pendingSendCount--;
    });
  }

  /**
   * Contains core behavioral simulation logic and low-level proxy network delivery orchestration.
   */
  private static async executeSend(chatId: string, messageBody: string): Promise<SendResult> {
    // 1. Run Structural Telemetry & Boundary Access Validations
    if (!this.checkDailyCircuitBreaker()) {
      return 'circuit_broken';
    }
    if (!this.checkChatRateLimit(chatId)) {
      logger.warn({ chatId }, 'Chat specific rate limit active (15/min). Deferring task.');
      return 'rate_limited';
    }
    if (!this.checkAccountRateLimit()) {
      logger.warn('Account global hourly limits reached. Deferring task.');
      return 'rate_limited';
    }
    if (!this.isWithinWorkingHours()) {
      logger.info({ chatId }, 'Outside operational working hour parameters. Moving to morning queue layer.');
      await MessageQueueService.enqueueDelayedMorning(chatId, messageBody);
      return 'outside_hours';
    }

    // Fire off asynchronous background tracking without blocking primary network pipe execution
    AuditService.record('MESSAGE_SENT', 'MESSAGE', null, { chatId, bodyLength: messageBody.length }).catch(() => {});

    /**
     * Isolated HTTP transmission client wrapping standard platform timeout guards
     */
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

    const isGroup = chatId.endsWith('@g.us');

    if (isGroup) {
      // Group structures utilize streamlined micro-jitter profiles to bypass multi-client metadata calculations
      await sleep(randomUniform(1500, 3500));
    } else {
      // =========================================================================
      // INDIVIDUAL CHAT ROUTE (@c.us): Stateful Human Interaction Simulation
      // =========================================================================

      let unreadCount = 0;
      try {
        const contact = await StorageRepository.fetchContactByChatId(chatId);
        unreadCount = contact?.unreadCount || 0;
      } catch (err: any) {
        logger.warn({ chatId, error: err.message }, 'Unable to safely verify chat state, bypassing sendSeen payload');
      }

      // Safeguard: Never issue read acknowledgments if no data context indicates unread messages exist.
      if (unreadCount > 0) {
        const seenRes = await wahaFetch('/api/sendSeen', { chatId });
        if (!seenRes.ok) {
          logger.warn({ chatId, status: seenRes.status }, 'WAHA inbound acknowledgement sync failed (non-fatal)');
        } else {
          // Commit counter updates locally to clear double-trigger windows
          await StorageRepository.updateContactUnread(chatId, -unreadCount).catch(() => {});
        }
      } else {
        logger.debug({ chatId }, 'Outbound initialized transaction: bypassing unread ack layers safely');
      }

      // Post-read comprehension lag delay simulation
      await sleep(randomUniform(1800, 4200));

      // Broadcast an explicit visual state notification over the active node tree
      const typingRes = await wahaFetch('/api/startTyping', { chatId });
      if (!typingRes.ok) {
        logger.warn({ chatId, status: typingRes.status }, 'WAHA structural telemetry composition start failed (non-fatal)');
      }

      // Calculate an unpredictable typing dynamic profile mimicking unique character generation speeds
      const randomizedTypingSpeed = randomUniform(35, 65); // ms per character matrix
      const baseTypingDuration = Math.min(Math.max(messageBody.length * randomizedTypingSpeed, 2200), 7500);
      const readingThinkingJitter = randomUniform(800, 4500);
      
      // Keep socket thread alive within human typing envelope bounds
      await sleep(baseTypingDuration + readingThinkingJitter);
    }

    // 3. Dispatch Content Payload
    const sendRes = await wahaFetch('/api/sendText', { chatId, text: messageBody });
    if (!sendRes.ok) {
      const errorBody = await sendRes.text().catch(() => '');
      logger.error(
        { chatId, status: sendRes.status, errorBody },
        'WAHA endpoint rejected transaction framework delivery parameters'
      );
      return 'failed';
    }

    // 4. Sequential Post-Send Execution Cooldown Boundary (Enforced inside globalSendLock)
    // Ensures that even if multiple tasks are stacked behind this one in BullMQ, the physical
    // browser node waits a randomized window before processing the next request in line.
    const postSendCooldown = randomUniform(4000, 14000);
    await sleep(postSendCooldown);

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
