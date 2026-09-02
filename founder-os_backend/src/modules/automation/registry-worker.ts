/**
 * Worker-safe automation registry: statically imports every automation (no
 * fs globbing), upserts definitions into the Automation table, and registers
 * them with the engine. Cron scheduling is intentionally NOT wired here —
 * scheduled runs happen via GitHub Actions calling /api/trigger/:slug.
 */
import { logger } from '../../shared/logger';
import { prisma } from '../../shared/prisma';
import type { AutomationDefinition, AutomationModule } from './types';
import { AutomationEngine } from './engine';

import * as dataRetention from '../../automations/data-retention';
import * as dppPricesDashboard from '../../automations/dpp-prices-dashboard';
import * as enterpriseOpsAnalytics from '../../automations/enterprise-operations-analytics';
import * as morningQueueDrain from '../../automations/morning-queue-drain';
import * as neodoveTelecallerReport from '../../automations/neodove-telecaller-report';
import * as notificationBatcher from '../../automations/notification-batcher';
import * as orphanedMessageRecovery from '../../automations/orphaned-message-recovery';
import * as outboundIntentRecovery from '../../automations/outbound-intent-recovery';
import * as slaMonitor from '../../automations/sla-monitor';
import * as telecallingAgentAnalysis from '../../automations/telecalling-agent-analysis';
import * as telecallingEnquiryToDpp from '../../automations/telecalling-enquiry-to-dpp';
import * as waEngineMonitor from '../../automations/wa-engine-monitor';
import * as whatsappMarketing from '../../automations/whatsapp-marketing';
import * as telecalling from '../../automations/telecalling';
import * as whatsappAutopilot from '../../automations/whatsapp-autopilot';

const MODULES: Record<string, AutomationModule> = {
  'data-retention': dataRetention as AutomationModule,
  'dpp-prices-dashboard': dppPricesDashboard as AutomationModule,
  'enterprise-operations-analytics': enterpriseOpsAnalytics as AutomationModule,
  'morning-queue-drain': morningQueueDrain as AutomationModule,
  'neodove-telecaller-report': neodoveTelecallerReport as AutomationModule,
  'notification-batcher': notificationBatcher as AutomationModule,
  'orphaned-message-recovery': orphanedMessageRecovery as AutomationModule,
  'outbound-intent-recovery': outboundIntentRecovery as AutomationModule,
  'sla-monitor': slaMonitor as AutomationModule,
  'telecalling-agent-analysis': telecallingAgentAnalysis as AutomationModule,
  'telecalling-enquiry-to-dpp': telecallingEnquiryToDpp as AutomationModule,
  'wa-engine-monitor': waEngineMonitor as AutomationModule,
  'whatsapp-marketing': whatsappMarketing as AutomationModule,
  'telecalling': telecalling as AutomationModule,
  'whatsapp-autopilot': whatsappAutopilot as AutomationModule,
};

