// ─────────────────────────────────────────────────────────────────────────────
// routes/estimates.ts — estimates payload, telecaller roster (MIS), assignment
// overrides, baseline snapshots, NeoDove report, Zoho classification, bulk-upsert.
// ─────────────────────────────────────────────────────────────────────────────
import type { Hono } from 'hono';
import { deps, requireSecret, requireMisScope, misScopeError, notifyLive, kolkataDateStr, getEstimatesPayload, refreshNeodoveReport, authStore, type Bindings } from '../context';
import {
  recordAssignment,
  markTelecallerAbsent,
  markTelecallerPresent,
  isPenaltiesEnabled,
  setPenaltiesEnabled,
  invalidateRiskCache,
} from '../../automations/telecalling/service';

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
    // Signed-up users by email — lets you see which roster agent is a real
    // platform user (for incentive/payout mapping).
    let usersByEmail = new Map<string, { id: string; email: string; name: string; isRoot: boolean }>();
    let usersByName = new Map<string, { id: string; email: string; name: string; isRoot: boolean }>();
    try {
      const users = await authStore(c).listUsers();
      for (const u of users as any[]) {
        const rec = { id: u.id, email: u.email, name: u.name, isRoot: !!u.isRoot };
        if (u.email) usersByEmail.set(String(u.email).toLowerCase(), rec);
        if (u.name) usersByName.set(String(u.name).toLowerCase().replace(/\s+/g, ''), rec);
      }
    } catch { /* user table unavailable — linkedUser stays null */ }

    // Resolve the signed-up user for a roster entry: exact email first, then a
    // loose NAME match ("muskan" → "Muskan", "samar" → "Samarjeet"). Some
    // agents signed up with an email different from their roster email, so the
    // name fallback keeps the "Signed-up platform user" badge accurate.
    const resolveLinkedUser = (t: any): { id: string; email: string; name: string; isRoot: boolean } | null => {
      if (t.email) {
        const byEmail = usersByEmail.get(String(t.email).toLowerCase().trim());
        if (byEmail) return byEmail;
      }
      if (t.name) {
        const norm = String(t.name).toLowerCase().replace(/\s+/g, '');
        const exact = usersByName.get(norm);
        if (exact) return exact;
        // prefix: roster name prefixes a signed-up name ("samar" → "Samarjeet")
        for (const [uname, u] of usersByName) {
          if (uname.startsWith(norm) && norm.length >= 3) return u;
        }
        // short form: signed-up name prefixes the roster name
        for (const [uname, u] of usersByName) {
          if (norm.startsWith(uname) && uname.length >= 3) return u;
        }
      }
      return null;
    };

    const withCounts = await Promise.all(
      tcs.map(async (t: any) => {
        const [totalAssigned, activeAssigned] = await Promise.all([
          prisma.estimateAssignment.count({ where: { telecallerId: t.id } }),
          prisma.estimateAssignment.count({ where: { telecallerId: t.id, status: 'assigned' } }),
        ]);
        const linkedUser = resolveLinkedUser(t);
        return { ...t, totalAssigned, activeAssigned, linkedUser };
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
        phone: body.phone ?? null,
        whatsapp: body.whatsapp ?? null,
        assignEstimateFollowUps: body.assignEstimateFollowUps ?? true,
        order: body.order ?? 0,
        neodoveUserId: body.neodoveUserId ?? null,
        neodoveUserName: body.neodoveUserName ?? null,
      },
    });
    return c.json(tc, 201);
  });

  // ── "Active Penalty" runtime toggle (MIS) ────────────────────────────────────
  // OFF (default) = no −15 snatch / −20 decline for anyone; +100 conversion
  // close always stays on. ON = penalties apply, except temp absent-cover holds
  // which are always penalty-free.
  // NOTE: registered BEFORE /api/telecallers/:id so 'penalty-mode' can never be
  // captured as an :id by a router that matches in registration order.
  app.get('/api/telecallers/penalty-mode', async (c) => {
    try { await requireMisScope(c); } catch (e) { return misScopeError(c, e); }
    return c.json({ enabled: await isPenaltiesEnabled() });
  });

  app.put('/api/telecallers/penalty-mode', async (c) => {
    try { await requireMisScope(c); } catch (e) { return misScopeError(c, e); }
    const body = await c.req.json().catch(() => ({}));
    if (typeof body.enabled !== 'boolean') return c.json({ error: 'enabled boolean required' }, 400);
    await setPenaltiesEnabled(body.enabled);
    notifyLive(c, { type: 'telecalling' });
    return c.json({ ok: true, enabled: body.enabled });
  });

  app.put('/api/telecallers/:id', async (c) => {
    try { await requireMisScope(c); } catch (e) { return misScopeError(c, e); }
    const { prisma } = deps();
    const body = await c.req.json().catch(() => ({}));
    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data.name = String(body.name).trim();
    if (body.email !== undefined) data.email = body.email;
    if (body.phone !== undefined) data.phone = body.phone;
    if (body.whatsapp !== undefined) data.whatsapp = body.whatsapp;
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

  // ── Absentee cover (MIS): mark absent → redistribute, present → return ──────
  app.post('/api/telecallers/:id/absent', async (c) => {
    try { await requireMisScope(c); } catch (e) { return misScopeError(c, e); }
    const body = await c.req.json().catch(() => ({}));
    const id = c.req.param('id');
    let result: Record<string, unknown>;
    if (body.absent === false) {
      result = await markTelecallerPresent(id);
      result = { absent: false, ...result };
    } else {
      result = { absent: true, ...(await markTelecallerAbsent(id)) };
    }
    notifyLive(c, { type: 'telecalling' });
    return c.json({ ok: true, ...result });
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
    const estimateId = c.req.param('id');
    const current = await prisma.estimate.findUnique({
      where: { estimateId },
      select: { assignedTelecallerId: true, skipAssignment: true, lockedTelecallerId: true },
    });
    if (!current) return c.json({ error: 'estimate not found' }, 404);

    // "Never assign" turned ON → the estimate leaves the assignment engine AND
    // drops its current holder right now, so no dashboard still shows an agent
    // on it. The open ledger row is closed for the same reason.
    if (data.skipAssignment === true && !current.skipAssignment) {
      data.assignedTelecallerId = null;
      await prisma.estimateAssignment.updateMany({
        where: { estimateId, status: 'assigned' },
        data: { status: 'resolved' },
      });
    }
    // "Never assign" turned OFF → hand the estimate straight back to whoever
    // held it last (latest ledger row) so the follow-up relationship resumes
    // instead of waiting for the next engine rotation to re-deal it.
    if (data.skipAssignment === false && current.skipAssignment) {
      const last = await prisma.estimateAssignment.findFirst({
        where: { estimateId },
        orderBy: { assignedAt: 'desc' },
      });
      if (last) {
        data.assignedTelecallerId = last.telecallerId;
        await recordAssignment(estimateId, last.telecallerId, 'MIS: never-assign removed — returned to previous holder');
      }
      // No history (never assigned before the skip): leave unassigned — the
      // engine deals it as a fresh candidate on its next run.
    }
    // Locking an agent applies IMMEDIATELY (the engines would enforce it on
    // their next run anyway — this keeps the dashboards honest right away).
    if (data.lockedTelecallerId && data.lockedTelecallerId !== current.assignedTelecallerId) {
      const lockedId = String(data.lockedTelecallerId);
      data.assignedTelecallerId = lockedId;
      await recordAssignment(estimateId, lockedId, 'MIS lock applied');
    }
    const est = await prisma.estimate.update({
      where: { estimateId },
      data,
    });
    try { await invalidateRiskCache(); } catch { /* non-fatal */ }
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

  // ── Lead-details storage (GH runner extracts from Zoho comments) ─────────────
  // AI retry budget: each runner pass that processes an estimate but extracts
  // <3 fields consumes one attempt (detailsAttempts + 1). At
  // MAX_DETAILS_ATTEMPTS the estimate is marked detailsFailed and leaves the
  // 15-min capture loop for good (UI shows "Details unavailable"). A later
  // >=3-field capture still stores and resets the budget.
  const MAX_DETAILS_ATTEMPTS = 10;
  app.post('/api/runner/estimates/lead-details', async (c) => {
    if (!requireSecret(c)) return c.text('Unauthorized', 401);
    const { prisma } = deps();
    const body = await c.req.json().catch(() => ({}));
    const rows = Array.isArray(body.rows) ? body.rows : [];
    let updated = 0;
    let attempted = 0;
    let failed = 0;
    // "Lead generated by": the runner extracts the agent NAME from the first
    // comments; map it to a Telecaller id here (never invent a holder).
    const norm = (s: any) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const idByName = new Map<string, string>();
    try {
      const telecallers = await prisma.telecaller.findMany({ where: { deleted: false } });
      for (const t of telecallers as any[]) {
        if (t?.name) idByName.set(norm(t.name), String(t.id));
      }
    } catch (e: any) {
      console.warn({ err: e?.message }, 'lead-details: roster unavailable — creator mapping skipped');
    }
    for (const r of rows) {
      if (!r?.estimateId) continue;
      const data: Record<string, unknown> = {};
      if (r.enquiryNumber !== undefined) data.enquiryNumber = r.enquiryNumber ? String(r.enquiryNumber) : null;
      if (r.sourceLead !== undefined) data.sourceLead = r.sourceLead ? String(r.sourceLead) : null;
      if (r.location !== undefined) data.location = r.location ? String(r.location) : null;
      if (r.contactName !== undefined) data.contactName = r.contactName ? String(r.contactName) : null;
      if (r.contactPhone !== undefined) data.contactPhone = r.contactPhone ? String(r.contactPhone) : null;
      if (r.contactEmail !== undefined) data.contactEmail = r.contactEmail ? String(r.contactEmail) : null;
      const creatorName = String(r.leadGeneratedBy || '').trim();
      if (creatorName) {
        const creatorId = idByName.get(norm(creatorName));
        if (creatorId) data.createdBy = creatorId;
      }
      const detailFields = [
        r.enquiryNumber, r.sourceLead, r.location, r.contactName,
        r.contactPhone, r.contactEmail, r.leadGeneratedBy,
      ].filter((v: any) => v !== undefined && v !== null && String(v).length > 0);
      // Validity gate: only a capture with >= 3 non-empty fields is significant.
      // Fewer than 3 is judged invalid — it consumes one AI retry attempt instead
      // of storing. At MAX_DETAILS_ATTEMPTS the estimate gives up (detailsFailed)
      // and leaves the capture loop; the UI shows "Details unavailable".
      if (detailFields.length < 3) {
        attempted++;
        try {
          const cur = await prisma.estimate.findUnique({
            where: { estimateId: r.estimateId },
            select: { detailsAttempts: true, detailsCaptured: true, detailsFailed: true },
          });
          if (cur && !cur.detailsCaptured) {
            const attempts = (Number((cur as any).detailsAttempts) || 0) + 1;
            const nowFailed = attempts >= MAX_DETAILS_ATTEMPTS;
            await prisma.estimate.update({
              where: { estimateId: r.estimateId },
              data: {
                detailsAttempts: attempts,
                detailsFailed: nowFailed ? true : (cur as any).detailsFailed,
              },
            });
            if (nowFailed && !(cur as any).detailsFailed) failed++;
          }
        } catch (e: any) {
          console.warn({ err: e?.message, estimateId: r.estimateId }, 'lead-details attempt-count update failed');
        }
        continue;
      }
      // Stop the 15-min capture loop once 3+ detail fields are stored. A success
      // also resets the retry budget (recovers a prior give-up — e.g. the agent
      // posted the lead block in a new comment and the runner re-admitted it).
      data.detailsCaptured = true;
      data.detailsAttempts = 0;
      data.detailsFailed = false;
      try {
        await prisma.estimate.update({ where: { estimateId: r.estimateId }, data });
        updated++;
      } catch (e: any) {
        console.warn({ err: e?.message, estimateId: r.estimateId }, 'lead-details update failed');
      }
    }
    if (updated > 0 || failed > 0) {
      // Both the ZohoEstimates view and the TelecallingDashboard follow-ups show
      // these chips — broadcast both types so each open tab refetches (the
      // telecalling dashboards subscribe narrowly to automation/telecalling).
      notifyLive(c, { type: 'estimates' });
      notifyLive(c, { type: 'telecalling' });
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
    if (upserted > 0 || lastSyncAt) {
      const { invalidateDerivedEstimateCaches } = require('../../shared/estimates-cache');
      await invalidateDerivedEstimateCaches();
    }
    return c.json({ ok: true, count: upserted });
  });
}