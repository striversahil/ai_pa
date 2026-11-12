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
import { deps, requireMisScope, misScopeError, notifyLive, LiveEvent, authStore, isApproved, type Bindings } from '../context';
import {
  setEstimateCallTag,
  invalidateRiskCache,
  deleteCloseHistory,
  isValidRegion,
  isValidTlLevel,
  tlPairError,
  listSalesHolidays,
  markSalesHoliday,
  unmarkSalesHoliday,
} from '../../automations/telecalling/service';
import {
  loadClientQueue,
  setManualSegment,
  setTypeRule,
} from '../../automations/telecalling/client-segments';
import { normalizeAgentPhone } from '../../automations/telecalling/util';
import { getViewerMe } from '../viewer';
import { readBody } from '../http';

/** Root/MIS/sales-head gate for the region-model management writes. Accepts
 * the scope or the role itself, so a sales-head role holder is authorized even
 * if the scope grant is missing from their session. */
async function requireSalesManager(c: any): Promise<boolean> {
  try { await requireMisScope(c); return true; } catch { /* fall through */ }
  const me: any = await getViewerMe(c);
  if (!me) return false;
  if (!isApproved(me)) return false;
  const scopes: string[] = me.scopes ?? [];
  const roles: string[] = me.roles ?? [];
  return scopes.includes('sales-head') || roles.includes('sales-head') || !!me.isAdmin;
}

