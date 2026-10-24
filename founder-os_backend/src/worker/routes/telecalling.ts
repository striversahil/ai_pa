// ─────────────────────────────────────────────────────────────────────────────
// routes/telecalling.ts — roster (tlLevel/region), region set, history
// reset, call tags, next steps.
//
// Region model (extract, Phase-R): the roster carries each staff member's
// hierarchy level + region; region fixes and roster writes are sales-head/MIS
// writes. The old assignment overrides, bulk moves, effort
// shields, absentee cover and penalty toggles are retired — estimates are
// owned by regions, never individuals.
// ─────────────────────────────────────────────────────────────────────────────
import type { Hono } from 'hono';
import { deps, requireMisScope, misScopeError, notifyLive, LiveEvent, authStore, getMe, isApproved, readSessionCookie, type Bindings } from '../context';
import {
  setEstimateCallTag,
  invalidateRiskCache,
  deleteCloseHistory,
  isValidRegion,
  isValidTlLevel,
} from '../../automations/telecalling/service';

/** Root/MIS/sales-head gate for the region-model management writes. */
async function requireSalesManager(c: any): Promise<boolean> {
  try { await requireMisScope(c); return true; } catch { /* fall through */ }
  const me: any = await getMe(authStore(c), readSessionCookie(c.req.header('cookie') ?? null));
  if (!me) return false;
  if (!isApproved(me)) return false;
  const scopes: string[] = me.scopes ?? [];
  return scopes.includes('sales-head') || !!me.isAdmin;
}

