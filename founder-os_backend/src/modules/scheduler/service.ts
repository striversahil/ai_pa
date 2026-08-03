import { logger } from '../../shared/logger';
import { EngineRegistry } from '../../shared/engine';
import { SalesCopilotService } from '../sales_copilot/service';
import { BrainService } from '../brain/service';
import { WhatsappEngine } from '../whatsapp/engine';
import { EmailEngine } from '../email/engine';
import { registerWhatsappJobs } from '../whatsapp/jobs';
import { registerEmailJobs } from '../email/jobs';
import { registerSalesCopilotJobs } from '../sales_copilot/jobs';
import { registerQueueJobs } from '../queue/jobs';
import { registerMonitoringJobs } from '../monitoring/jobs';
import { registerStorageJobs } from '../storage/jobs';
import { registerBriefingJobs, generateAndSaveMorningBrief, generateAndSaveEveningSummary } from './briefing';

/**
 * Aggregates every scheduled job in the system. Each domain module owns its own
 * cron registrar (whatsapp/jobs, email/jobs, queue/jobs, ...) and its own
 * engine implementation; this service only wires them together so the "god
 * class" concern of who schedules what stays small and discoverable.
 */
export class SchedulerService {
  static init() {
    logger.info('SchedulerService: initializing scheduled jobs');

    // Register modular engines (consumed by the briefing/EOD jobs)
    EngineRegistry.register('whatsapp', new WhatsappEngine());
    EngineRegistry.register('email', new EmailEngine());
    EngineRegistry.register('sales_copilot', new SalesCopilotService());
    EngineRegistry.register('brain', new BrainService());

    registerWhatsappJobs();
    registerEmailJobs();
    registerSalesCopilotJobs();
    registerQueueJobs();
    registerMonitoringJobs();
    registerStorageJobs();
    registerBriefingJobs();

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
