import { config } from '../../config';
import { logger } from '../../shared/logger';
import { MessageQueueService } from '../queue/service';

function randomUniform(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export class OutboundService {
  static async sendWithJitter(chatId: string, messageBody: string) {
    if (!this.isWithinWorkingHours()) {
      logger.info({ chatId }, 'Outside working hours. Deferring outbound message to morning queue.');
      await MessageQueueService.enqueueDelayedMorning(chatId, messageBody);
      return;
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
    await sleep(typingDelay + randomUniform(100, 900));

    const response = await fetch(`${config.WAHA_API_URL}/api/sendText`, {
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

    return response;
  }

  private static isWithinWorkingHours(startHour = 8, endHour = 22): boolean {
    const currentHour = new Date().getHours();
    return currentHour >= startHour && currentHour < endHour;
  }
}