export function registerTelecallingRoutes(app: Hono<{ Bindings: Bindings }>): void {
  // ── Telecaller roster (staff ↔ hierarchy ↔ region) ────────────────────────────
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
    if (body.type !== undefined && body.type !== '' && body.type !== 'telecaller' && body.type !== 'field_staff') {
      return c.json({ error: "type must be 'telecaller' or 'field_staff'" }, 400);
    }
    const staffType = body.type === 'field_staff' ? 'field_staff' : 'telecaller';
    if (body.tlLevel !== undefined && body.tlLevel !== '' && !isValidTlLevel(body.tlLevel)) return c.json({ error: 'tlLevel must be TL1 or TL2 (or unset)' }, 400);
    if (body.region !== undefined && body.region !== '' && !isValidRegion(body.region)) return c.json({ error: 'region must be R1–R4 (or unset)' }, 400);
    const tc = await prisma.telecaller.create({
      data: {
        name: String(body.name).trim(),
        email: body.email ?? null,
        phone: body.phone ?? null,
        whatsapp: body.whatsapp ?? null,
        tlLevel: body.tlLevel ? String(body.tlLevel) : '',
        region: body.region ? String(body.region) : '',
        type: staffType,
        // Field staff never close — they only generate leads.
        assignEstimateFollowUps: staffType === 'field_staff' ? false : (body.assignEstimateFollowUps ?? true),
        order: body.order ?? 0,
        neodoveUserId: body.neodoveUserId ?? null,
        neodoveUserName: body.neodoveUserName ?? null,
      },
    });
    // Roster feeds the cached leaderboard region lists — invalidate + go live.
    try { await invalidateRiskCache(); } catch { /* non-fatal */ }
    notifyLive(c, { type: LiveEvent.Telecalling });
    return c.json(tc, 201);
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
    if (body.type !== undefined) {
      if (body.type !== 'telecaller' && body.type !== 'field_staff') return c.json({ error: "type must be 'telecaller' or 'field_staff'" }, 400);
      data.type = String(body.type);
    }
    if (body.assignEstimateFollowUps !== undefined) data.assignEstimateFollowUps = body.assignEstimateFollowUps;
    // Field staff never close — they only generate leads.
    if (data.type === 'field_staff') data.assignEstimateFollowUps = false;
    if (body.order !== undefined) data.order = body.order;
    if (body.neodoveUserId !== undefined) data.neodoveUserId = body.neodoveUserId;
    if (body.neodoveUserName !== undefined) data.neodoveUserName = body.neodoveUserName;
    if (body.tlLevel !== undefined) {
      if (body.tlLevel !== '' && !isValidTlLevel(body.tlLevel)) return c.json({ error: 'tlLevel must be TL1 or TL2 (or unset)' }, 400);
      data.tlLevel = String(body.tlLevel);
    }
    if (body.region !== undefined) {
      if (body.region !== '' && !isValidRegion(body.region)) return c.json({ error: 'region must be R1–R4 (or unset)' }, 400);
      data.region = String(body.region);
    }
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

  // ── Region set (sales-head / MIS): link an unmapped/mis-aimed estimate ─────
  // Estimates are stamped by the mapping enquiry; rows that synced before their
  // staff had a region (or any other gap) land in the Unmapped bucket and are
  // linked here. Also fixes typos/moves between regions.
  app.put('/api/estimates/:id/region', async (c) => {
    if (!(await requireSalesManager(c))) {
      return c.json({ error: 'sales-head, MIS or root can set estimate regions' }, 403);
    }
    const { prisma } = deps();
    const body = await c.req.json().catch(() => ({}));
    if (!isValidRegion(body.region)) return c.json({ error: 'region must be R1–R4' }, 400);
    const estimateId = c.req.param('id');
    const current = await prisma.estimate.findUnique({
      where: { estimateId },
      select: { region: true },
    });
    if (!current) return c.json({ error: 'estimate not found' }, 404);
    const region = String(body.region);
    const linked = !String(current.region ?? '');
    const est = await prisma.estimate.update({
      where: { estimateId },
      data: { region },
    });
    try { await invalidateRiskCache(); } catch { /* non-fatal */ }
    notifyLive(c, { type: LiveEvent.Telecalling });
    return c.json({ ok: true, estimateId, region, wasUnmapped: linked, estimate: est as any });
  });

  // ── History reset (root/MIS only, founder-approved): purge close credits ──
  // dry=1 counts what would go without deleting; omitting it runs the purge
  // (deletes every close-credit ledger row, stamps the epoch, leaves all other
  // data untouched).
  app.post('/api/telecalling/reset-history', async (c) => {
    if (!(await requireSalesManager(c))) {
      return c.json({ error: 'sales-head, MIS or root can reset history' }, 403);
    }
    const dryRun = c.req.query('dry') === '1';
    const result = await deleteCloseHistory(dryRun);
    if (!dryRun) {
      try { await invalidateRiskCache(); } catch { /* non-fatal */ }
      notifyLive(c, { type: LiveEvent.Telecalling });
    }
    return c.json({ ok: true, ...result });
  });

  // ── Agent call-disposition tags (region follow-ups view) ─────────────────
  // The sales team tags each follow-up: NO_ANSWER (not picking up), BUSY, or
  // CALLBACK with a follow-up date (capped at +10 days IST, enforced in
  // setEstimateCallTag). MIS may tag any estimate; signed-in sales staff may
  // tag estimates in THEIR region (staff work their whole region now — no
  // personal assignment).
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
      if (!actorTelecallerId) return c.json({ error: 'only MIS or region staff can tag estimates' }, 403);
    }
    const estimateId = c.req.param('id');
    if (!isMis) {
      const current: any = await prisma.estimate.findUnique({
        where: { estimateId },
        select: { region: true },
      });
      if (!current) return c.json({ error: 'estimate not found' }, 404);
      const self: any = await prisma.telecaller.findUnique({ where: { id: actorTelecallerId }, select: { region: true } });
      const selfRegion = String(self?.region ?? '');
      if (!selfRegion || String(current.region ?? '') !== selfRegion) {
        return c.json({ error: 'you can only tag estimates in your region' }, 403);
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

  // ── Dated next steps (region follow-ups view) ─────────────────────────────
  // Staff or MIS sets a concrete customer commitment + date on a follow-up.
  // While the date is today-or-future the estimate reads "on record" in the
  // risk model; a past date reads red until chased. Same region-or-MIS
  // scoping as call tags above.
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
      if (!actorTelecallerId) return c.json({ error: 'only MIS or region staff can set next steps' }, 403);
    }
    const estimateId = c.req.param('id');
    if (!isMis) {
      const current: any = await prisma.estimate.findUnique({
        where: { estimateId },
        select: { region: true },
      });
      if (!current) return c.json({ error: 'estimate not found' }, 404);
      const self: any = await prisma.telecaller.findUnique({ where: { id: actorTelecallerId }, select: { region: true } });
      const selfRegion = String(self?.region ?? '');
      if (!selfRegion || String(current.region ?? '') !== selfRegion) {
        return c.json({ error: 'you can only set next steps on estimates in your region' }, 403);
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
}
