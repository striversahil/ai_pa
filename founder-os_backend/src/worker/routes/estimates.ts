// ─────────────────────────────────────────────────────────────────────────────
// routes/estimates.ts — estimates payload, telecaller roster (MIS), assignment
// overrides, baseline snapshots, NeoDove report, Zoho classification, bulk-upsert.
// ─────────────────────────────────────────────────────────────────────────────
import type { Hono } from 'hono';
import { deps, requireSecret, requireMisScope, misScopeError, notifyLive, LiveEvent, kolkataDateStr, getEstimatesPayload, refreshNeodoveReport, authStore, getMe, isApproved, readSessionCookie, type Bindings } from '../context';
import {
  recordAssignment,
  markTelecallerAbsent,
  markTelecallerPresent,
  isPenaltiesEnabled,
  setPenaltiesEnabled,
  isEodReassignEnabled,
  setEodReassignEnabled,
  bulkAssignEstimates,
  setEstimateCallTag,
  invalidateRiskCache,
} from '../../automations/telecalling/service';
import { evaluateShield } from '../../automations/telecalling/effort-shield';
import { normPhone10, readEffortSnapshot, EFFORT_AUTH_KEY, type EffortRow } from '../../automations/telecalling/effort-sync';

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
    // Roster feeds the cached leaderboard agent list — invalidate + go live.
    try { await invalidateRiskCache(); } catch { /* non-fatal */ }
    notifyLive(c, { type: LiveEvent.Telecalling });
    return c.json(tc, 201);
  });

  // ── "Active Penalty" runtime toggle (MIS) ────────────────────────────────────
  // OFF (default) = no −15 snatch for anyone; +100 conversion close always
  // stays on. ON = the −15 EOD-snatch penalty applies, except temp
  // absent-cover holds which are always penalty-free. (The old −20 decline
  // penalty is retired entirely.)
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
    // Scores render from the cached dashboard — invalidate + go live so the
    // flip is visible immediately (was silent: the toggle appeared stuck).
    try { await invalidateRiskCache(); } catch { /* non-fatal */ }
    notifyLive(c, { type: LiveEvent.Telecalling });
    return c.json({ ok: true, enabled: body.enabled });
  });

  // ── "EOD Reassignment" master switch (MIS) ─────────────────────────────────
  // ON (default) = red/zombie estimates are re-poached to a better converter
  // at the engine runs. OFF = no risk re-poaching between specialists; only
  // unassigned deals + MIS locks + non-specialist (lead-gen) holds corrected
  // back to specialists still move. NOTE: registered BEFORE /api/telecallers/:id so
  // 'eod-reassign' can never be captured as an :id.
  // GET is readable by any approved viewer (sales needs it to hide snatch chips
  // when reassignment is OFF — MIS-gating here left sales agents stuck on
  // `showRisk=true` with stale "will be snatched" warnings).
  app.get('/api/telecallers/eod-reassign', async (c) => {
    const me = await getMe(authStore(c), readSessionCookie(c.req.header('cookie') ?? null));
    if (!me) return c.json({ error: 'Authentication required' }, 401);
    if (!isApproved(me)) return c.json({ error: 'Access pending' }, 403);
    return c.json({ enabled: await isEodReassignEnabled() });
  });

  app.put('/api/telecallers/eod-reassign', async (c) => {
    try { await requireMisScope(c); } catch (e) { return misScopeError(c, e); }
    const body = await c.req.json().catch(() => ({}));
    if (typeof body.enabled !== 'boolean') return c.json({ error: 'enabled boolean required' }, 400);
    await setEodReassignEnabled(body.enabled);
    try { await invalidateRiskCache(); } catch { /* non-fatal */ }
    notifyLive(c, { type: LiveEvent.Telecalling });
    return c.json({ ok: true, enabled: body.enabled });
  });

  // ── Effort-shield audit (MIS) ───────────────────────────────────────────────
  // Per-sent-estimate shield verdicts from the 15-min effort snapshots.
  // Statuses: shielded-1 | shielded-2 | expiring (streak 2, snatches tomorrow)
  // | insufficient | no-phone. Connects never affect the verdict (effort-only
  // rule). 401-gated like the rest of MIS.
  app.get('/api/telecalling/shields', async (c) => {
    try { await requireMisScope(c); } catch (e) { return misScopeError(c, e); }
    const { prisma } = deps();
    const dayMinus = (n: number) => kolkataDateStr(new Date(Date.now() - n * 86400000));
    const [s0, s1, s2] = await Promise.all([
      readEffortSnapshot(dayMinus(0)), readEffortSnapshot(dayMinus(1)), readEffortSnapshot(dayMinus(2)),
    ]);
    let auth: any = null;
    try {
      const row: any = await (prisma as any).setting.findUnique({ where: { key: EFFORT_AUTH_KEY } });
      auth = row?.value ? JSON.parse(String(row.value)) : null;
    } catch { /* non-fatal */ }
    const [ests, tcs] = await Promise.all([
      (prisma as any).estimate.findMany({
        where: { status: 'sent' },
        select: { estimateId: true, estimateNumber: true, customerName: true, contactPhone: true, assignedTelecallerId: true },
      }),
      (prisma as any).telecaller.findMany({ select: { id: true, name: true, neodoveUserId: true } }),
    ]);
    const nameById = new Map<string, { name: string; neoId: string }>();
    for (const t of tcs) nameById.set(String(t.id), { name: String(t.name ?? ''), neoId: String(t.neodoveUserId ?? '') });
    const rows: Array<Record<string, unknown>> = [];
    for (const e of ests) {
      const holder = nameById.get(String(e.assignedTelecallerId ?? ''));
      const phone10 = normPhone10((e as any).contactPhone);
      const verdict = evaluateShield(phone10, holder?.neoId ?? '', [s0, s1, s2]);
      const status = verdict.status;
      rows.push({
        estimateId: e.estimateId, estimateNumber: e.estimateNumber, customerName: e.customerName,
        phone10, holderName: holder?.name ?? 'Unassigned',
        n: verdict.evidence?.n ?? 0, spanH: verdict.evidence?.spanH ?? 0,
        conn: verdict.evidence?.conn ?? 0, streak: verdict.streak,
        status, reason: verdict.reason,
      });
    }
    rows.sort((a, b) => (String(a.status) < String(b.status) ? -1 : String(a.status) > String(b.status) ? 1 : Number(b.n) - Number(a.n)));
    return c.json({ day: dayMinus(0), snapshots: [!!s0, !!s1, !!s2], auth, rows });
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
    try { await invalidateRiskCache(); } catch { /* non-fatal */ }
    notifyLive(c, { type: LiveEvent.Telecalling });
    return c.json(tc);
  });

  app.delete('/api/telecallers/:id', async (c) => {
    try { await requireMisScope(c); } catch (e) { return misScopeError(c, e); }
    const { prisma } = deps();
    await prisma.telecaller.update({
      where: { id: c.req.param('id') },
      data: { deleted: true, assignEstimateFollowUps: false },
    });
    try { await invalidateRiskCache(); } catch { /* non-fatal */ }
    notifyLive(c, { type: LiveEvent.Telecalling });
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
    notifyLive(c, { type: LiveEvent.Telecalling });
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
    notifyLive(c, { type: LiveEvent.Telecalling });
    return c.json(est);
  });

  // ── Bulk modification (MIS): move hand-picked estimates to chosen agents ───
  // The controller's correction tool for AI hallucinations / misassignments:
  // moves are one-time assigns (ledger rows written, NO locks, NO score
  // penalties). Only `sent` estimates move; the response reports per-item
  // moved / skipped / errors so MIS sees exactly what happened.
  app.post('/api/estimates/bulk-assign', async (c) => {
    try { await requireMisScope(c); } catch (e) { return misScopeError(c, e); }
    const body = await c.req.json().catch(() => ({}));
    const moves = Array.isArray(body.moves) ? body.moves : [];
    if (moves.length === 0) return c.json({ error: 'moves[] required' }, 400);
    const result = await bulkAssignEstimates(moves, { reason: body.reason || 'MIS bulk modification' });
    // Broadcast on moves AND flag flips (a follow-up flip with zero moves is
    // still visible state) — matches the secret-gated runner twin.
    if (result.moved.length > 0 || result.flagsUpdated.length > 0) notifyLive(c, { type: LiveEvent.Telecalling });
    return c.json({ ok: result.errors.length === 0, movedCount: result.moved.length, ...result });
  });

  // ── Agent call-disposition tags (Lead Conversion view) ───────────────────
  // The sales team tags each follow-up: NO_ANSWER (not picking up), BUSY, or
  // CALLBACK with a follow-up date (capped at +10 days IST, enforced in
  // setEstimateCallTag). MIS may tag any estimate; a signed-in sales agent may
  // only tag estimates currently assigned to THEM (resolved from the session
  // via resolveSelfTelecaller — same scoping as the conversion view itself).
  app.put('/api/estimates/:id/call-tag', async (c) => {
    const { prisma } = deps();
    const body = await c.req.json().catch(() => ({}));
    let actorTelecallerId: string | null = null;
    let isMis = false;
    try {
      await requireMisScope(c);
      isMis = true;
    } catch {
      const { resolveSelfTelecaller } = require('./automations') as typeof import('./automations');
      try {
        actorTelecallerId = await resolveSelfTelecaller(c);
      } catch { actorTelecallerId = null; }
      if (!actorTelecallerId) return c.json({ error: 'only MIS or the assigned sales agent can tag estimates' }, 403);
    }
    const estimateId = c.req.param('id');
    if (!isMis) {
      const current = await prisma.estimate.findUnique({
        where: { estimateId },
        select: { assignedTelecallerId: true },
      });
      if (!current) return c.json({ error: 'estimate not found' }, 404);
      if (String(current.assignedTelecallerId ?? '') !== actorTelecallerId) {
        return c.json({ error: 'you can only tag estimates assigned to you' }, 403);
      }
    }
    const result = await setEstimateCallTag({
      estimateId,
      tag: body.tag ?? null,
      callbackDate: body.callbackDate ?? null,
      actorTelecallerId: isMis ? null : actorTelecallerId,
    });
    if (!result.ok) return c.json({ error: result.error }, (result.status ?? 400) as any);
    const saved: any = result.estimate ?? {};
    // Sheets-style delta push: carry the changed row fields IN the event so
    // every open tab patches its local model instantly instead of waiting for
    // a full dashboard refetch (the overlay guarantees the refetch agrees).
    let callTagByName: string | null = null;
    try {
      const by = saved.callTagBy ? String(saved.callTagBy) : '';
      if (by) {
        const t = await prisma.telecaller.findUnique({ where: { id: by }, select: { name: true } });
        callTagByName = (t as any)?.name ? String((t as any).name) : null;
      }
    } catch { /* name best-effort */ }
    notifyLive(c, {
      type: LiveEvent.TelecallingTag,
      callTag: {
        estimateId,
        callTag: saved.callTag ?? null,
        callbackDate: saved.callbackDate ?? null,
        callTagBy: saved.callTagBy ?? null,
        callTagByName,
        callTagAt: saved.callTagAt ?? null,
      },
    });
    return c.json({
      ok: true,
      estimateId,
      callTag: (result.estimate as any)?.callTag ?? null,
      callbackDate: (result.estimate as any)?.callbackDate ?? null,
    });
  });

  // ── Dated next steps (Lead Conversion view) ───────────────────────────────
  // Holder or MIS sets a concrete customer commitment + date on a follow-up.
  // While the date is today-or-future the estimate is protected from red-risk
  // and the EOD −10 no matter the AI verdict; a past date reads red until
  // chased. Same holder-or-MIS scoping as call tags above.
  app.put('/api/estimates/:id/next-step', async (c) => {
    const { prisma } = deps();
    const body = await c.req.json().catch(() => ({}));
    let isMis = false;
    let actorTelecallerId: string | null = null;
    try {
      await requireMisScope(c);
      isMis = true;
    } catch {
      const { resolveSelfTelecaller } = require('./automations') as typeof import('./automations');
      try {
        actorTelecallerId = await resolveSelfTelecaller(c);
      } catch { actorTelecallerId = null; }
      if (!actorTelecallerId) return c.json({ error: 'only MIS or the assigned sales agent can set next steps' }, 403);
    }
    const estimateId = c.req.param('id');
    if (!isMis) {
      const current = await prisma.estimate.findUnique({
        where: { estimateId },
        select: { assignedTelecallerId: true },
      });
      if (!current) return c.json({ error: 'estimate not found' }, 404);
      if (String(current.assignedTelecallerId ?? '') !== actorTelecallerId) {
        return c.json({ error: 'you can only set next steps on estimates assigned to you' }, 403);
      }
    }
    const { setEstimateNextStep } = require('../../automations/telecalling/service') as typeof import('../../automations/telecalling/service');
    const result = await setEstimateNextStep({
      estimateId,
      date: body.date ?? null,
      note: body.note ?? null,
    });
    if (!result.ok) return c.json({ error: result.error }, (result.status ?? 400) as any);
    try {
      const { invalidateRiskCache } = require('../../automations/telecalling/service') as typeof import('../../automations/telecalling/service');
      await invalidateRiskCache();
    } catch { /* non-fatal */ }
    const saved: any = result.estimate ?? {};
    notifyLive(c, { type: LiveEvent.Telecalling, nextStep: { estimateId, nextStep: saved.nextStep ?? null, nextStepDate: saved.nextStepDate ?? null } });
    return c.json({
      ok: true,
      estimateId,
      nextStep: saved.nextStep ?? null,
      nextStepDate: saved.nextStepDate ?? null,
    });
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