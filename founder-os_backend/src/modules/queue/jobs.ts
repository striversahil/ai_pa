import cron from 'node-cron';
import { logger } from '../../shared/logger';
import { MessageQueueService } from './service';

/**
 * Queue-domain recovery + drain jobs. The morning drain runs every minute and
 * the two recovery sweeps re-queue anything that was persisted while Redis was
 * down (orphaned unprocessed messages, outbound intents).
 */
export function registerQueueJobs() {
  // Morning queue drain - runs every minute
  cron.schedule('* * * * *', async () => {
    try {
      await MessageQueueService.drainMorningQueue();
    } catch (error: any) {
      logger.error({ error: error.message }, 'Cron Error: Morning queue drain failed');
    }
  }, { timezone: 'Asia/Kolkata' });

  // Outbound-intent recovery - every minute, re-deferrals persisted sends that
  // could not reach the morning queue while Redis was down.
  cron.schedule('* * * * *', async () => {
    try {
      await MessageQueueService.recoverOutboundIntents();
    } catch (error: any) {
      logger.error({ error: error.message }, 'Cron Error: Outbound intent recovery failed');
    }
  }, { timezone: 'Asia/Kolkata' });

  // Orphaned-message recovery - every 2 minutes, re-enqueues messages that were
  // saved to the DB but never classified (Redis was down during a flush).
  cron.schedule('*/2 * * * *', async () => {
    try {
      await MessageQueueService.recoverOrphanedMessages();
    } catch (error: any) {
      logger.error({ error: error.message }, 'Cron Error: Orphan recovery failed');
    }
  }, { timezone: 'Asia/Kolkata' });
}