const RULES: Record<string, Partial<AutomationDefinition>> = {
  'data-retention': {
    id: 'data-retention', name: 'Data Retention Cleanup', description: 'Daily at 3:00 AM, delete WhatsApp messages older than 90 days.', type: 'handler', trigger: { type: 'schedule', cron: '0 3 * * *' }, enabled: true,
  },
  'dpp-prices-dashboard': {
    id: 'dpp-prices-dashboard', name: 'DPP Prices → Dashboard', description: 'Parse DPP price messages into PriceQuote rows and compute KRA/KPI for the dashboard.', type: 'rule',
    trigger: { type: 'event_plus_scan', event: 'whatsapp.message.inbound', fallbackCron: '* * * * *' },
    condition: { all: [{ field: 'chatId', op: 'eq', value: '{{config.dppChatId}}' }] }, dedupField: 'wahaMessageId',
    actions: [{ type: 'custom:storePrices' }], config: { dppChatId: '' }, enabled: true,
  },
  'enterprise-operations-analytics': {
    id: 'enterprise-operations-analytics', name: 'Enterprise Operations & Order Analytics', description: '18-Point Complete Enterprise Supply Chain Analysis dashboard.', type: 'handler', trigger: { type: 'schedule', cron: '*/30 * * * *' }, enabled: true,
  },
  'eod-summary': {
    id: 'eod-summary', name: 'Evening EOD Summary', description: 'Daily at 7:00 PM IST, generate and save the end-of-day summary.', type: 'handler', trigger: { type: 'schedule', cron: '0 19 * * *' }, enabled: true,
  },
  'morning-queue-drain': {
    id: 'morning-queue-drain', name: 'Morning Queue Drain', description: 'Every minute, send due deferred WhatsApp messages (drain-locked, 60/cycle cap).', type: 'handler', trigger: { type: 'schedule', cron: '* * * * *' }, enabled: true,
  },
  'neodove-telecaller-report': {
    id: 'neodove-telecaller-report', name: 'Telecaller Performance (NeoDove Live)', description: 'Per-agent daily call performance from NeoDove. GH runner refreshes TODAY every 10 min; final snapshot for yesterday at 00:30 IST.', type: 'handler', trigger: { type: 'schedule', cron: '*/10 * * * *' }, enabled: true,
  },
  'notification-batcher': {
    id: 'notification-batcher', name: 'Notification Batcher', description: 'Every 15 minutes, flush grouped alerts to WhatsApp.', type: 'handler', trigger: { type: 'schedule', cron: '*/15 * * * *' }, enabled: true,
  },
  'orphaned-message-recovery': {
    id: 'orphaned-message-recovery', name: 'Orphaned Message Recovery', description: 'Every 2 minutes, re-enqueue messages saved to DB but never classified.', type: 'handler', trigger: { type: 'schedule', cron: '*/2 * * * *' }, enabled: true,
  },
  'outbound-intent-recovery': {
    id: 'outbound-intent-recovery', name: 'Outbound Intent Recovery', description: 'Every minute, re-deferral persisted outbound intents once Redis is back.', type: 'handler', trigger: { type: 'schedule', cron: '* * * * *' }, enabled: true,
  },
  'sla-monitor': {
    id: 'sla-monitor', name: 'SLA Monitor', description: 'Every minute, flag SLA breaches and alert via Slack.', type: 'handler', trigger: { type: 'schedule', cron: '* * * * *' }, enabled: true,
  },
  'telecalling-agent-analysis': {
    id: 'telecalling-agent-analysis', name: 'Telecalling Agents → Dashboard', description: 'Reads the Telecalling Agents Google Sheet and computes per-agent metrics.', type: 'handler', trigger: { type: 'schedule', cron: '*/30 * * * *' },
    config: { sheetUrl: 'https://docs.google.com/spreadsheets/d/1OsQevXQpPT1x2iJgcg0lgUcOInxjZh3tvfNjxAbcENs/edit', range: 'A1:Z1000', maxDailySO: 50 }, enabled: true,
  },
  'telecalling-enquiry-to-dpp': {
    id: 'telecalling-enquiry-to-dpp', name: 'Telecalling Enquiry → Forward to DPP', description: 'Forward telecalling-group enquiries to DPP via WhatsApp within 5 minutes.', type: 'rule',
    trigger: { type: 'event_plus_scan', event: 'whatsapp.group.message', fallbackCron: '* * * * *' },
    condition: { all: [{ field: 'chatId', op: 'eq', value: '{{config.teleGroupChatId}}' }, { field: 'sender', op: 'neq', value: '{{config.dppChatId}}' }] },
    dedupField: 'wahaMessageId',
    actions: [{ type: 'whatsapp_send', chatId: '{{config.dppChatId}}', body: '📞 Enquiry ({{timestamp}})\nFrom: {{sender}}\n\n{{body}}', allowNonAllowlisted: true }],
    config: { teleGroupChatId: '', dppChatId: '' }, enabled: true,
  },
  'wa-engine-monitor': {
    id: 'wa-engine-monitor', name: 'WA Engine Pro Monitor', description: 'Every 5 minutes, check WA Engine Pro API connectivity and audit sustained outages.', type: 'handler', trigger: { type: 'schedule', cron: '*/5 * * * *' }, config: { windowDays: 7 }, enabled: true,
  },
  'whatsapp-marketing': {
    id: 'whatsapp-marketing', name: 'WhatsApp Marketing', description: 'Multi-campaign WhatsApp marketing.', type: 'handler', trigger: { type: 'schedule', cron: '* * * * *' }, enabled: true,
  },
  'telecalling': {
    id: 'telecalling', name: 'Telecalling', description: 'Unified daily telecaller performance: Lead Conversion (estimate assignment) + Lead Generation (NeoDove calls/leads, live), with KPIs and leaderboard.', type: 'handler', trigger: { type: 'schedule', cron: '*/30 * * * *' }, enabled: true,
  },
  'whatsapp-autopilot': {
    id: 'whatsapp-autopilot', name: 'WhatsApp Autopilot', description: 'Structured business layer under WhatsApp: message lineage, per-chat task queue, LLM state transitions. Core loop runs on GH Actions (shadow mode — nothing sends).', type: 'handler', trigger: { type: 'schedule', cron: '*/5 * * * *' }, enabled: true,
  },
};

