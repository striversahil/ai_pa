// ─────────────────────────────────────────────────────────────────────────────
// routes/estimates.ts — estimates payload + lookup, CRM manual order actions,
// baseline snapshots, NeoDove report, Zoho classification, bulk-upsert.
// Telecaller roster/assignment/call-tag/next-step handlers live in
// routes/telecalling.ts (Phase-3 split). URLs unchanged.
// ─────────────────────────────────────────────────────────────────────────────
import type { Hono } from 'hono';
import { deps, requireSecret, requireMisScope, misScopeError, notifyLive, LiveEvent, kolkataDateStr, getEstimatesPayload, refreshNeodoveReport, authStore, getMe, isApproved, readSessionCookie, type Bindings } from '../context';

export function registerEstimatesRoutes(app: Hono<{ Bindings: Bindings }>): void {
  // ── Estimates ───────────────────────────────────────────────────────────────
  app.get('/api/estimates', async (c) => {
    return c.json(await getEstimatesPayload());
  });

  // ── B2B EST-No. lookup (Check button): does the Zoho estimate exist and
  // who holds it? Read-only, same login gate as /api/estimates.
  app.get('/api/estimates/lookup', async (c) => {
    const num = String(c.req.query('number') ?? c.req.query('estNumber') ?? '');
    if (!num.trim()) return c.json({ found: false, error: 'number required' }, 400);
    try {
      const { lookupEstimateStatus } = await import('../../modules/enquiries/estimate-link');
      return c.json(await lookupEstimateStatus(num));
    } catch (e: any) {
      return c.json({ found: false, error: e?.message || 'lookup failed' }, 500);
    }
  });

  // ── CRM manual order actions (local override layer) ─────────────────────────
  // MIS operators advance/cancel a sales order from the CRM dashboard. The
  // action is recorded in CrmOrderAction; the next crm-runner tick applies the
  // latest action per SO on top of Zoho's raw status, so the snapshot reflects
  // the manual change and the points diff scores it automatically.
  app.post('/api/crm/actions', async (c) => {
    try { await requireMisScope(c); } catch (e) { return misScopeError(c, e); }
    const body = await c.req.json().catch(() => ({}));
    const soNumber = String(body?.soNumber || '').trim();
    const action = String(body?.action || '').trim().toLowerCase();
    const toStage = String(body?.toStage || action || '').trim().toLowerCase();
    const reason = typeof body?.reason === 'string' ? body.reason.slice(0, 500) : null;
    const VALID = new Set(['confirm', 'invoice', 'ship', 'payment', 'complete', 'cancel', 'void']);
    if (!soNumber) return c.json({ error: 'soNumber required' }, 400);
    if (!VALID.has(action) || !VALID.has(toStage)) {
      return c.json({ error: 'action/toStage must be one of confirm|invoice|ship|payment|complete|cancel|void' }, 400);
    }
    const { prisma } = deps();
    const me = await getMe(authStore(c), readSessionCookie(c.req.header('cookie') ?? null));
    const actor = me?.user?.name || me?.user?.email || 'MIS';
    // Resolve the stage the order is currently in (for the fromStage audit).
    let fromStage: string | null = null;
    try {
      const { cacheGet }: { cacheGet: <T>(key: string, ttlMs: number) => Promise<T | null> } = require('../../shared/cache');
      const snap: any = await cacheGet('crm:salesorders_snapshot', 24 * 60 * 60 * 1000);
      if (Array.isArray(snap?.index)) {
        const hit = snap.index.find((e: any) => String(e?.so) === soNumber);
        if (hit?.stage) fromStage = String(hit.stage);
      }
    } catch { /* snapshot unavailable — fromStage stays null */ }
    const day = kolkataDateStr();
    const row = await prisma.crmOrderAction.create({
      data: {
        id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        soNumber, action, fromStage, toStage, reason, actor, day,
        createdAt: new Date(),
      },
    });
    notifyLive(c, { type: LiveEvent.Crm, soNumber, action });
    return c.json({ ok: true, action: row });
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
      organizationId: (e as any).organizationId ?? '',
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
    // Auto-add new NeoDove users as additional roster entries (assignEstimateFollowUps=0,
    // deleted=0) so a new hire like Piyush auto-appears in the roster without manual
    // INSERT — same as the 2026-09-17 manual Piyush 6e3800aa…/13889a99… add.
    try {
      const nowIso = new Date().toISOString();
      const existing = await (prisma as any).telecaller.findMany({ select: { neodoveUserId: true } });
      const have = new Set((existing as any[]).map((r) => String(r.neodoveUserId ?? '')).filter(Boolean));
      const existingByName = new Set((await (prisma as any).telecaller.findMany({ select: { name: true } })).map((r: any) => String(r.name ?? '').toLowerCase().trim()));
      let maxOrder = 0;
      try {
        const all = await (prisma as any).telecaller.findMany({ select: { order: true } });
        for (const r of all as any[]) maxOrder = Math.max(maxOrder, Number((r as any).order ?? 0));
      } catch {}
      let added = 0;
      for (const r of rows as any[]) {
        const uid = String(r?.userId ?? '').trim();
        const uname = String(r?.userName ?? '').trim();
        if (!uid || !uname || have.has(uid)) continue;
        if (existingByName.has(uname.toLowerCase())) continue;
        const id = (globalThis as any).crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;
        await (prisma as any).telecaller.create({
          data: { id, name: uname, neodoveUserId: uid, neodoveUserName: uname, assignEstimateFollowUps: false, order: maxOrder + 1 + added, createdAt: nowIso, deleted: false },
        });
        added++;
        have.add(uid);
      }
      if (added > 0) {
        const { invalidateRiskCache } = require('../../automations/telecalling/service');
        try { await invalidateRiskCache(); } catch {}
      }
    } catch (e) { console.warn('neodove auto-add roster failed', e); }
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

  // ── Lead-details storage (GH runner extracts from Zoho comments) ─────────────
  // Logic lives in src/modules/estimates/lead-details.ts (shared with the
  // Express alt-runtime); this route is auth + broadcast + invalidation only.
  app.post('/api/runner/estimates/lead-details', async (c) => {
    if (!requireSecret(c)) return c.text('Unauthorized', 401);
    const body = await c.req.json().catch(() => ({}));
    const rows = Array.isArray(body.rows) ? body.rows : [];
    const { applyLeadDetails } = await import('../../modules/estimates/lead-details');
    const { updated, attempted, failed } = await applyLeadDetails(rows);
    if (updated > 0 || failed > 0) {
      // Both the ZohoEstimates view and the TelecallingDashboard follow-ups show
      // these chips — broadcast both types so each open tab refetches (the
      // telecalling dashboards subscribe narrowly to automation/telecalling).
      notifyLive(c, { type: 'estimates' });
      notifyLive(c, { type: LiveEvent.Telecalling });
      // The estimates payload and the telecalling dashboard/risk/KRA caches
      // derive from these rows — invalidate or they go stale for the KV TTL.
      const { invalidateDerivedEstimateCaches } = require('../../shared/estimates-cache');
      await invalidateDerivedEstimateCaches();
    }
    return c.json({ ok: true, count: updated, attempted, failed });
  });

  app.post('/api/estimates/bulk-upsert', async (c) => {
    if (!requireSecret(c)) return c.text('Unauthorized', 401);
    const { prisma } = deps();
    const body = await c.req.json();
    const { estimates, lastSyncAt, primaryOrg } = body;
    // Multi-org guard: the first organization_id in sent_estimates.txt is the
    // primary (bare DB ids). A reordered org file would fork every row into
    // duplicates — reject it loudly instead of corrupting identities.
    if (typeof primaryOrg === 'string' && primaryOrg) {
      const prev = await prisma.setting.findUnique({ where: { key: 'zoho:primary_org' } }).catch(() => null);
      if (!prev) {
        await prisma.setting.upsert({
          where: { key: 'zoho:primary_org' },
          update: { value: primaryOrg },
          create: { key: 'zoho:primary_org', value: primaryOrg },
        });
      } else if (prev.value !== primaryOrg) {
        return c.json({ error: `primary org changed (${prev.value} → ${primaryOrg}) — reorder sent_estimates.txt (BUI first) or migrate identities`, primaryOrg: prev.value }, 409);
      }
    }
    let upserted = 0;
    if (estimates && Array.isArray(estimates)) {
      for (const est of estimates) {
        // organizationId is write-once identity: never overwrite a set value
        // with '' (legacy/unknown) — that would orphan namespaced rows.
        const org = typeof est.organizationId === 'string' && est.organizationId ? est.organizationId : undefined;
        await prisma.estimate.upsert({
          where: { estimateId: est.estimateId },
          update: {
            estimateNumber: est.estimateNumber,
            customerName: est.customerName,
            total: est.total,
            date: est.date,
            status: est.status,
            skipMatching: est.skipMatching || 0,
            ...(org ? { organizationId: org } : {}),
          },
          create: {
            estimateId: est.estimateId,
            estimateNumber: est.estimateNumber,
            customerName: est.customerName,
            total: est.total,
            date: est.date,
            status: est.status,
            skipMatching: est.skipMatching || 0,
            organizationId: org || '',
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
    if (upserted > 0 || lastSyncAt) {
      const { invalidateDerivedEstimateCaches } = require('../../shared/estimates-cache');
      await invalidateDerivedEstimateCaches();
    }
    return c.json({ ok: true, count: upserted });
  });
}