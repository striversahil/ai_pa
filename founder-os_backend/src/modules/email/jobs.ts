import cron from 'node-cron';
import { EngineRegistry } from '../../shared/engine';
import { logger } from '../../shared/logger';

/**
 * Email + Brain indexing jobs, co-scheduled every 30 minutes.
 */
export function registerEmailJobs() {
  cron.schedule('*/30 * * * *', async () => {
    logger.info('Cron: Running Email and Brain index jobs...');
    try {
      const emailEng = EngineRegistry.get('email');
      if (emailEng) await emailEng.runSync();
    } catch (error: any) {
      logger.error({ error: error.message }, 'Cron Error: Email sync job failed');
    }

    try {
      const brainEng = EngineRegistry.get('brain');
      if (brainEng) await brainEng.runSync();
    } catch (error: any) {
      logger.error({ error: error.message }, 'Cron Error: Brain indexing job failed');
    }
  }, { timezone: 'Asia/Kolkata' });
}
