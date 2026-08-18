import { logger } from '../../shared/logger';
import { EngineRegistry } from '../../shared/engine';
import { SalesCopilotService } from '../../automations/zoho-sent-analyzer/service';
import { BrainService } from '../brain/service';
import { WhatsappEngine } from '../whatsapp/engine';
import { EmailEngine } from '../email/engine';
import { AutomationRegistry } from '../automation/registry-worker';
import { generateAndSaveMorningBrief } from '../../automations/morning-brief/service';
import { generateAndSaveEveningSummary } from '../../automations/eod-summary/service';

/**
 * Worker-safe scheduler: registers the four engines and loads the automation
 * registry. No cron wiring — scheduled runs happen via GitHub Actions calling
 * /api/trigger/:slug on the Worker.
 */
export class SchedulerService {
  static async init(): Promise<void> {
    logger.info('SchedulerService: initializing engines + automation registry (worker)');

    EngineRegistry.register('whatsapp', new WhatsappEngine());
    EngineRegistry.register('email', new EmailEngine());
    EngineRegistry.register('sales_copilot', new SalesCopilotService());
    EngineRegistry.register('brain', new BrainService());

    await AutomationRegistry.load();

    logger.info('SchedulerService: all automation definitions loaded (worker)');
  }

  static async generateAndSaveMorningBrief(): Promise<string> {
    return generateAndSaveMorningBrief();
  }

  static async generateAndSaveEveningSummary(): Promise<string> {
    return generateAndSaveEveningSummary();
  }
}

export default SchedulerService;