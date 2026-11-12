// ─────────────────────────────────────────────────────────────────────────────
// routes/field-staff.ts — Field Staff daily-visit API (Sales → Field Staff tab).
// Worker-only (Express is frozen — no Express mirror).
//
// Reads: any telecalling-scoped session (shared sales surface).
// Writes: same (agents log visits for field staff, like Field-Staff enquiries).
// Deletes: sales-head / root only (double-confirmed in UI).
// Staff id is validated against the field_staff roster row; a sales-head
// logging on behalf of a deactivated row bypasses the active-check (the visit
// keeps its stored telecallerId, the write is audit-credited to the actor).
// Mill requirement text auto-creates a Field-Staff enquiry (credited to the
// staffer); the enquiry id is stored back on the mill row.
// Automated location tracking is DISCONTINUED — check-in is a manual
// city/address log, /ping answers 410, no GPS is persisted.
// ─────────────────────────────────────────────────────────────────────────────
import type { Hono } from 'hono';
import { deps, isApproved, notifyLive, requireAdminScope, type Bindings } from '../context';
import { createEnquiryStore } from '../../modules/enquiries/store';
import { enquiryCreate } from '../../modules/enquiries/routes';
import {
  checkoutVisit,
  createExpense,
  createFollowup,
  createMill,
  createVisit,
  deleteMill,
  deleteVisit,
  getMill,
  getVisit,
  resolveFieldStaffRow,
  setFollowupStatus,
  setMillFollowup,
  setMillNewFlag,
} from '../../modules/field-visits/store';
import { getFieldStaffData, invalidateFieldStaffCache, suggestMillMatch } from '../../modules/field-visits/service';
import { getViewerMe } from '../viewer';
import { readBody } from '../http';