export function registerTelecallingRoutes(app: Hono<{ Bindings: Bindings }>): void {
  // ── Telecaller roster (staff ↔ hierarchy ↔ region) ────────────────────────────
  // READ is MIS + sales-head (running the roster is the sales-head's job);
  // roster WRITES below are sales-head/MIS writes via requireSalesManager.
  app.get('/api/telecallers', async (c) => {
    try { await requireMisScope(c); }
    catch (e) { if (!(await requireSalesManager(c))) return misScopeError(c, e); }
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
    // Sales roster writes are sales-head/MIS writes (founder decision:
    // sales-head holds complete authority inside sales, same as MIS).
    if (!(await requireSalesManager(c))) return c.json({ error: 'sales-head, MIS or root only' }, 403);
    const { prisma } = deps();
    const body = await readBody(c);
    if (!body?.name) return c.json({ error: 'name required' }, 400);
    if (body.type !== undefined && body.type !== '' && body.type !== 'telecaller' && body.type !== 'field_staff' && body.type !== 'team_lead') {
      return c.json({ error: "type must be 'telecaller', 'field_staff' or 'team_lead'" }, 400);
    }
    const staffType = body.type === 'field_staff' ? 'field_staff' : body.type === 'team_lead' ? 'team_lead' : 'telecaller';
    // Second region is a Team-Lead-only concept — never store it on other types.
    const secondRegion = staffType === 'team_lead' && body.region2 ? String(body.region2) : '';
    if (body.tlLevel !== undefined && body.tlLevel !== '' && !isValidTlLevel(body.tlLevel)) return c.json({ error: 'tlLevel must be TL1 or TL2 (or unset)' }, 400);
    if (body.region !== undefined && body.region !== '' && !isValidRegion(body.region)) return c.json({ error: 'region must be R1–R4 (or unset)' }, 400);
    if (body.region2 !== undefined && body.region2 !== '' && !isValidRegion(body.region2)) return c.json({ error: 'region2 must be R1–R4 (or empty)' }, 400);
    {
      // TL1 = exactly two DIFFERENT regions when both are set (the pair is
      // sales-head assigned; existing single-region TL1 rows stay valid until
      // the sales-head completes the pair in the Controller). region2 only
      // exists on team_lead rows — validate the coerced value.
      const pairErr = tlPairError(body.tlLevel ?? '', body.region ?? '', secondRegion);
      if (pairErr) return c.json({ error: pairErr }, 400);
    }
    const tc = await prisma.telecaller.create({
      data: {
        name: String(body.name).trim(),
        email: body.email ?? null,
        // Normalized: the NeoDove phone join compares normalized digits.
        phone: body.phone ? normalizeAgentPhone(body.phone) || null : null,
        whatsapp: body.whatsapp ?? null,
        tlLevel: body.tlLevel ? String(body.tlLevel) : '',
        region: body.region ? String(body.region) : '',
        region2: secondRegion,
        type: staffType,
        // Field staff never close — they only generate leads.
        assignEstimateFollowUps: staffType === 'field_staff' ? false : (body.assignEstimateFollowUps ?? true),
        order: body.order ?? 0,
        neodoveUserId: body.neodoveUserId ?? null,
        neodoveUserName: body.neodoveUserName ?? null,
      },
    });
    // Roster feeds the cached leaderboard region lists + field-staff picker — invalidate + go live.
    try { await invalidateRiskCache(); } catch { /* non-fatal */ }
    try { const { invalidateFieldStaffCache } = await import('../../modules/field-visits/service'); await invalidateFieldStaffCache(); } catch { /* non-fatal */ }
    notifyLive(c, { type: LiveEvent.Telecalling });
    return c.json(tc, 201);
  });

  app.put('/api/telecallers/:id', async (c) => {
    // Sales roster writes are sales-head/MIS writes (see POST above).
    if (!(await requireSalesManager(c))) return c.json({ error: 'sales-head, MIS or root only' }, 403);
    const { prisma } = deps();
    const body = await readBody(c);
    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data.name = String(body.name).trim();
    if (body.email !== undefined) data.email = body.email;
    if (body.phone !== undefined) data.phone = body.phone ? normalizeAgentPhone(body.phone) || null : null;
    if (body.whatsapp !== undefined) data.whatsapp = body.whatsapp;
    if (body.type !== undefined) {
      if (body.type !== 'telecaller' && body.type !== 'field_staff' && body.type !== 'team_lead') return c.json({ error: "type must be 'telecaller', 'field_staff' or 'team_lead'" }, 400);
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
    if (body.region2 !== undefined) {
      if (body.region2 !== '' && !isValidRegion(body.region2)) return c.json({ error: 'region2 must be R1–R4 (or empty)' }, 400);
      data.region2 = String(body.region2);
    }
    if (body.tlLevel !== undefined || body.region !== undefined || body.region2 !== undefined || body.type !== undefined) {
      // Re-validate the resulting pair: fetch current row so a partial update
      // (e.g. only region2) still checks the full TL1 pair.
      try {
        const current: any = await prisma.telecaller.findUnique({ where: { id: c.req.param('id') }, select: { tlLevel: true, region: true, region2: true, type: true } });
        const resolvedType = body.type !== undefined ? String(body.type) : String(current?.type ?? 'telecaller');
        // region2 is Team-Lead-only: changing away from team_lead clears it,
        // and it can never be set on other types.
        if (resolvedType !== 'team_lead') {
          data.region2 = '';
        }
        const pairErr = tlPairError(
          body.tlLevel !== undefined ? body.tlLevel : current?.tlLevel,
          body.region !== undefined ? body.region : current?.region,
          resolvedType === 'team_lead' ? (body.region2 !== undefined ? body.region2 : (current as any)?.region2) : '',
        );
        if (pairErr) return c.json({ error: pairErr }, 400);
      } catch { /* row read failed — the update below surfaces it */ }
    }
    if (body.deleted !== undefined) {
      data.deleted = !!body.deleted;
      if (body.deleted === false && body.assignEstimateFollowUps === undefined) data.assignEstimateFollowUps = false;
    }
    const tc = await prisma.telecaller.update({ where: { id: c.req.param('id') }, data });
    try { await invalidateRiskCache(); } catch { /* non-fatal */ }
    try { const { invalidateFieldStaffCache } = await import('../../modules/field-visits/service'); await invalidateFieldStaffCache(); } catch { /* non-fatal */ }
    notifyLive(c, { type: LiveEvent.Telecalling });
    return c.json(tc);
  });

  app.delete('/api/telecallers/:id', async (c) => {
    // Sales roster writes are sales-head/MIS writes (see POST above).
    if (!(await requireSalesManager(c))) return c.json({ error: 'sales-head, MIS or root only' }, 403);
    const { prisma } = deps();
    await prisma.telecaller.update({
      where: { id: c.req.param('id') },
      data: { deleted: true, assignEstimateFollowUps: false },
    });
    try { await invalidateRiskCache(); } catch { /* non-fatal */ }
    try { const { invalidateFieldStaffCache } = await import('../../modules/field-visits/service'); await invalidateFieldStaffCache(); } catch { /* non-fatal */ }
    notifyLive(c, { type: LiveEvent.Telecalling });
    return c.json({ ok: true });
  });

  // ── NeoDove phone directory (sales-head / MIS) ────────────────────────────
  // Manual userId‖userName → phone map (founder 2026-11-06): NeoDove exposes
  // no agent phone, so the sales-head maps each dialling NeoDove user once.
  // The dashboard joins phone-first; unmapped agents stay on the name
  // fallback and are flagged until mapped.
  // ── Estimate region search (sales-head / MIS): find ANY active/past deal ───
  // The Controller uses this to re-home an estimate by number/customer across
  // sent, accepted (incl. confirmed) and declined — the region is authoritative
  // for points/wins regardless of status.
  app.get('/api/telecalling/estimates', async (c) => {
    if (!(await requireSalesManager(c))) {
      return c.json({ error: 'sales-head, MIS or root only' }, 403);
    }
    const q = String(c.req.query('q') ?? '').trim();
    const statusRaw = String(c.req.query('status') ?? 'all').trim().toLowerCase();
    const limit = Math.min(100, Math.max(1, Number(c.req.query('limit') ?? 50) || 50));
    const where: string[] = [];
    const params: unknown[] = [];
    if (statusRaw === 'accepted') {
      where.push("status IN ('accepted','confirmed')");
    } else if (statusRaw === 'sent' || statusRaw === 'declined' || statusRaw === 'confirmed') {
      where.push('status = ?');
      params.push(statusRaw);
    } else if (statusRaw !== 'all' && statusRaw !== '') {
      return c.json({ error: 'status must be all, sent, accepted or declined' }, 400);
    } else {
      where.push("status IN ('sent','accepted','confirmed','declined')");
    }
    if (q) {
      where.push('(estimateNumber LIKE ? OR customerName LIKE ?)');
      params.push(`%${q}%`, `%${q}%`);
    }
    params.push(limit);
    const sql = `SELECT estimateId, estimateNumber, customerName, total, status, region, createdBy, organizationId, date, lastSyncTime
      FROM Estimate
      WHERE ${where.join(' AND ')}
      ORDER BY lastSyncTime DESC, estimateNumber DESC
      LIMIT ?`;
    try {
      const { results } = await c.env.DB.prepare(sql).bind(...params).all();
      return c.json({ items: results ?? [] });
    } catch (e: any) {
      return c.json({ error: e?.message || 'estimate search failed' }, 500);
    }
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
    const body = await readBody(c);
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
    // Phase 3c dual-write: region is carried attribution — project it.
    try {
      const { mirrorSales } = await import('../../modules/core/sales');
      await mirrorSales([estimateId]);
    } catch { /* non-fatal */ }
    // Phase 7b dual-write: re-home moves the lead region too.
    try {
      const { mirrorLeadsForEstimates } = await import('../../modules/core/leads');
      await mirrorLeadsForEstimates([estimateId]);
    } catch { /* non-fatal */ }
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

  // ── National holidays (sales-head / MIS): days with ₹0 target ────────────
  // A holiday accrues no target like a Sunday, so it shrinks that week's due
  // and the carry-out deficit. Past or future dates both allowed — the ledger
  // recomputes from the start, so backdated marks retroactively reduce dues.
  app.get('/api/telecalling/holidays', async (c) => {
    if (!(await requireSalesManager(c))) {
      return c.json({ error: 'sales-head, MIS or root only' }, 403);
    }
    try {
      const holidays = await listSalesHolidays();
      return c.json({ holidays });
    } catch (e: any) {
      return c.json({ error: e?.message || 'failed to load holidays' }, 500);
    }
  });

  app.post('/api/telecalling/holidays', async (c) => {
    if (!(await requireSalesManager(c))) {
      return c.json({ error: 'sales-head, MIS or root only' }, 403);
    }
    const me: any = await getViewerMe(c).catch(() => null);
    const body = await readBody(c);
    try {
      const { holiday, created } = await markSalesHoliday({
        day: body?.day,
        label: body?.label,
        markedBy: String((me as any)?.user?.id ?? ''),
        markedByName: String((me as any)?.user?.name ?? (me as any)?.user?.email ?? ''),
      });
      try { await invalidateRiskCache(); } catch { /* non-fatal */ }
      notifyLive(c, { type: LiveEvent.Telecalling });
      return c.json({ ok: true, created, holiday });
    } catch (e: any) {
      return c.json({ error: e?.message || 'failed to mark holiday' }, (e?.status ?? 400) as any);
    }
  });

  app.delete('/api/telecalling/holidays/:day', async (c) => {
    if (!(await requireSalesManager(c))) {
      return c.json({ error: 'sales-head, MIS or root only' }, 403);
    }
    try {
      await unmarkSalesHoliday(c.req.param('day'));
      try { await invalidateRiskCache(); } catch { /* non-fatal */ }
      notifyLive(c, { type: LiveEvent.Telecalling });
      return c.json({ ok: true });
    } catch (e: any) {
      return c.json({ error: e?.message || 'failed to remove holiday' }, (e?.status ?? 400) as any);
    }
  });

  // ── Client segments (sales-head / MIS): final-consumer vs reseller ───────
  // The queue groups accepted + declined estimates by client with the auto
  // match (or up to 5 candidates when unclear); type rules map a whole master
  // family at once; manual marks always win and are the only stored rows.
  // Writes bust the dashboard cache + go live (target bars read segments).
  app.get('/api/telecalling/client-segments', async (c) => {
    if (!(await requireSalesManager(c))) {
      return c.json({ error: 'sales-head, MIS or root only' }, 403);
    }
    try {
      const { DEFAULT_TARGET_START } = await import('../../automations/telecalling/targets');
      const from = typeof c.req.query('from') === 'string' && c.req.query('from') ? String(c.req.query('from')) : DEFAULT_TARGET_START;
      const to = typeof c.req.query('to') === 'string' && c.req.query('to') ? String(c.req.query('to')) : new Date().toISOString().slice(0, 10);
      const queue = await loadClientQueue(from, to);
      return c.json({ ...queue, from, to });
    } catch (e: any) {
      return c.json({ error: e?.message || 'failed to load client queue' }, 500);
    }
  });

  app.put('/api/telecalling/client-segments', async (c) => {
    if (!(await requireSalesManager(c))) {
      return c.json({ error: 'sales-head, MIS or root only' }, 403);
    }
    const me: any = await getViewerMe(c).catch(() => null);
    const body = await readBody(c);
    try {
      const result = await setManualSegment(body?.clientKey ?? body?.key, body?.segment, {
        masterCustomerId: body?.masterCustomerId,
        masterName: body?.masterName,
        decidedBy: String((me as any)?.user?.id ?? ''),
        decidedByName: String((me as any)?.user?.name ?? (me as any)?.user?.email ?? ''),
      });
      notifyLive(c, { type: LiveEvent.Telecalling });
      return c.json({ ok: true, ...result });
    } catch (e: any) {
      return c.json({ error: e?.message || 'failed to save client segment' }, 400);
    }
  });

  app.put('/api/telecalling/client-type-rules', async (c) => {
    if (!(await requireSalesManager(c))) {
      return c.json({ error: 'sales-head, MIS or root only' }, 403);
    }
    const me: any = await getViewerMe(c).catch(() => null);
    const body = await readBody(c);
    const rules = Array.isArray(body?.rules) ? body.rules : [{ typeBase: body?.typeBase, segment: body?.segment }];
    try {
      const saved: Array<{ base: string; segment: unknown }> = [];
      for (const r of rules) {
        saved.push(await setTypeRule(r?.typeBase, r?.segment,
          String((me as any)?.user?.id ?? ''),
          String((me as any)?.user?.name ?? (me as any)?.user?.email ?? '')));
      }
      notifyLive(c, { type: LiveEvent.Telecalling });
      return c.json({ ok: true, rules: saved });
    } catch (e: any) {
      return c.json({ error: e?.message || 'failed to save type rules' }, 400);
    }
  });

  // ── Manual connected-call log (TEMPORARY, founder 2026-11-04) ──────────
  // Backfill while NeoDove is unreliable: hand-counted connected calls per
  // agent per day + screenshot proof. The leaderboard reads these rows instead
  // of NeoDove while Setting `manual_calls_mode` = 'manual' (toggle below).
  // Delete this block + manual-calls.ts + the Call Log tab when NeoDove is
  // trusted again.
  app.get('/api/telecalling/manual-calls/mode', async (c) => {
    const me: any = await getViewerMe(c).catch(() => null);
    if (!me) return c.json({ error: 'authentication required' }, 401);
    try {
      const { getCallSource } = await import('../../automations/telecalling/call-source');
      return c.json({ mode: await getCallSource() });
    } catch (e: any) {
      return c.json({ mode: 'neodove', error: e?.message ?? null });
    }
  });

  app.put('/api/telecalling/manual-calls/mode', async (c) => {
    if (!(await requireSalesManager(c))) return c.json({ error: 'sales-head, MIS or root only' }, 403);
    const body = await readBody(c);
    try {
      const { setCallSource } = await import('../../automations/telecalling/call-source');
      const mode = await setCallSource(body?.mode);
      notifyLive(c, { type: LiveEvent.Telecalling });
      return c.json({ ok: true, mode });
    } catch (e: any) {
      return c.json({ error: e?.message || 'failed to save mode' }, 400);
    }
  });

  app.get('/api/telecalling/manual-calls', async (c) => {
    const me: any = await getViewerMe(c).catch(() => null);
    if (!me) return c.json({ error: 'authentication required' }, 401);
    const { prisma } = deps();
    const dayQ = String(c.req.query('day') ?? '').trim();
    const fromQ = String(c.req.query('from') ?? '').trim();
    const toQ = String(c.req.query('to') ?? '').trim();
    const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
    const day = DAY_RE.test(dayQ) ? dayQ : new Date().toISOString().slice(0, 10);
    const from = DAY_RE.test(fromQ) ? fromQ : day;
    const to = DAY_RE.test(toQ) ? toQ : day;
    try {
      const { getManualCallsMode, listManualCallRows } = await import('../../automations/telecalling/manual-calls');
      const mode = await getManualCallsMode();
      const agents: any[] = await prisma.telecaller.findMany({
        where: { deleted: false },
        orderBy: { order: 'asc' },
        select: { id: true, name: true, region: true, type: true },
      });
      const rows = await listManualCallRows(from, to);
      return c.json({ mode, day, from, to, agents, entries: rows });
    } catch (e: any) {
      return c.json({ error: e?.message || 'failed to load manual calls' }, 500);
    }
  });

  app.post('/api/telecalling/manual-calls', async (c) => {
    const { prisma } = deps();
    const body = await readBody(c);
    const telecallerId = String(body?.telecallerId ?? '').trim();
    const day = String(body?.day ?? '').trim();
    const connected = Math.floor(Number(body?.connectedCalls ?? NaN));
    const note = String(body?.note ?? '').slice(0, 500);
    if (!telecallerId) return c.json({ error: 'telecallerId required' }, 400);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return c.json({ error: 'day must be YYYY-MM-DD' }, 400);
    if (!Number.isFinite(connected) || connected < 0 || connected > 10000) {
      return c.json({ error: 'connectedCalls must be 0–10000' }, 400);
    }
    // Managers may log any agent; a signed-in agent may log her OWN row.
    let isManager = false;
    try { await requireMisScope(c); isManager = true; } catch { isManager = await requireSalesManager(c); }
    if (!isManager) {
      try {
        const { resolveSelfTelecaller } = require('./automations') as typeof import('./automations');
        const selfId = await resolveSelfTelecaller(c);
        if (!selfId || selfId !== telecallerId) return c.json({ error: 'you can only log your own calls' }, 403);
      } catch { return c.json({ error: 'only sales managers or the agent herself can log calls' }, 403); }
    }
    const tc: any = await prisma.telecaller.findUnique({ where: { id: telecallerId } }).catch(() => null);
    if (!tc || (tc as any).deleted) return c.json({ error: 'agent not found' }, 404);
    const me: any = await getViewerMe(c).catch(() => null);
    const now = new Date();
    try {
      const row: any = await (prisma as any).manualCallLog.upsert({
        where: { telecallerId_day: { telecallerId, day } },
        update: { connectedCalls: connected, note, updatedAt: now },
        create: {
          telecallerId, day, connectedCalls: connected, note,
          createdBy: String((me as any)?.user?.id ?? ''),
          createdByName: String((me as any)?.user?.name ?? (me as any)?.user?.email ?? ''),
          createdAt: now, updatedAt: now,
        },
      });
      try {
        const { invalidateManualCallsCache } = await import('../../automations/telecalling/manual-calls');
        await invalidateManualCallsCache();
      } catch { /* non-fatal */ }
      notifyLive(c, { type: LiveEvent.Telecalling });
      return c.json({ ok: true, entry: row });
    } catch (e: any) {
      return c.json({ error: e?.message || 'save failed' }, 400);
    }
  });

  app.delete('/api/telecalling/manual-calls', async (c) => {
    if (!(await requireSalesManager(c))) return c.json({ error: 'sales-head, MIS or root only' }, 403);
    const { prisma } = deps();
    const telecallerId = String(c.req.query('telecallerId') ?? '').trim();
    const day = String(c.req.query('day') ?? '').trim();
    if (!telecallerId || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return c.json({ error: 'telecallerId + day required' }, 400);
    try {
      const row: any = await (prisma as any).manualCallLog.findUnique({
        where: { telecallerId_day: { telecallerId, day } },
      }).catch(() => null);
      if (row?.screenshotKvKey && c.env.CHAT_FILES) {
        try { await c.env.CHAT_FILES.delete(String(row.screenshotKvKey)); } catch { /* bytes best-effort */ }
      }
      await (prisma as any).manualCallLog.delete({ where: { telecallerId_day: { telecallerId, day } } }).catch(() => null);
      try {
        const { invalidateManualCallsCache } = await import('../../automations/telecalling/manual-calls');
        await invalidateManualCallsCache();
      } catch { /* non-fatal */ }
      notifyLive(c, { type: LiveEvent.Telecalling });
      return c.json({ ok: true });
    } catch (e: any) {
      return c.json({ error: e?.message || 'delete failed' }, 400);
    }
  });

  // Screenshot proof upload (multipart `file` + `telecallerId` + `day` fields).
  // Bytes live in CHAT_FILES KV (`manualcalls/...`); the row holds metadata.
  app.post('/api/telecalling/manual-calls/file', async (c) => {
    if (!c.env.CHAT_FILES) return c.json({ error: 'File storage is not configured' }, 501);
    let form: FormData;
    try { form = await c.req.formData(); } catch { return c.json({ error: 'Expected multipart/form-data' }, 400); }
    const file = form.get('file');
    const telecallerId = String(form.get('telecallerId') ?? '').trim();
    const day = String(form.get('day') ?? '').trim();
    if (!(file instanceof File)) return c.json({ error: 'file field required' }, 400);
    if (!telecallerId || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return c.json({ error: 'telecallerId + day required' }, 400);
    const mime = file.type || 'application/octet-stream';
    if (!mime.startsWith('image/') && mime !== 'application/pdf') {
      return c.json({ error: 'Only image or PDF screenshots can be attached' }, 400);
    }
    if (file.size > 20 * 1024 * 1024) return c.json({ error: 'File too large (max 20MB)' }, 413);
    if (file.size <= 0) return c.json({ error: 'Empty file' }, 400);
    let isManager = false;
    try { await requireMisScope(c); isManager = true; } catch { isManager = await requireSalesManager(c); }
    if (!isManager) {
      try {
        const { resolveSelfTelecaller } = require('./automations') as typeof import('./automations');
        const selfId = await resolveSelfTelecaller(c);
        if (!selfId || selfId !== telecallerId) return c.json({ error: 'you can only attach your own proof' }, 403);
      } catch { return c.json({ error: 'only sales managers or the agent herself can attach proof' }, 403); }
    }
    const { prisma } = deps();
    const me: any = await getViewerMe(c).catch(() => null);
    const ext = (file.name.split('.').pop() || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8);
    const key = `manualcalls/${day}/${String(telecallerId).replace(/[^A-Za-z0-9_-]/g, '_')}/${crypto.randomUUID()}${ext ? '.' + ext : ''}`;
    try {
      await c.env.CHAT_FILES.put(key, await file.arrayBuffer(), {
        metadata: { name: file.name, type: mime, day, agent: telecallerId },
      });
    } catch (e: any) {
      return c.json({ error: 'upload failed' }, 500);
    }
    try {
      const now = new Date();
      const prev: any = await (prisma as any).manualCallLog.findUnique({
        where: { telecallerId_day: { telecallerId, day } },
      }).catch(() => null);
      if (prev?.screenshotKvKey && c.env.CHAT_FILES) {
        try { await c.env.CHAT_FILES.delete(String(prev.screenshotKvKey)); } catch { /* orphan best-effort */ }
      }
      const row: any = prev
        ? await (prisma as any).manualCallLog.update({
            where: { telecallerId_day: { telecallerId, day } },
            data: {
              screenshotKvKey: key, screenshotName: file.name.slice(0, 200),
              screenshotMime: mime, screenshotSize: file.size, updatedAt: now,
            },
          })
        : await (prisma as any).manualCallLog.create({
            data: {
              telecallerId, day, connectedCalls: 0,
              screenshotKvKey: key, screenshotName: file.name.slice(0, 200),
              screenshotMime: mime, screenshotSize: file.size,
              createdBy: String((me as any)?.user?.id ?? ''),
              createdByName: String((me as any)?.user?.name ?? (me as any)?.user?.email ?? ''),
              createdAt: now, updatedAt: now,
            },
          });
      try {
        const { invalidateManualCallsCache } = await import('../../automations/telecalling/manual-calls');
        await invalidateManualCallsCache();
      } catch { /* non-fatal */ }
      notifyLive(c, { type: LiveEvent.Telecalling });
      return c.json({ ok: true, entry: row }, 201);
    } catch (e: any) {
      try { await c.env.CHAT_FILES.delete(key); } catch { /* orphan bytes best-effort */ }
      return c.json({ error: e?.message ?? 'attach failed' }, 400);
    }
  });

  // Serve screenshot bytes (never exposes raw KV keys).
  app.get('/api/telecalling/manual-calls/file', async (c) => {
    if (!c.env.CHAT_FILES) return c.json({ error: 'File storage is not configured' }, 501);
    const me: any = await getViewerMe(c).catch(() => null);
    if (!me) return c.json({ error: 'authentication required' }, 401);
    const { prisma } = deps();
    const telecallerId = String(c.req.query('telecallerId') ?? '').trim();
    const day = String(c.req.query('day') ?? '').trim();
    if (!telecallerId || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return c.json({ error: 'telecallerId + day required' }, 400);
    const row: any = await (prisma as any).manualCallLog.findUnique({
      where: { telecallerId_day: { telecallerId, day } },
    }).catch(() => null);
    if (!row?.screenshotKvKey) return c.json({ error: 'No screenshot for this entry' }, 404);
    const obj = await c.env.CHAT_FILES.getWithMetadata(String(row.screenshotKvKey), 'arrayBuffer');
    if (obj.value === null) return c.json({ error: 'File not found' }, 404);
    const type = String(row.screenshotMime || 'application/octet-stream');
    const headers = new Headers();
    headers.set('Content-Type', type);
    headers.set('Cache-Control', 'public, max-age=3600');
    if (!/^image\/|^application\/pdf$/.test(type)) {
      headers.set('Content-Disposition', `attachment; filename="${String(row.screenshotName || 'proof').replace(/["\\]/g, '')}"`);
    }
    return new Response(obj.value, { headers });
  });
  // ── Agent call-disposition tags (region follow-ups view) ─────────────────
  // The sales team tags each follow-up: NO_ANSWER (not picking up), BUSY, or
  // CALLBACK with a follow-up date (capped at +10 days IST, enforced in
  // setEstimateCallTag). Sales managers (sales-head/MIS) may tag any estimate;
  // signed-in sales staff may tag estimates in THEIR region (staff work their
  // whole region now — no personal assignment).
  app.put('/api/estimates/:id/call-tag', async (c) => {
    const { prisma } = deps();
    const body = await readBody(c);
    let actorTelecallerId: string | null = null;
    let isManager = false;
    try {
      await requireMisScope(c);
      isManager = true;
    } catch {
      // Sales-head holds complete authority inside sales: same bypass as MIS.
      if (await requireSalesManager(c)) {
        isManager = true;
      } else {
        const { resolveSelfTelecaller } = require('./automations') as typeof import('./automations');
        try {
          actorTelecallerId = await resolveSelfTelecaller(c);
        } catch { actorTelecallerId = null; }
        if (!actorTelecallerId) return c.json({ error: 'only sales managers or region staff can tag estimates' }, 403);
      }
    }
    const estimateId = c.req.param('id');
    if (!isManager) {
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
      actorTelecallerId: isManager ? null : actorTelecallerId,
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
  // Staff or sales managers set a concrete customer commitment + date on a
  // follow-up. While the date is today-or-future the estimate reads "on
  // record" in the risk model; a past date reads red until chased. Same
  // region-or-manager scoping as call tags above.
  app.put('/api/estimates/:id/next-step', async (c) => {
    const { prisma } = deps();
    const body = await readBody(c);
    let isManager = false;
    let actorTelecallerId: string | null = null;
    try {
      await requireMisScope(c);
      isManager = true;
    } catch {
      // Sales-head holds complete authority inside sales: same bypass as MIS.
      if (await requireSalesManager(c)) {
        isManager = true;
      } else {
        const { resolveSelfTelecaller } = require('./automations') as typeof import('./automations');
        try {
          actorTelecallerId = await resolveSelfTelecaller(c);
        } catch { actorTelecallerId = null; }
        if (!actorTelecallerId) return c.json({ error: 'only sales managers or region staff can set next steps' }, 403);
      }
    }
    const estimateId = c.req.param('id');
    if (!isManager) {
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
