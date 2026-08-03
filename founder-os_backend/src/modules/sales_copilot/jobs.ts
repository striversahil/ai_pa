import cron from 'node-cron';
import { EngineRegistry } from '../../shared/engine';
import { logger } from '../../shared/logger';
import { SalesCopilotService } from './service';

/**
 * Sales Copilot (Zoho) incremental sync — runs every 15 minutes.
 * Only estimates that are new or modified since their last sync are fetched
 * and re-analyzed; everything else is skipped. Any estimate modified while the
 * machine was off is automatically caught up on the first tick back.
 */
export function registerSalesCopilotJobs() {
  cron.schedule('*/15 * * * *', async () => {
    if (SalesCopilotService.isSyncRunning) {
      logger.info('Cron: Sales Copilot sync already running, skipping this tick.');
      return;
    }
    try {
      const zohoEng = EngineRegistry.get('sales_copilot');
      if (zohoEng) await zohoEng.runSync();
    } catch (error: any) {
      logger.error({ error: error.message }, 'Cron Error: Sales Copilot incremental sync failed');
    }
  }, { timezone: 'Asia/Kolkata' });
}
