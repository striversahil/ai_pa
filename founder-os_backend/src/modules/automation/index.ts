/**
 * Automation framework facade.
 *
 *   AutomationRegistry.load()   — call at boot (via SchedulerService.init)
 *   AutomationEngine.trigger()  — event automations, emitted from source modules
 *   automationRouter            — admin/dashboard API
 */
export { AutomationEngine } from './engine';
export { AutomationRegistry } from './registry';
export { default as automationRouter } from './routes';
