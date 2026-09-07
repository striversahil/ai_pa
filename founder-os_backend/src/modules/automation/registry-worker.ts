/**
 * Worker-safe automation registry: consumes the AUTO-GENERATED registry
 * (registry.generated.ts, produced by scripts/gen-automation-registry.mjs at
 * build time). Every folder under src/automations/ is discovered automatically —
 * adding a new automation directory requires NO manual registry edits.
 */
import { logger } from '../../shared/logger';
import { prisma } from '../../shared/prisma';
import type { AutomationDefinition, AutomationModule } from './types';
import { AutomationEngine } from './engine';
import { AUTOMATION_MODULES, AUTOMATION_RULES } from './registry.generated';

export class AutomationRegistry {
  static async load(): Promise<void> {
    // Parallel: each loadOne is an independent D1 upsert; sequential awaits
    // serialized 12 round trips and dominated cold-start latency.
    await Promise.all(
      Object.entries(AUTOMATION_RULES).map(async ([slug, fileDef]) => {
        try {
          await this.loadOne(slug, fileDef);
        } catch (e: any) {
          logger.error({ slug, error: e.message }, 'Automation registry: failed to load automation');
        }
      }),
    );
    logger.info({ count: Object.keys(AUTOMATION_RULES).length }, 'Automation registry loaded');
  }

  private static async loadOne(slug: string, fileDef: Partial<AutomationDefinition>): Promise<void> {
    const module: AutomationModule = AUTOMATION_MODULES[slug] ?? {};

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