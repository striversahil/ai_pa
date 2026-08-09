/**
 * Automation engine: dispatch (event + scan), condition evaluation, dedup,
 * cooldown and run recording.
 */
import { logger } from '../../shared/logger';
import { prisma } from '../../shared/prisma';
import type { AutomationContext, AutomationDefinition, AutomationModule } from './types';
import { evaluateCondition } from './conditions';
import { executeAction } from './actions';

interface LoadedAutomation {
  def: AutomationDefinition;
  module: AutomationModule;
  dbId: string;
  enabled: boolean;
}

export class AutomationEngine {
  private static loaded = new Map<string, LoadedAutomation>();

  static register(slug: string, def: AutomationDefinition, module: AutomationModule, dbId: string, enabled: boolean) {
    this.loaded.set(slug, { def, module, dbId, enabled });
  }

  static setEnabled(slug: string, enabled: boolean) {
    const entry = this.loaded.get(slug);
    if (entry) entry.enabled = enabled;
  }

  static get(slug: string): LoadedAutomation | undefined {
    return this.loaded.get(slug);
  }

  static all(): LoadedAutomation[] {
    return Array.from(this.loaded.values());
  }

  /**
   * Optional dashboard data provider (`GET /api/automations/:slug/data`).
   * Query params (e.g. start/end) are exposed to `data()` via `ctx.subject`.
   */
  static async getData(slug: string, query: Record<string, any> = {}): Promise<any> {
    const entry = this.loaded.get(slug);
    if (!entry) throw new Error('automation not loaded');
    if (!entry.module.data) throw new Error('no data provider');
    return entry.module.data(this.ctxFor(slug, query ?? {}));
  }

  private static ctxFor(slug: string, subject: Record<string, any>): AutomationContext {
    return {
      subject,
      payload: subject,
      record: subject,
      config: this.loaded.get(slug)?.def.config ?? {},
      log: (level, msg, meta) => {
        if (level === 'error') logger.error({ slug, ...(meta ?? {}) }, msg);
        else if (level === 'warn') logger.warn({ slug, ...(meta ?? {}) }, msg);
        else logger.info({ slug, ...(meta ?? {}) }, msg);
      },
    };
  }

  /**
   * Event path: fire every enabled event automation subscribed to `event`.
   */
  static async trigger(event: string, payload: Record<string, any>): Promise<void> {
    for (const [slug, entry] of this.loaded) {
      if (!entry.enabled || entry.def.type !== 'rule') continue;
      const t = entry.def.trigger;
      const subscribed = (t.type === 'event' || t.type === 'event_plus_scan') && t.event === event;
      if (!subscribed) continue;
      try {
        await this.fire(slug, entry, payload);
      } catch (e: any) {
        logger.error({ slug, event, error: e.message }, 'Automation event fire failed');
      }
    }
  }

  /**
   * Scan path: handler automations run their code body; rule automations run
   * their scanner and evaluate each candidate record.
   */
  static async scan(slug: string): Promise<void> {
    const entry = this.loaded.get(slug);
    if (!entry || !entry.enabled) return;
    if (entry.def.type === 'handler') {
      await this.runHandler(slug, entry);
      return;
    }
    if (!entry.module.scanner) {
      logger.warn({ slug }, 'Rule automation has no scanner for its schedule');
      return;
    }
    const ctx = this.ctxFor(slug, {});
    const records = await entry.module.scanner(ctx);
    if (records.length > 0) {
      logger.info({ slug, count: records.length }, 'Automation scan: processing candidates');
    }
    for (const record of records) {
      try {
        await this.fire(slug, entry, record);
      } catch (e: any) {
        logger.error({ slug, error: e.message }, 'Automation scan fire failed');
      }
    }
  }

  private static async runHandler(slug: string, entry: LoadedAutomation): Promise<void> {
    if (!entry.module.handler) return;
    const ctx = this.ctxFor(slug, {});
    try {
      await entry.module.handler(ctx);
      await this.touchRun(slug, entry);
      logger.debug({ slug }, 'Handler automation ran');
    } catch (e: any) {
      logger.error({ slug, error: e.message }, 'Handler automation failed');
    }
  }

  private static async fire(slug: string, entry: LoadedAutomation, subject: Record<string, any>): Promise<void> {
    const { def, module, dbId } = entry;
    const ctx = this.ctxFor(slug, subject);

    if (!evaluateCondition(def.condition, subject, ctx)) return;

    const dedupKey = this.computeDedupKey(def, module, subject);

    // Cooldown: don't fire again within cooldownMs of the last run.
    if (def.cooldownMs && def.cooldownMs > 0) {
      const automation = await prisma.automation.findUnique({ where: { id: dbId }, select: { lastRunAt: true } });
      if (automation?.lastRunAt && Date.now() - automation.lastRunAt.getTime() < def.cooldownMs) {
        logger.debug({ slug, dedupKey }, 'Automation skipped: within cooldown window');
        return;
      }
    }

    // Dedup: the unique (automationId, dedupKey) makes double-firing impossible.
    const existing = await prisma.automationRun.findUnique({
      where: { automationId_dedupKey: { automationId: dbId, dedupKey } },
      select: { id: true },
    });
    if (existing) {
      logger.debug({ slug, dedupKey }, 'Automation skipped: already fired for this key');
      return;
    }

    try {
      for (const action of def.actions ?? []) {
        const result = await executeAction(action, ctx, module);
        if (result.status === 'skipped' || result.status === 'unsupported') {
          logger.warn({ slug, dedupKey, action: action.type, result }, 'Automation action skipped/unsupported');
        }
      }
      await prisma.automationRun.create({
        data: { automationId: dbId, dedupKey, status: 'SUCCESS', payloadJson: JSON.stringify(subject) },
      });
      await this.touchRun(slug, entry);
      logger.info({ slug, dedupKey }, 'Automation fired successfully');
    } catch (e: any) {
      try {
        await prisma.automationRun.create({
          data: { automationId: dbId, dedupKey, status: 'FAILED', payloadJson: JSON.stringify(subject), error: e.message },
        });
      } catch (_) { /* dedup race: another run already recorded it */ }
      logger.error({ slug, dedupKey, error: e.message }, 'Automation fire failed');
    }
  }

  private static computeDedupKey(def: AutomationDefinition, module: AutomationModule, subject: Record<string, any>): string {
    if (module.dedupKey) {
      const key = module.dedupKey(subject);
      if (key) return key;
    }
    if (def.dedupField) {
      const value = subject[def.dedupField] ?? this.resolvePath(subject, def.dedupField);
      if (value != null) return String(value);
    }
    // Fallback: stable hash of the whole subject.
    return `h_${this.hash(JSON.stringify(subject))}`;
  }

  private static resolvePath(obj: any, path: string): any {
    return path.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
  }

  private static hash(str: string): string {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
    return h.toString(36);
  }

  private static async touchRun(slug: string, entry: LoadedAutomation): Promise<void> {
    await prisma.automation.update({
      where: { id: entry.dbId },
      data: { lastRunAt: new Date(), runCount: { increment: 1 } },
    }).catch((e: any) => logger.warn({ slug, error: e.message }, 'Could not update automation run stats'));
  }
}