export class AutomationRegistry {
  static async load(): Promise<void> {
    // Parallel: each loadOne is an independent D1 upsert; sequential awaits
    // serialized 12 round trips and dominated cold-start latency.
    await Promise.all(
      Object.entries(RULES).map(async ([slug, fileDef]) => {
        try {
          await this.loadOne(slug, fileDef);
        } catch (e: any) {
          logger.error({ slug, error: e.message }, 'Automation registry: failed to load automation');
        }
      }),
    );
    logger.info({ count: Object.keys(RULES).length }, 'Automation registry loaded');
  }

  private static async loadOne(slug: string, fileDef: Partial<AutomationDefinition>): Promise<void> {
    const module: AutomationModule = MODULES[slug] ?? {};

    const def: AutomationDefinition = {
      id: slug,
      name: fileDef.name ?? slug,
      description: fileDef.description,
      type: fileDef.type ?? 'rule',
      trigger: fileDef.trigger ?? { type: 'schedule', cron: '* * * * *' },
      condition: fileDef.condition ?? null,
      dedupField: fileDef.dedupField,
      actions: fileDef.actions ?? [],
      config: fileDef.config ?? {},
      cooldownMs: fileDef.cooldownMs ?? 0,
      enabled: fileDef.enabled ?? true,
    };

    // D1 write-budget protection: upsert on every boot burned ~100k writes/day
    // (each isolate boot + self-heal reload rewrote all definitions). Compare
    // the stored row first and only write when the definition actually changed.
    const desired = {
      name: def.name,
      description: def.description,
      type: def.type,
      triggerJson: JSON.stringify(def.trigger),
      conditionJson: def.condition ? JSON.stringify(def.condition) : null,
      actionsJson: JSON.stringify(def.actions ?? []),
      dedupField: def.dedupField ?? null,
    };

    let row: any;
    const existing = await prisma.automation.findUnique({ where: { slug } });
    const unchanged =
      existing &&
      existing.name === desired.name &&
      existing.description === desired.description &&
      existing.type === desired.type &&
      existing.triggerJson === desired.triggerJson &&
      existing.conditionJson === desired.conditionJson &&
      existing.actionsJson === desired.actionsJson &&
      (existing.dedupField ?? null) === desired.dedupField;

    if (unchanged) {
      row = existing;
    } else {
      row = await prisma.automation.upsert({
        where: { slug },
        update: desired,
        create: {
          slug,
          ...desired,
          configJson: JSON.stringify(def.config ?? {}),
          enabled: def.enabled ?? true,
          cooldownMs: def.cooldownMs ?? 0,
        },
      });
    }

    const dbConfig = row.configJson ? JSON.parse(row.configJson) : {};
    def.config = { ...(def.config ?? {}), ...dbConfig };
    def.enabled = row.enabled;
    if (row.cooldownMs !== 0) def.cooldownMs = row.cooldownMs;

    AutomationEngine.register(slug, def, module, row.id, row.enabled);
    logger.info({ slug, type: def.type, trigger: def.trigger.type, enabled: def.enabled }, 'Automation registered');
  }
}