/**
 * Admin API for the automation framework. The UI/dashboards are consumers of
 * these endpoints — automations expose state here, never the reverse.
 *
 *   GET    /api/automations          list all automations
 *   GET    /api/automations/:slug    detail + recent runs
 *   PATCH  /api/automations/:slug    enable/disable, set cooldown
 *   GET    /api/automations/:slug/data   dashboard data (opt-in via index.ts `data`)
 */
import { Router } from 'express';
import { prisma } from '../../shared/prisma';
import { logger } from '../../shared/logger';
import { AutomationEngine } from './engine';
import { DASHBOARD_SLUGS } from './dashboardSlugs';
import { asyncHandler } from '../../middleware/asyncHandler';

const router = Router();

function parseJson(value: string | null | undefined): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

router.get('/', asyncHandler(async (_req, res) => {
  const rows = await prisma.automation.findMany({ orderBy: { createdAt: 'asc' } });
  // Static + boot-independent so the "View Dashboard" button never flickers.
  const withDashboard = DASHBOARD_SLUGS;
  res.json(rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
    description: r.description,
    type: r.type,
    enabled: r.enabled,
    cooldownMs: r.cooldownMs,
    lastRunAt: r.lastRunAt,
    runCount: r.runCount,
    hasDashboard: withDashboard.has(r.slug),
    trigger: parseJson(r.triggerJson),
    condition: parseJson(r.conditionJson),
    actions: parseJson(r.actionsJson),
    config: parseJson(r.configJson),
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  })));
}));

router.get('/:slug', asyncHandler(async (req, res) => {
  const row = await prisma.automation.findUnique({
    where: { slug: String(req.params.slug) },
    include: { runs: { orderBy: { createdAt: 'desc' }, take: 20 } },
  });
  if (!row) {
    return res.status(404).json({ error: 'automation not found' });
  }
  res.json({
    ...row,
    trigger: parseJson(row.triggerJson),
    condition: parseJson(row.conditionJson),
    actions: parseJson(row.actionsJson),
    config: parseJson(row.configJson),
  });
}));

router.patch('/:slug', asyncHandler(async (req, res) => {
  const { enabled, cooldownMs } = req.body ?? {};
  const data: Record<string, unknown> = {};
  if (typeof enabled === 'boolean') {
    data.enabled = enabled;
    AutomationEngine.setEnabled(String(req.params.slug), enabled);
  }
  if (typeof cooldownMs === 'number') {
    data.cooldownMs = Math.max(0, Math.floor(cooldownMs));
  }
  if (Object.keys(data).length === 0) {
    return res.status(400).json({ error: 'nothing to update (use enabled or cooldownMs)' });
  }
  const row = await prisma.automation.update({ where: { slug: String(req.params.slug) }, data });
  logger.info({ slug: String(req.params.slug), data }, 'Automation updated via admin API');
  res.json(row);
}));

router.get('/:slug/data', asyncHandler(async (req, res) => {
  try {
    const data = await AutomationEngine.getData(String(req.params.slug), req.query as Record<string, any>);
    res.json(data);
  } catch (e: any) {
    res.status(404).json({ error: e?.message ?? 'no data provider' });
  }
}));

export default router;