function istToday(): string {
  return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

async function viewer(c: any): Promise<any | null> {
  const me: any = await getViewerMe(c).catch(() => null);
  if (!me || !isApproved(me)) return null;
  if (me.isAdmin || me.isRoot) return me;
  const scopes: string[] = ((me.scopes ?? []) as string[]).map((s) => String(s).toLowerCase());
  if (scopes.includes('sales-head') || scopes.includes('telecalling') || scopes.includes('sales')) return me;
  return null;
}

function actorOf(me: any): { id: string; name: string } {
  return {
    id: String(me?.user?.id ?? me?.id ?? ''),
    name: String(me?.user?.name ?? me?.user?.email ?? ''),
  };
}

/** Manager gate for deletes (sales-head / root). */
async function requireSalesManager(c: any): Promise<boolean> {
  try { await requireAdminScope(c); return true; } catch { /* fall through */ }
  const me: any = await getViewerMe(c);
  if (!me) return false;
  if (!isApproved(me)) return false;
  const scopes: string[] = me.scopes ?? [];
  const roles: string[] = me.roles ?? [];
  return scopes.includes('sales-head') || roles.includes('sales-head') || !!me.isAdmin;
}

export function registerFieldStaffRoutes(app: Hono<{ Bindings: Bindings }>): void {
  app.get('/api/field-staff/data', async (c) => {
    const me = await viewer(c);
    if (!me) return c.json({ error: 'authentication required' }, 401);
    const data = await getFieldStaffData({
      from: c.req.query('from'),
      to: c.req.query('to'),
      staffId: c.req.query('staffId'),
    }).catch((e: any) => ({ error: String(e?.message ?? e) }));
    if ((data as any)?.error) return c.json({ error: (data as any).error }, 500);
    return c.json(data);
  });

  app.get('/api/field-staff/match', async (c) => {
    const me = await viewer(c);
    if (!me) return c.json({ error: 'authentication required' }, 401);
    const q = String(c.req.query('q') ?? '');
    return c.json({ q, ...(await suggestMillMatch(q)) });
  });

  app.post('/api/field-staff/check-in', async (c) => {
    const me = await viewer(c);
    if (!me) return c.json({ error: 'authentication required' }, 401);
    const body = await readBody(c);
    const staffId = String(body?.telecallerId ?? body?.staffId ?? '').trim();
    const city = String(body?.city ?? '').trim().slice(0, 200);
    if (!staffId) return c.json({ error: 'telecallerId required' }, 400);
    if (!city) return c.json({ error: 'city required' }, 400);
    const row = await resolveFieldStaffRow(c.env.DB, staffId).catch(() => null);
    if (!row) return c.json({ error: 'field staff not found (active field_staff row required)' }, 404);
    // GPS discontinued — lat/lng in the body are ignored on purpose.
    const actor = actorOf(me);
    const visit = await createVisit(c.env.DB, {
      telecallerId: staffId,
      day: istToday(),
      city,
      address: String(body?.address ?? ''),
      lat: null,
      lng: null,
      note: String(body?.note ?? ''),
      createdBy: actor.id,
      createdByName: actor.name,
    });
    await invalidateFieldStaffCache().catch(() => null);
    notifyLive(c, { type: 'field-staff' as any, action: 'check-in', id: (visit as any)?.id });
    return c.json({ ok: true, visit }, 201);
  });

  // Retired with automated tracking — old clients fail closed with 410.
  app.post('/api/field-staff/ping', async (c) => {
    const me = await viewer(c);
    if (!me) return c.json({ error: 'authentication required' }, 401);
    return c.json({ error: 'location tracking discontinued', retired: true }, 410);
  });

  app.post('/api/field-staff/check-out', async (c) => {
    const me = await viewer(c);
    if (!me) return c.json({ error: 'authentication required' }, 401);
    const body = await readBody(c);
    const visitId = String(body?.visitId ?? '').trim();
    if (!visitId) return c.json({ error: 'visitId required' }, 400);
    const ok = await checkoutVisit(c.env.DB, visitId);
    if (!ok) return c.json({ error: 'visit not found or already checked out' }, 404);
    await invalidateFieldStaffCache().catch(() => null);
    notifyLive(c, { type: 'field-staff' as any, action: 'check-out', id: visitId });
    return c.json({ ok: true });
  });

  app.post('/api/field-staff/visits/:id/mills', async (c) => {
    const me = await viewer(c);
    if (!me) return c.json({ error: 'authentication required' }, 401);
    const visitId = c.req.param('id') ?? '';
    const visit: any = await getVisit(c.env.DB, visitId).catch(() => null);
    if (!visit) return c.json({ error: 'visit not found' }, 404);
    const body = await readBody(c);
    const fields: Record<string, string> = {};
    for (const k of ['millName', 'keyContact', 'designation', 'phone', 'rollerPlantNos', 'attaChakkiNos', 'chakkiSize', 'runningTime', 'products', 'millAgeYrs', 'machineBrand', 'requirement']) {
      fields[k] = String(body?.[k] ?? '');
    }
    if (!fields.millName.trim()) return c.json({ error: 'millName required' }, 400);
    const match = await suggestMillMatch(fields.millName);
    const followUpNeeded = body?.followUpNeeded === true;
    // Follow-up is date-first: a checked box without a valid future date is refused.
    const dueRaw = String(body?.dueDate ?? '').slice(0, 10);
    if (followUpNeeded) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dueRaw)) return c.json({ error: 'follow-up date required (YYYY-MM-DD)' }, 400);
      if (dueRaw < istToday()) return c.json({ error: 'follow-up date cannot be in the past' }, 400);
    }
    const actor = actorOf(me);
    const isManager = await requireSalesManager(c);
    // The visit owns the credit — distinguish "visit gone" from "roster gap"
    // so a stale roster row never masquerades as a missing visit. Managers
    // logging on behalf of a deactivated row bypass the active-check (the
    // visit keeps its stored telecallerId; the write is audit-credited).
    const staffId = String((visit as any).telecallerId ?? '');
    if (!staffId) return c.json({ error: 'visit has no field staff linked' }, 422);
    const staffRow: any = await resolveFieldStaffRow(c.env.DB, staffId).catch(() => null);
    if (!staffRow && !isManager) {
      return c.json({ error: 'field staff not found in the sales roster (ask sales-head to restore the row)' }, 422);
    }
    // Requirement → real Field-Staff enquiry (credited to the staffer), parsed
    // by the SAME AI intake as a normal sales enquiry (vision-intake splits
    // aiPending items / description — never our deterministic mapping).
    // Identity stays deterministic (client/contact/location); the free text
    // (requirement + mill profile) goes in as ONE raw aiPending item, exactly
    // like EnquiryDetail "Add via AI". Intake replaces it with split lines.
    let enquiryId = '';
    let rosterWarning = '';
    const requirement = fields.requirement.trim();
    if (requirement) {
      try {
        const profile = [
          fields.keyContact && `Contact: ${fields.keyContact}${fields.designation ? ` (${fields.designation})` : ''}${fields.phone ? ` · ${fields.phone}` : ''}`,
          fields.rollerPlantNos && `Roller plant: ${fields.rollerPlantNos}`,
          fields.attaChakkiNos && `Atta chakki: ${fields.attaChakkiNos}`,
          fields.chakkiSize && `Chakki size: ${fields.chakkiSize}`,
          fields.runningTime && `Running: ${fields.runningTime}`,
          fields.products && `Products: ${fields.products}`,
          fields.millAgeYrs && `Age: ${fields.millAgeYrs} yrs`,
          fields.machineBrand && `Brand: ${fields.machineBrand}`,
        ].filter(Boolean).join('\n');
        const capture = `${requirement}${profile ? `\n\n— Mill profile (field visit ${String((visit as any).day ?? '')} ${String((visit as any).city ?? '')}, ${fields.millName.trim()}) —\n${profile}` : ''}`.slice(0, 3000);
        const r: any = await enquiryCreate(createEnquiryStore(c.env), me, {
          source: 'Field Staff',
          fieldStaffId: String((visit as any).telecallerId),
          assignedAgentId: actor.id,
          clientCompany: fields.millName.slice(0, 200),
          contactName: fields.keyContact.slice(0, 200),
          contactPhone: fields.phone.slice(0, 50),
          location: String((visit as any).city ?? '').slice(0, 200),
          description: requirement.slice(0, 2000),
          additionalRequirements: [{ text: capture }],
          items: [{ name: '', qty: '', spec: capture.slice(0, 2000), media: [], aiPending: true }],
        } as any);
        if (r?.status === 201 && (r.body as any)?.id) {
          enquiryId = String((r.body as any).id);
          // Same write-time AI as a normal sales enquiry: extraction fills
          // client fields, vision-intake splits the aiPending capture into
          // items. Best-effort in waitUntil — never fails the mill save.
          try {
            const eid = enquiryId;
            const p = (async () => {
              try {
                const store = createEnquiryStore(c.env);
                const { runEnquiryExtraction } = await import('../../modules/enquiries/extraction');
                await runEnquiryExtraction(c.env as any, store, eid).catch(() => null);
              } catch {}
              try {
                const store = createEnquiryStore(c.env);
                const { runAgnesVisionIntake } = await import('../../modules/enquiries/vision-intake');
                await runAgnesVisionIntake(c.env as any, store, eid).catch(() => null);
              } catch {}
              try { const { cacheDel } = await import('../../shared/cache'); await cacheDel(`enquiry:redacted:${eid}`); } catch {}
            })();
            if (c.executionCtx?.waitUntil) c.executionCtx.waitUntil(p as any);
            else void (p as any);
          } catch {}
          // The enquiry write broadcast its own typed event; keep ours too so
          // the Field Staff board refetches in the same tick.
        } else if (r?.status && r.status >= 400) {
          const msg = String((r.body as any)?.error ?? 'enquiry creation failed');
          if (isManager && !staffRow && /field staff/i.test(msg)) {
            rosterWarning = 'saved without enquiry — roster row inactive';
          } else {
            return c.json({ error: msg }, 502);
          }
        }
      } catch (e: any) {
        const msg2 = String(e?.message ?? e);
        if (isManager && !staffRow && /field staff/i.test(msg2)) {
          rosterWarning = 'saved without enquiry — roster row inactive';
        } else {
          return c.json({ error: `enquiry creation failed: ${msg2}` }, 502);
        }
      }
    }
    const mill = await createMill(c.env.DB, {
      visitId,
      fields,
      isNewSuggested: match.isNewSuggested,
      matchMasterId: match.matchMasterId,
      matchMasterName: match.matchMasterName,
      enquiryId,
      followUpNeeded,
      createdBy: actor.id,
      createdByName: actor.name,
    });
    // Auto follow-up row when flagged (global queue; visit link kept, date-first).
    if (followUpNeeded) {
      const { createFollowup } = await import('../../modules/field-visits/store');
      await createFollowup(c.env.DB, {
        visitId,
        millVisitId: String((mill as any)?.id ?? ''),
        dueDate: dueRaw,
        note: String(body?.followupNote ?? requirement).slice(0, 1000),
        owner: String(body?.owner ?? ''),
        createdBy: actor.id,
        createdByName: actor.name,
      }).catch(() => null);
    }
    await invalidateFieldStaffCache().catch(() => null);
    notifyLive(c, { type: 'field-staff' as any, action: 'mill-added', id: visitId });
    return c.json({ ok: true, mill, match, enquiryId, rosterWarning: rosterWarning || undefined }, 201);
  });

  app.delete('/api/field-staff/visits/:id', async (c) => {
    const me = await viewer(c);
    if (!me) return c.json({ error: 'authentication required' }, 401);
    if (!(await requireSalesManager(c))) return c.json({ error: 'sales-head or root only' }, 403);
    const ok = await deleteVisit(c.env.DB, c.req.param('id') ?? '');
    if (!ok) return c.json({ error: 'visit not found' }, 404);
    await invalidateFieldStaffCache().catch(() => null);
    notifyLive(c, { type: 'field-staff' as any, action: 'visit-deleted', id: c.req.param('id') });
    return c.json({ ok: true });
  });

  app.delete('/api/field-staff/mills/:id', async (c) => {
    const me = await viewer(c);
    if (!me) return c.json({ error: 'authentication required' }, 401);
    if (!(await requireSalesManager(c))) return c.json({ error: 'sales-head or root only' }, 403);
    const existing: any = await getMill(c.env.DB, c.req.param('id') ?? '').catch(() => null);
    if (!existing) return c.json({ error: 'mill not found' }, 404);
    const ok = await deleteMill(c.env.DB, c.req.param('id') ?? '');
    if (!ok) return c.json({ error: 'mill not found' }, 404);
    await invalidateFieldStaffCache().catch(() => null);
    notifyLive(c, { type: 'field-staff' as any, action: 'mill-deleted', id: String((existing as any)?.visitId ?? '') });
    return c.json({ ok: true });
  });

  app.put('/api/field-staff/mills/:id/flag', async (c) => {
    const me = await viewer(c);
    if (!me) return c.json({ error: 'authentication required' }, 401);
    const body = await readBody(c);
    // null clears back to the auto suggestion; followUpNeeded=true creates a
    // dated follow-up row (date-first), false cancels the mill's open rows.
    const isNew = body?.isNew === null || body?.isNew === undefined ? null : body.isNew === true;
    const ok = await setMillNewFlag(c.env.DB, c.req.param('id') ?? '', isNew);
    if (!ok) return c.json({ error: 'mill not found' }, 404);
    const actor = actorOf(me);
    if (body?.followUpNeeded === true) {
      const due = String(body?.dueDate ?? '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) return c.json({ error: 'follow-up date required (YYYY-MM-DD)' }, 400);
      if (due < istToday()) return c.json({ error: 'follow-up date cannot be in the past' }, 400);
      await setMillFollowup(c.env.DB, c.req.param('id') ?? '', true);
      const mill: any = await getMill(c.env.DB, c.req.param('id') ?? '').catch(() => null);
      const { listFollowups, createFollowup } = await import('../../modules/field-visits/store');
      const existing = await listFollowups(c.env.DB, null, 'open').catch(() => []);
      const hasOpen = (existing as any[]).some((f: any) => String((f as any)?.millVisitId ?? '') === String(c.req.param('id') ?? ''));
      if (!hasOpen) {
        await createFollowup(c.env.DB, {
          visitId: String((mill as any)?.visitId ?? ''),
          millVisitId: String(c.req.param('id') ?? ''),
          dueDate: due,
          note: String(body?.note ?? body?.followupNote ?? '').slice(0, 1000),
          owner: String(body?.owner ?? ''),
          createdBy: actor.id,
          createdByName: actor.name,
        }).catch(() => null);
      }
    } else if (body?.followUpNeeded === false) {
      await setMillFollowup(c.env.DB, c.req.param('id') ?? '', false);
      const { cancelOpenFollowupsForMill } = await import('../../modules/field-visits/store');
      await cancelOpenFollowupsForMill(c.env.DB, c.req.param('id') ?? '').catch(() => null);
    }
    await invalidateFieldStaffCache().catch(() => null);
    notifyLive(c, { type: 'field-staff' as any, action: 'mill-flag', id: c.req.param('id') });
    return c.json({ ok: true, isNew });
  });

  // Compat: visit-bound expense write (inherits day/staff from the visit).
  app.post('/api/field-staff/visits/:id/expenses', async (c) => {
    const me = await viewer(c);
    if (!me) return c.json({ error: 'authentication required' }, 401);
    const visitId = c.req.param('id') ?? '';
    const visit: any = await getVisit(c.env.DB, visitId).catch(() => null);
    if (!visit) return c.json({ error: 'visit not found' }, 404);
    const body = await readBody(c);
    const amount = Number(body?.amount ?? NaN);
    const description = String(body?.description ?? '').trim();
    if (!Number.isFinite(amount) || amount < 0) return c.json({ error: 'amount must be a non-negative number' }, 400);
    if (!description) return c.json({ error: 'description required' }, 400);
    const actor = actorOf(me);
    const expense = await createExpense(c.env.DB, {
      visitId, amount, description, createdBy: actor.id, createdByName: actor.name,
    });
    await invalidateFieldStaffCache().catch(() => null);
    notifyLive(c, { type: 'field-staff' as any, action: 'expense', id: visitId });
    return c.json({ ok: true, expense }, 201);
  });

  // Global day-wise expense log (no visit required — calendar writes here).
  app.get('/api/field-staff/expenses', async (c) => {
    const me = await viewer(c);
    if (!me) return c.json({ error: 'authentication required' }, 401);
    const { listExpenses } = await import('../../modules/field-visits/store');
    const rows = await listExpenses(c.env.DB, [], {
      from: c.req.query('from') ?? '',
      to: c.req.query('to') ?? '',
      staffId: c.req.query('staffId') ?? null,
    }).catch((e: any) => ({ error: String(e?.message ?? e) }));
    if ((rows as any)?.error) return c.json({ error: (rows as any).error }, 500);
    return c.json({ expenses: rows });
  });

  app.post('/api/field-staff/expenses', async (c) => {
    const me = await viewer(c);
    if (!me) return c.json({ error: 'authentication required' }, 401);
    const body = await readBody(c);
    const amount = Number(body?.amount ?? NaN);
    const description = String(body?.description ?? '').trim();
    const day = String(body?.day ?? '').slice(0, 10);
    const staffId = String(body?.staffId ?? body?.telecallerId ?? '').trim();
    if (!Number.isFinite(amount) || amount < 0) return c.json({ error: 'amount must be a non-negative number' }, 400);
    if (!description) return c.json({ error: 'description required' }, 400);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return c.json({ error: 'day (YYYY-MM-DD) required' }, 400);
    if (!staffId) return c.json({ error: 'staffId required' }, 400);
    const row = await resolveFieldStaffRow(c.env.DB, staffId).catch(() => null);
    if (!row) return c.json({ error: 'field staff not found (active field_staff row required)' }, 404);
    const actor = actorOf(me);
    const expense = await createExpense(c.env.DB, {
      visitId: String(body?.visitId ?? ''),
      day, staffId, amount, description, createdBy: actor.id, createdByName: actor.name,
    });
    await invalidateFieldStaffCache().catch(() => null);
    notifyLive(c, { type: 'field-staff' as any, action: 'expense', id: day });
    return c.json({ ok: true, expense }, 201);
  });

  // Compat: visit-bound follow-up write (date-first — dueDate always required).
  app.post('/api/field-staff/visits/:id/followups', async (c) => {
    const me = await viewer(c);
    if (!me) return c.json({ error: 'authentication required' }, 401);
    const visitId = c.req.param('id') ?? '';
    const visit: any = await getVisit(c.env.DB, visitId).catch(() => null);
    if (!visit) return c.json({ error: 'visit not found' }, 404);
    const body = await readBody(c);
    const due = String(body?.dueDate ?? '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) return c.json({ error: 'follow-up date required (YYYY-MM-DD)' }, 400);
    if (due < istToday()) return c.json({ error: 'follow-up date cannot be in the past' }, 400);
    const actor = actorOf(me);
    const followup = await createFollowup(c.env.DB, {
      visitId,
      millVisitId: String(body?.millVisitId ?? ''),
      dueDate: due,
      note: String(body?.note ?? ''),
      owner: String(body?.owner ?? actor.name),
      createdBy: actor.id,
      createdByName: actor.name,
    });
    await invalidateFieldStaffCache().catch(() => null);
    notifyLive(c, { type: 'field-staff' as any, action: 'followup', id: visitId });
    return c.json({ ok: true, followup }, 201);
  });

  // Global follow-up queue: list + file without a visit.
  app.get('/api/field-staff/followups', async (c) => {
    const me = await viewer(c);
    if (!me) return c.json({ error: 'authentication required' }, 401);
    const { listFollowups } = await import('../../modules/field-visits/store');
    const rows = await listFollowups(c.env.DB, null, c.req.query('status') || null, {
      from: c.req.query('from') ?? '',
      to: c.req.query('to') ?? '',
      staffId: c.req.query('staffId') ?? null,
    }).catch((e: any) => ({ error: String(e?.message ?? e) }));
    if ((rows as any)?.error) return c.json({ error: (rows as any).error }, 500);
    return c.json({ followups: rows });
  });

  app.post('/api/field-staff/followups', async (c) => {
    const me = await viewer(c);
    if (!me) return c.json({ error: 'authentication required' }, 401);
    const body = await readBody(c);
    const note = String(body?.note ?? '').trim();
    if (!note) return c.json({ error: 'note required' }, 400);
    const actor = actorOf(me);
    // visitId optional — global rows store visitId=''.
    let visitId = String(body?.visitId ?? '');
    let day = String(body?.day ?? '').slice(0, 10);
    let staffId = String(body?.staffId ?? body?.telecallerId ?? '').trim();
    let millVisitId = String(body?.millVisitId ?? '');
    if (millVisitId && (!staffId || !day)) {
      const m: any = await getMill(c.env.DB, millVisitId).catch(() => null);
      if (m) {
        if (!visitId) visitId = String((m as any).visitId ?? '');
        const v: any = visitId ? await getVisit(c.env.DB, visitId).catch(() => null) : null;
        if (v) {
          if (!day) day = String((v as any).day ?? '');
          if (!staffId) staffId = String((v as any).telecallerId ?? '');
        }
      } else {
        millVisitId = '';
      }
    }
    if (visitId && (!day || !staffId)) {
      const v: any = await getVisit(c.env.DB, visitId).catch(() => null);
      if (!v) return c.json({ error: 'visit not found' }, 404);
      if (!day) day = String((v as any).day ?? '');
      if (!staffId) staffId = String((v as any).telecallerId ?? '');
    }
    if (!staffId) return c.json({ error: 'staffId required' }, 400);
    const row = await resolveFieldStaffRow(c.env.DB, staffId).catch(() => null);
    if (!row) return c.json({ error: 'field staff not found (active field_staff row required)' }, 404);
    if (!day) day = istToday();
    const due = String(body?.dueDate ?? '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) return c.json({ error: 'follow-up date required (YYYY-MM-DD)' }, 400);
    if (due < istToday()) return c.json({ error: 'follow-up date cannot be in the past' }, 400);
    const followup = await createFollowup(c.env.DB, {
      visitId, day, staffId, millVisitId,
      dueDate: due,
      note,
      owner: String(body?.owner ?? actor.name),
      createdBy: actor.id,
      createdByName: actor.name,
    });
    await invalidateFieldStaffCache().catch(() => null);
    notifyLive(c, { type: 'field-staff' as any, action: 'followup', id: visitId || day });
    return c.json({ ok: true, followup }, 201);
  });

  app.patch('/api/field-staff/followups/:id', async (c) => {
    const me = await viewer(c);
    if (!me) return c.json({ error: 'authentication required' }, 401);
    const body = await readBody(c);
    const status = String(body?.status ?? '').trim();
    if (!['open', 'done', 'cancelled'].includes(status)) return c.json({ error: 'status must be open|done|cancelled' }, 400);
    const ok = await setFollowupStatus(c.env.DB, c.req.param('id') ?? '', status);
    if (!ok) return c.json({ error: 'followup not found' }, 404);
    await invalidateFieldStaffCache().catch(() => null);
    notifyLive(c, { type: 'field-staff' as any, action: 'followup-status', id: c.req.param('id') });
    return c.json({ ok: true, status });
  });
}
