import cron from 'node-cron';
import { logger } from '../../shared/logger';
import { SLAChecker } from './sla-check';

/**
 * Monitoring-domain cron jobs.
 */
export function registerMonitoringJobs() {
  // SLA Monitor - runs every minute
  cron.schedule('* * * * *', async () => {
    try {
      await SLAChecker.check();
    } catch (error: any) {
      logger.error({ error: error.message }, 'Cron Error: SLA check failed');
    }
  }, { timezone: 'Asia/Kolkata' });
}
