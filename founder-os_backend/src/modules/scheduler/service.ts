import { logger } from '../../shared/logger';
import { EngineRegistry } from '../../shared/engine';
import { SalesCopilotService } from '../../automations/zoho-sent-analyzer/service';
import { BrainService } from '../brain/service';
import { WhatsappEngine } from '../whatsapp/engine';
import { EmailEngine } from '../email/engine';
import { AutomationRegistry } from '../automation/registry';
import { generateAndSaveMorningBrief } from '../../automations/morning-brief/service';
import { generateAndSaveEveningSummary } from '../../automations/eod-summary/service';

/**
 * Boot-time wiring. Every scheduled/evented task in the system is now an
 * automation in src/automations/ — the AutomationRegistry discovers them, syncs
 * their definitions into the DB and schedules their triggers. The four engines
 * are still registered here because the briefing/EOD automations consume them
 * for context via EngineRegistry.
 */
export class SchedulerService {
  static async init(): Promise<void> {
    logger.info('SchedulerService: initializing scheduled jobs');

    // Register modular engines (consumed by the briefing/EOD context gatherers)
    EngineRegistry.register('whatsapp', new WhatsappEngine());
    EngineRegistry.register('email', new EmailEngine());
    EngineRegistry.register('sales_copilot', new SalesCopilotService());
    EngineRegistry.register('brain', new BrainService());

    // Discover + schedule every automation in src/automations/
    await AutomationRegistry.load();

    logger.info('SchedulerService: all scheduled cron tasks successfully started');
  }

  /**
   * Orchestrates gathering context and generating the morning briefing
   */
  static async generateAndSaveMorningBrief(): Promise<string> {
    return generateAndSaveMorningBrief();
  }

  /**
   * Orchestrates gathering context and generating the evening EOD summary
   */
  static async generateAndSaveEveningSummary(): Promise<string> {
    return generateAndSaveEveningSummary();
  }
}

export default SchedulerService;
