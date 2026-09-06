// ─────────────────────────────────────────────────────────────────────────────
// routes/estimates.ts — estimates payload, telecaller roster (MIS), assignment
// overrides, baseline snapshots, NeoDove report, Zoho classification, bulk-upsert.
// ─────────────────────────────────────────────────────────────────────────────
import type { Hono } from 'hono';
import { deps, requireSecret, requireMisScope, misScopeError, notifyLive, kolkataDateStr, getEstimatesPayload, refreshNeodoveReport, type Bindings } from '../context';

export function registerEstimatesRoutes(app: Hono<{ Bindings: Bindings }>): void {
  // ── Estimates ───────────────────────────────────────────────────────────────
  app.get('/api/estimates', async (c) => {
    return c.json(await getEstimatesPayload());
  });

  // ── Telecaller roster (estimate auto-assignment) ──────────────────────────────
  app.get('/api/telecallers', async (c) => {
    try { await requireMisScope(c); } catch (e) { return misScopeError(c, e); }
    const { prisma } = deps();
    const showDeleted = c.req.query('deleted') === '1';
    const tcs = await prisma.telecaller.findMany({
      where: { deleted: showDeleted },
      orderBy: { order: 'asc' },
    });
    const withCounts = await Promise.all(
      tcs.map(async (t: any) => {
        const [totalAssigned, activeAssigned] = await Promise.all([
          prisma.estimateAssignment.count({ where: { telecallerId: t.id } }),
          prisma.estimateAssignment.count({ where: { telecallerId: t.id, status: 'assigned' } }),
        ]);
        return { ...t, totalAssigned, activeAssigned };
      }),
    );
    return c.json({ telecallers: withCounts });
  });

  app.post('/api/telecallers', async (c) => {
    try { await requireMisScope(c); } catch (e) { return misScopeError(c, e); }
    const { prisma } = deps();
    const body = await c.req.json().catch(() => ({}));
    if (!body?.name) return c.json({ error: 'name required' }, 400);
    const tc = await prisma.telecaller.create({
      data: {
        name: String(body.name).trim(),
        email: body.email ?? null,
        assignEstimateFollowUps: body.assignEstimateFollowUps ?? true,
        order: body.order ?? 0,
        neodoveUserId: body.neodoveUserId ?? null,
        neodoveUserName: body.neodoveUserName ?? null,
      },
    });
    return c.json(tc, 201);
  });

  app.put('/api/telecallers/:id', async (c) => {
    try { await requireMisScope(c); } catch (e) { return misScopeError(c, e); }
    const { prisma } = deps();
    const body = await c.req.json().catch(() => ({}));
    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data.name = String(body.name).trim();
    if (body.email !== undefined) data.email = body.email;
    if (body.assignEstimateFollowUps !== undefined) data.assignEstimateFollowUps = body.assignEstimateFollowUps;
    if (body.order !== undefined) data.order = body.order;
    if (body.neodoveUserId !== undefined) data.neodoveUserId = body.neodoveUserId;
    if (body.neodoveUserName !== undefined) data.neodoveUserName = body.neodoveUserName;
    if (body.deleted !== undefined) {
      data.deleted = !!body.deleted;
      if (body.deleted === false && body.assignEstimateFollowUps === undefined) data.assignEstimateFollowUps = false;
    }
    const tc = await prisma.telecaller.update({ where: { id: c.req.param('id') }, data });
    return c.json(tc);
  });

  app.delete('/api/telecallers/:id', async (c) => {
    try { await requireMisScope(c); } catch (e) { return misScopeError(c, e); }
    const { prisma } = deps();
    await prisma.telecaller.update({
      where: { id: c.req.param('id') },
      data: { deleted: true, assignEstimateFollowUps: false },
    });
    return c.json({ ok: true });
  });

  // ── MIS estimate assignment overrides ────────────────────────────────────────
  app.get('/api/estimates/assignment-overrides', async (c) => {
    try { await requireMisScope(c); } catch (e) { return misScopeError(c, e); }
    const { prisma } = deps();
    const q = String(c.req.query('q') ?? '').trim();
    const modifiedOnly = c.req.query('modified') === '1';
    let where: any;
    if (modifiedOnly) {
      where = { OR: [{ lockedTelecallerId: { not: null } }, { skipAssignment: true }] };
    } else if (q) {
      where = {
        OR: [
          { estimateId: { contains: q } },
          { estimateNumber: { contains: q } },
          { customerName: { contains: q } },
        ],
      };
    }
    const rows = await prisma.estimate.findMany({
      where,
      orderBy: [{ date: 'desc' }],
      take: modifiedOnly ? 200 : q ? 25 : 100,
      select: {
        estimateId: true,
        estimateNumber: true,
        customerName: true,
        status: true,
        total: true,
        date: true,
        assignedTelecallerId: true,
        lockedTelecallerId: true,
        skipAssignment: true,
      },
    });
    return c.json({ estimates: rows });
  });

  app.put('/api/estimates/:id/assignment-override', async (c) => {
    try { await requireMisScope(c); } catch (e) { return misScopeError(c, e); }
    const { prisma } = deps();
    const body = await c.req.json().catch(() => ({}));
    const data: Record<string, unknown> = {};
    if (body.lockedTelecallerId !== undefined) data.lockedTelecallerId = body.lockedTelecallerId ? String(body.lockedTelecallerId) : null;
    if (body.skipAssignment !== undefined) data.skipAssignment = !!body.skipAssignment;
    if (Object.keys(data).length === 0) return c.json({ error: 'nothing to update' }, 400);
    const est = await prisma.estimate.update({
      where: { estimateId: c.req.param('id') },
      data,
    });
    notifyLive(c, { type: 'telecalling' });
    return c.json(est);
  });

  // ── Baseline snapshot (frozen daily at 1 AM IST) ────────────────────────────
  app.post('/api/runner/estimates/baseline', async (c) => {
    if (!requireSecret(c)) return c.text('Unauthorized', 401);
    const { prisma } = deps();
    const estimates = await prisma.estimate.findMany({ where: { status: 'sent' } });
    const baseline = estimates.map((e: any) => ({
      estimateId: e.estimateId,
      estimateNumber: e.estimateNumber,
      customerName: e.customerName,
      total: e.total,
      status: e.status,
    }));
    const key = `zoho_baseline:${kolkataDateStr()}`;
    await prisma.setting.upsert({
      where: { key },
      update: { value: JSON.stringify(baseline) },
      create: { key, value: JSON.stringify(baseline) },
    });
    notifyLive(c, { type: 'baseline', date: key.slice('zoho_baseline:'.length) });
    return c.json({ ok: true, key, count: baseline.length });
  });

  app.get('/api/estimates/baseline', async (c) => {
    const { prisma } = deps();
    const prefix = 'zoho_baseline:';
    const todayKey = `${prefix}${kolkataDateStr()}`;
    let row = await prisma.setting.findUnique({ where: { key: todayKey } });
    let isStale = false;
    if (!row?.value) {
      row = await prisma.setting.findFirst({
        where: { key: { startsWith: prefix } },
        orderBy: { key: 'desc' },
      });
      isStale = true;
    }
    const date = row?.key.slice(prefix.length) ?? null;
    try {
      return c.json({ date, isStale, baseline: row?.value ? JSON.parse(row.value) : null });
    } catch {
      return c.json({ date, isStale: true, baseline: null });
    }
  });

  // ── NeoDove daily user/call report ──────────────────────────────────────────
  app.post('/api/runner/neodove-refresh', async (c) => {
    if (!requireSecret(c)) return c.text('Unauthorized', 401);
    try {
      const body = await c.req.json().catch(() => ({}));
      const result = await refreshNeodoveReport(typeof body?.date === 'string' ? body.date : undefined);
      return c.json(result, result.ok ? 200 : 502);
    } catch (e: any) {
      return c.json({ ok: false, error: e?.message || String(e) }, 500);
    }
  });

  app.post('/api/runner/neodove/report', async (c) => {
    if (!requireSecret(c)) return c.text('Unauthorized', 401);
    const { prisma } = deps();
    const body = await c.req.json().catch(() => ({}));
    const reportDate = String(body?.reportDate || kolkataDateStr());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) return c.json({ error: 'reportDate must be YYYY-MM-DD' }, 400);
    const rows = body?.report?.rows;
    if (!Array.isArray(rows)) return c.json({ error: 'report.rows[] required' }, 400);
    const key = `neodove_user_report:${reportDate}`;
    const value = JSON.stringify({ reportDate, fetchedAt: new Date().toISOString(), rows });
    await prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
    notifyLive(c, { type: 'neodove', date: reportDate });
    const { invalidateNeodoveCache } = require('../../automations/neodove-telecaller-report');
    await invalidateNeodoveCache();
    return c.json({ ok: true, key, count: rows.length });
  });

  app.get('/api/neodove/report', async (c) => {
    if (!requireSecret(c)) return c.text('Unauthorized', 401);
    const { prisma } = deps();
    const dateParam = c.req.query('date');
    let row: any;
    if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      row = await prisma.setting.findUnique({ where: { key: `neodove_user_report:${dateParam}` } });
    } else {
      const rows = await prisma.setting.findMany({
        where: { key: { startsWith: 'neodove_user_report:' } },
        orderBy: { key: 'desc' },
        take: 1,
      });
      row = rows[0];
    }
    if (!row?.value) return c.json({ error: 'no neodove report found' }, 404);
    try {
      return c.json(JSON.parse(row.value));
    } catch {
      return c.json({ error: 'corrupt report row' }, 500);
    }
  });

  // ── Zoho Estimate AI Classification (GitHub Actions) ──────────────────────────
  app.post('/api/estimates/classify', async (c) => {
    if (!requireSecret(c)) return c.text('Unauthorized', 401);
    const { prisma } = deps();
    const body = await c.req.json();
    const { estimateId, badgeResult, journeyResult } = body;
    if (!estimateId || !badgeResult) return c.json({ error: 'estimateId + badgeResult required' }, 400);

    await prisma.classification.upsert({
      where: { estimateId },
      update: {
        meaningfulUpdate: !!badgeResult.meaningful_update,
        notAnswering: badgeResult.not_answering ? 'Yes' : 'No',
        movingSlow: 'No',
        underDiscussion: badgeResult.under_discussion ? 'Yes' : 'No',
        confirm: badgeResult.confirm ? 'Yes' : 'No',
        intentScore: journeyResult?.intent_score ?? 2,
        reasoning: badgeResult.reasoning || 'AI classification',
        summary: journeyResult?.summary || '',
        processedAt: new Date(),
      },
      create: {
        estimateId,
        meaningfulUpdate: !!badgeResult.meaningful_update,
        notAnswering: badgeResult.not_answering ? 'Yes' : 'No',
        movingSlow: 'No',
        underDiscussion: badgeResult.under_discussion ? 'Yes' : 'No',
        confirm: badgeResult.confirm ? 'Yes' : 'No',
        intentScore: journeyResult?.intent_score ?? 2,
        reasoning: badgeResult.reasoning || 'AI classification',
        summary: journeyResult?.summary || '',
        processedAt: new Date(),
      },
    });
    await prisma.estimate.update({ where: { estimateId }, data: { lastSyncTime: new Date() } });
    notifyLive(c, { type: 'estimates' });
    return c.json({ ok: true });
  });

  app.post('/api/estimates/bulk-upsert', async (c) => {
    if (!requireSecret(c)) return c.text('Unauthorized', 401);
    const { prisma } = deps();
    const body = await c.req.json();
    const { estimates, lastSyncAt } = body;
    let upserted = 0;
    if (estimates && Array.isArray(estimates)) {
      for (const est of estimates) {
        await prisma.estimate.upsert({
          where: { estimateId: est.estimateId },
          update: {
            estimateNumber: est.estimateNumber,
            customerName: est.customerName,
            total: est.total,
            date: est.date,
            status: est.status,
            skipMatching: est.skipMatching || 0,
          },
          create: {
            estimateId: est.estimateId,
            estimateNumber: est.estimateNumber,
            customerName: est.customerName,
            total: est.total,
            date: est.date,
            status: est.status,
            skipMatching: est.skipMatching || 0,
            lastSyncTime: new Date(),
          },
        });
        upserted++;
      }
    }
    if (lastSyncAt) {
      await prisma.setting.upsert({
        where: { key: 'sales_copilot:last_complete_sync_at' },
        update: { value: lastSyncAt },
        create: { key: 'sales_copilot:last_complete_sync_at', value: lastSyncAt },
      });
    }
    notifyLive(c, { type: 'estimates' });
    const { invalidateDerivedEstimateCaches } = require('../../shared/estimates-cache');
    await invalidateDerivedEstimateCaches();
    return c.json({ ok: true, count: upserted });
  });
}