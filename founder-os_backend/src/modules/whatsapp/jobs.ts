import cron from 'node-cron';
import { EngineRegistry } from '../../shared/engine';
import { logger } from '../../shared/logger';
import { NotificationBatcher } from './batcher';
import { checkWahaSession } from './session-monitor';

/**
 * WhatsApp-domain cron jobs: digest processing, WAHA session health and the
 * notification batcher flush.
 */
export function registerWhatsappJobs() {
  // WhatsApp processing - runs every 5 minutes
  cron.schedule('*/5 * * * *', async () => {
    logger.info('Cron: Running WhatsApp digest job...');
    try {
      const eng = EngineRegistry.get('whatsapp');
      if (eng) await eng.runSync();
    } catch (error: any) {
      logger.error({ error: error.message }, 'Cron Error: WhatsApp digest job failed');
    }
  }, { timezone: 'Asia/Kolkata' });

  // WAHA session health monitor - runs every 5 minutes.
  // Checks session status and auto-reconnects if disconnected for >1 minute.
  cron.schedule('*/5 * * * *', async () => {
    try {
      await checkWahaSession();
    } catch (error: any) {
      logger.error({ error: error.message }, 'Cron Error: WAHA health check failed');
    }
  }, { timezone: 'Asia/Kolkata' });

  // Notification Batcher - flushes grouped alerts every 15 minutes
  cron.schedule('*/15 * * * *', async () => {
    try {
      await NotificationBatcher.flushAll();
    } catch (error: any) {
      logger.error({ error: error.message }, 'Cron Error: Notification batcher flush failed');
    }
  }, { timezone: 'Asia/Kolkata' });
}
