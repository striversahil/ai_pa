/**
 * Automation registry: discovers every folder in src/automations/, validates it
 * (README.md required, rule.json optional), loads its index.ts, syncs the
 * definition into the Automation table and schedules its triggers.
 *
 * rule.json is the template. On boot the file-owned fields (name, trigger,
 * condition, actions) are upserted by slug; runtime-editable fields (enabled,
 * cooldownMs, config) persist from the DB across redeploys.
 */
import fs from 'fs';
import path from 'path';
import cron from 'node-cron';
import { logger } from '../../shared/logger';
import { prisma } from '../../shared/prisma';
import type { AutomationDefinition, AutomationModule } from './types';
import { AutomationEngine } from './engine';

const AUTOMATIONS_DIR = path.join(__dirname, '../../automations');
const TIMEZONE = 'Asia/Kolkata';

export class AutomationRegistry {
  private static scheduled = new Set<string>();

  static async load(): Promise<void> {
    let dirs: string[] = [];
    try {
      dirs = fs.readdirSync(AUTOMATIONS_DIR, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.name.startsWith('_'))
        .map((d) => d.name);
    } catch (e: any) {
      logger.error({ error: e.message, dir: AUTOMATIONS_DIR }, 'Automation registry: automations dir not found');
      return;
    }

    for (const slug of dirs) {
      try {
        await this.loadOne(slug);
      } catch (e: any) {
        logger.error({ slug, error: e.message }, 'Automation registry: failed to load automation');
      }
    }
    logger.info({ count: dirs.length }, 'Automation registry loaded');
  }

  private static async loadOne(slug: string): Promise<void> {
    const dir = path.join(AUTOMATIONS_DIR, slug);

    const readmePath = path.join(dir, 'README.md');
    if (!fs.existsSync(readmePath)) {
      logger.warn({ slug }, 'Automation registry: skipped — missing required README.md');
      return;
    }

    let fileDef: Partial<AutomationDefinition> = {};
    const rulePath = path.join(dir, 'rule.json');
    if (fs.existsSync(rulePath)) {
      try {
        fileDef = JSON.parse(fs.readFileSync(rulePath, 'utf8'));
      } catch (e: any) {
        logger.error({ slug, error: e.message }, 'Automation registry: invalid rule.json');
        return;
      }
    }

    let module: AutomationModule = {};
    try {
      module = await import(path.join(dir, 'index'));
    } catch (e: any) {
      // index.ts is optional — pure declarative automations don't need it.
      if (!String(e?.message ?? '').includes('Cannot find module')) {
        logger.warn({ slug, error: e?.message }, 'Automation registry: index.ts load warning');
      }
    }

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

    // Upsert file-owned fields; runtime-editable fields come from the DB.
    const row = await prisma.automation.upsert({
      where: { slug },
      update: {
        name: def.name,
        description: def.description,
        type: def.type,
        triggerJson: JSON.stringify(def.trigger),
        conditionJson: def.condition ? JSON.stringify(def.condition) : null,
        actionsJson: JSON.stringify(def.actions ?? []),
        dedupField: def.dedupField ?? null,
        readmePath,
      },
      create: {
        slug,
        name: def.name,
        description: def.description,
        type: def.type,
        triggerJson: JSON.stringify(def.trigger),
        conditionJson: def.condition ? JSON.stringify(def.condition) : null,
        actionsJson: JSON.stringify(def.actions ?? []),
        configJson: JSON.stringify(def.config ?? {}),
        dedupField: def.dedupField ?? null,
        enabled: def.enabled ?? true,
        cooldownMs: def.cooldownMs ?? 0,
        readmePath,
      },
    });

    // Runtime state wins: DB config (editable), enabled, cooldown.
    const dbConfig = row.configJson ? JSON.parse(row.configJson) : {};
    def.config = { ...(def.config ?? {}), ...dbConfig };
    def.enabled = row.enabled;
    if (row.cooldownMs !== 0) def.cooldownMs = row.cooldownMs;

    AutomationEngine.register(slug, def, module, row.id, row.enabled);

    this.schedule(slug, def);
    logger.info({ slug, type: def.type, trigger: def.trigger.type, enabled: def.enabled }, 'Automation registered');
  }

  private static schedule(slug: string, def: AutomationDefinition): void {
    if (this.scheduled.has(slug)) return;
    const t = def.trigger;

    const run = async () => {
      try {
        await AutomationEngine.scan(slug);
      } catch (e: any) {
        logger.error({ slug, error: e.message }, 'Automation scheduled run failed');
      }
    };

    if (t.type === 'schedule' && t.cron) {
      const crons = Array.isArray(t.cron) ? t.cron : [t.cron];
      crons.forEach((c) => cron.schedule(c, run, { timezone: TIMEZONE }));
      this.scheduled.add(slug);
    } else if (t.type === 'event_plus_scan' && t.fallbackCron) {
      cron.schedule(t.fallbackCron, run, { timezone: TIMEZONE });
      this.scheduled.add(slug);
    }
    // event-only automations get no cron; they fire via AutomationEngine.trigger().
  }
}
