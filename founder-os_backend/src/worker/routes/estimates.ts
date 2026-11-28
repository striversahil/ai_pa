// ─────────────────────────────────────────────────────────────────────────────
// routes/estimates.ts — estimates payload + lookup, CRM manual order actions,
// baseline snapshots, Zoho classification, bulk-upsert.
// Telecaller roster/assignment/call-tag/next-step handlers live in
// routes/telecalling.ts (Phase-3 split). URLs unchanged.
// ─────────────────────────────────────────────────────────────────────────────
import type { Hono } from 'hono';
import { deps, requireSecret, adminGuard, notifyLive, LiveEvent, kolkataDateStr, getEstimatesPayload, type Bindings } from '../context';
import { getViewerMe } from '../viewer';
import { readBody } from '../http';

export function registerEstimatesRoutes(app: Hono<{ Bindings: Bindings }>): void {
  // ── Runner roster (Zoho sync agent attribution) ────────────────────────────
  // The HR register is the only roster; runners never call a dialer portal.
  app.get('/api/runner/roster', async (c) => {
    if (!requireSecret(c)) return c.text('Unauthorized', 401);
    const { prisma } = deps();
    const rows: any[] = await prisma.telecaller.findMany({
      where: { deleted: false },
      select: { name: true },
      orderBy: { order: 'asc' },
    });
    const names = [...new Set(rows.map((r) => String(r?.name ?? '').trim()).filter(Boolean))];
    return c.json({ names });
  });

  // ── Estimates ───────────────────────────────────────────────────────────────
  app.get('/api/estimates', async (c) => {
    return c.json(await getEstimatesPayload());
  });

  // ── Analyzer segments (consumer/reseller per estimate; login-gated like /api/estimates)
  app.get('/api/estimates/segments', async (c) => {
    try {
      const { getEstimateSegments } = await import('../../modules/estimates/segments');
      return c.json(await getEstimateSegments());
    } catch (e: any) {
      return c.json({ error: e?.message || 'segments failed' }, 500);
    }
  });

  // ── Analyzer movement (custom-range SO counts; login-gated like /api/estimates)
  app.get('/api/estimates/movement', async (c) => {
    try {
      const { getSalesOrderMovement } = await import('../../modules/estimates/movement');
      const q = c.req.query();
      return c.json(await getSalesOrderMovement({ from: q.from, to: q.to, region: q.region, org: q.org }));
    } catch (e: any) {
      return c.json({ error: e?.message || 'movement failed' }, 500);
    }
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
  // Root operators advance/cancel a sales order from the CRM dashboard. The
  // action is recorded in CrmOrderAction; the next crm-runner tick applies the
  // latest action per SO on top of Zoho's raw status, so the snapshot reflects
  // the manual change and the points diff scores it automatically.
  app.post('/api/crm/actions', async (c) => {
    const denied = await adminGuard(c); if (denied) return denied;
    const body = await readBody(c);
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
    const me = await getViewerMe(c);
    const actor = me?.user?.name || me?.user?.email || 'root';
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
    const body = await readBody(c);
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
        const existing: any = await prisma.estimate
          .findUnique({ where: { estimateId: est.estimateId }, select: { status: true, acceptedAt: true } })
          .catch(() => null);
        if (!existing) {
          // New row. `acceptedAt`/`declinedAt` mirror what status-sync would
          // have stamped; bulk-upsert is a metadata path, but a row can
          // legitimately arrive already accepted/declined (historical
          // backfill), so stamp it here too.
          const isClose = est.status === 'accepted' || est.status === 'confirmed';
          const isDeclined = String(est.status ?? '').toLowerCase() === 'declined';
          await prisma.estimate.upsert({
            where: { estimateId: est.estimateId },
            update: {},
            create: {
              estimateId: est.estimateId,
              estimateNumber: est.estimateNumber,
              customerName: est.customerName,
              total: est.total,
              date: est.date,
              status: est.status,
              ...(isClose ? { acceptedAt: kolkataDateStr() } : {}),
              ...(isDeclined ? { declinedAt: kolkataDateStr() } : {}),
              skipMatching: est.skipMatching || 0,
              organizationId: org || '',
              lastSyncTime: new Date(),
            },
          });
          if (isClose) {
            try {
              const { recordConversionClose } = await import('../../automations/telecalling/service');
              await recordConversionClose(String(est.estimateId));
            } catch { /* non-fatal — the board reads acceptedAt, not the ledger */ }
          }
        } else {
          // EXISTING row: metadata only. Status is owned by applyStatusUpdates
          // (stamps acceptedAt + credits the close). Silently writing status
          // here was how accepted estimates ended up with no won-on day.
          await prisma.estimate.update({
            where: { estimateId: est.estimateId },
            data: {
              estimateNumber: est.estimateNumber,
              customerName: est.customerName,
              total: est.total,
              date: est.date,
              skipMatching: est.skipMatching || 0,
              ...(org ? { organizationId: org } : {}),
            },
          });
          if (est.status && String(est.status) !== String(existing.status ?? '')) {
            const { applyStatusUpdates } = await import('../../modules/estimates/status-sync');
            await applyStatusUpdates([{ estimateId: String(est.estimateId), status: String(est.status) }]);
          }
        }
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
    // Phase 3c dual-write: project the synced batch into core_sale (covers
    // creates + metadata edits; status changes already mirrored via
    // applyStatusUpdates above — re-mirroring is idempotent).
    try {
      const { mirrorSales } = await import('../../modules/core/sales');
      const ids = Array.isArray(estimates) ? estimates.map((e: any) => String(e?.estimateId ?? '')).filter(Boolean) : [];
      if (ids.length) await mirrorSales(ids);
    } catch { /* non-fatal */ }
    // Phase 7b dual-write: same batch into core_lead (estimate rows own the
    // lead; outcome derives from live status — idempotent).
    try {
      const { mirrorLeadsForEstimates } = await import('../../modules/core/leads');
      const ids = Array.isArray(estimates) ? estimates.map((e: any) => String(e?.estimateId ?? '')).filter(Boolean) : [];
      if (ids.length) await mirrorLeadsForEstimates(ids);
    } catch { /* non-fatal */ }
    notifyLive(c, { type: 'estimates' });
    if (upserted > 0 || lastSyncAt) {
      const { invalidateDerivedEstimateCaches } = require('../../shared/estimates-cache');
      await invalidateDerivedEstimateCaches();
    }
    return c.json({ ok: true, count: upserted });
  });
}