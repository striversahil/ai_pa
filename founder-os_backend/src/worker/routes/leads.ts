// ─────────────────────────────────────────────────────────────────────────────
// routes/leads.ts — lead intake ledger API (Phase 7c/7d).
//
// Worker-only (Express is frozen). Reads are scope-filtered server-side:
//   ALL/DEPARTMENT (root/MIS/sales-head) → everything.
//   TEAM (TL1/TL2) → rows in their regions (region-less rows stay head-only).
//   OWN (exec/field) → rows assigned to their own roster id.
// Writes (qualify/drop) go through modules/core/leads.ts ONLY — this file
// never INSERT/UPDATE/DELETEs core_* directly (core-guard rule 3).
// Qualification gate: requireLeadQualifier = root | MIS | sales-head |
// team_lead scoped to [region, region2]. Region-less leads are head-only.
// ─────────────────────────────────────────────────────────────────────────────
import type { Hono } from 'hono';
import { authStore, deps, getMe, notifyLive, readSessionCookie, LiveEvent, type Bindings } from '../context';
import { resolveCaller } from '../../modules/core/permissions';

function shapeLead(r: any): any {
  return {
    id: String(r.id ?? ''),
    status: String(r.status ?? ''),
    outcome: String(r.outcome ?? ''),
    customerName: String(r.customerName ?? ''),
    clientCompany: String(r.clientCompany ?? ''),
    contactName: String(r.contactName ?? ''),
    contactPhone: String(r.contactPhone ?? ''),
    location: String(r.location ?? ''),
    region: String(r.region ?? ''),
    sourceName: String(r.sourceName ?? ''),
    sourceRaw: String(r.sourceRaw ?? ''),
    productText: String(r.productText ?? ''),
    quotedRateAmount: r.quotedRateAmount ?? null,
    expectedRateAmount: r.expectedRateAmount ?? null,
    disqualifyReason: String(r.disqualifyReason ?? ''),
    qualifiedBy: String(r.qualifiedBy ?? ''),
    qualifiedAt: String(r.qualifiedAt ?? ''),
    enquiryId: String(r.enquiryId ?? ''),
    estimateId: String(r.estimateId ?? ''),
    estNumber: String(r.estNumber ?? ''),
    occurredAt: String(r.occurredAt ?? ''),
    captureKind: String(r.captureKind ?? ''),
  };
}

async function rosterRegions(p: any, email: string): Promise<{ id: string; regions: string[]; isTl: boolean } | null> {
  try {
    const em = String(email ?? '').trim().toLowerCase();
    if (!em) return null;
    const rows: any[] = await p.telecaller.findMany({}).catch(() => []);
    const hit = (rows as any[]).find((t) => String(t.email ?? '').trim().toLowerCase() === em && !t.deleted);
    if (!hit) return null;
    const regions = [String(hit.region ?? ''), String(hit.region2 ?? '')].filter(Boolean);
    const isTl = String(hit.type ?? '') === 'team_lead'
      || String(hit.tlLevel ?? '') === 'TL1' || String(hit.tlLevel ?? '') === 'TL2';
    return { id: String(hit.id ?? ''), regions, isTl };
  } catch { return null; }
}

export function registerLeadRoutes(app: Hono<{ Bindings: Bindings }>): void {
  const viewer = async (c: any) => {
    const me = await getMe(authStore(c), readSessionCookie(c.req.header('cookie') ?? null));
    if (!me) return { me: null as any, error: c.json({ error: 'Authentication required' }, 401) };
    return { me, error: null as any };
  };

  /** Gate for qualify/drop. Returns {actor} or {error}. */
  const qualifier = async (c: any, me: any) => {
    const { prisma } = deps();
    const p = prisma as any;
    const scopes: string[] = (me?.scopes ?? []).map((s: string) => String(s).toLowerCase());
    const roles: string[] = (me?.roles ?? []).map((s: string) => String(s).toLowerCase());
    const name = String(me?.user?.name ?? me?.user?.email ?? 'manager');
    if (me?.isAdmin || scopes.includes('mis') || scopes.includes('sales-head') || roles.includes('sales-head')) {
      return { actor: { name, role: 'sales-head', regions: null as string[] | null }, error: null as any };
    }
    const ros = await rosterRegions(p, String(me?.user?.email ?? ''));
    if (ros?.isTl) {
      return { actor: { name, role: 'team-lead', regions: ros.regions }, error: null as any };
    }
    return { actor: null as any, error: c.json({ error: 'team-lead, sales-head, MIS or root only' }, 403) };
  };

  /** Scope filter for reads. TEAM = own regions only (region-less stay head-only). */
  const rosterFor = async (p: any, me: any, scope: string) => {
    if (scope === 'TEAM' || scope === 'OWN') return rosterRegions(p, String(me?.user?.email ?? ''));
    return null;
  };

  // Can this login qualify? (UI gate — the PUTs re-check server-side.)
  app.get('/api/leads/me', async (c) => {
    const v = await viewer(c);
    if (v.error) return v.error;
    const q = await qualifier(c, v.me);
    return c.json({ canQualify: !q.error, regions: q.actor?.regions ?? null });
  });

  // Unqualified queue (new leads awaiting TL/head triage).
  app.get('/api/leads/unqualified', async (c) => {
    const v = await viewer(c);
    if (v.error) return v.error;
    try {
      const { prisma } = deps();
      const p = prisma as any;
      const caller = await resolveCaller(p, v.me.user?.id ?? null, v.me);
      const ros = await rosterFor(p, v.me, caller.scope);
      const all: any[] = await p.coreLead.findMany({}).catch(() => []);
      const scoped = all.filter((r) => {
        if (String(r.status ?? '') !== 'unqualified' || String(r.outcome ?? '') !== 'open') return false;
        if (caller.scope === 'ALL' || caller.scope === 'DEPARTMENT') return true;
        if (caller.scope === 'TEAM') return !!String(r.region ?? '') && (ros?.regions ?? []).includes(String(r.region));
        const aid = String(ros?.id ?? caller.employeeId ?? '');
        return !!aid && String(r.assignedAgentId ?? '') === aid;
      }).sort((a, b) => String(b.occurredAt ?? '').localeCompare(String(a.occurredAt ?? '')));
      return c.json({ leads: scoped.slice(0, 300).map(shapeLead), scope: caller.scope });
    } catch (e: any) {
      return c.json({ error: e?.message ?? 'leads unavailable' }, 500);
    }
  });

  // Losses with rates (price intelligence: quoted per product per source).
  app.get('/api/leads/losses', async (c) => {
    const v = await viewer(c);
    if (v.error) return v.error;
    try {
      const { prisma } = deps();
      const p = prisma as any;
      const caller = await resolveCaller(p, v.me.user?.id ?? null, v.me);
      const ros = await rosterFor(p, v.me, caller.scope);
      const source = String(c.req.query('source') ?? '');
      const from = String(c.req.query('from') ?? '').slice(0, 10);
      const to = String(c.req.query('to') ?? '').slice(0, 10);
      const all: any[] = await p.coreLead.findMany({}).catch(() => []);
      const scoped = all.filter((r) => {
        if (String(r.outcome ?? '') !== 'lost' && String(r.outcome ?? '') !== 'dropped') return false;
        if (source && String(r.sourceName ?? '') !== source) return false;
        const d = String(r.occurredAt ?? '').slice(0, 10);
        if (from && d < from) return false;
        if (to && d > to) return false;
        if (caller.scope === 'ALL' || caller.scope === 'DEPARTMENT') return true;
        if (caller.scope === 'TEAM') return !!String(r.region ?? '') && (ros?.regions ?? []).includes(String(r.region));
        const aid = String(ros?.id ?? caller.employeeId ?? '');
        return !!aid && String(r.assignedAgentId ?? '') === aid;
      }).sort((a, b) => String(b.occurredAt ?? '').localeCompare(String(a.occurredAt ?? '')));
      const total = scoped.reduce((s, r) => s + (Number(r.quotedRateAmount ?? 0) || 0), 0);
      return c.json({ leads: scoped.slice(0, 500).map(shapeLead), count: scoped.length, quotedTotal: total, scope: caller.scope });
    } catch (e: any) {
      return c.json({ error: e?.message ?? 'losses unavailable' }, 500);
    }
  });

  app.put('/api/leads/:id/qualify', async (c) => {
    const v = await viewer(c);
    if (v.error) return v.error;
    try {
      const q = await qualifier(c, v.me);
      if (q.error) return q.error;
      const { qualifyLead } = await import('../../modules/core/leads');
      const body = await c.req.json().catch(() => ({}));
      const r = await qualifyLead(c.req.param('id') ?? '', q.actor, String((body as any)?.note ?? ''));
      if (!r.ok) return c.json({ error: r.error ?? 'qualify failed' }, 400);
      notifyLive(c, { type: LiveEvent.Leads });
      return c.json({ ok: true });
    } catch (e: any) {
      return c.json({ error: e?.message ?? 'qualify failed' }, 500);
    }
  });

  app.put('/api/leads/:id/drop', async (c) => {
    const v = await viewer(c);
    if (v.error) return v.error;
    try {
      const q = await qualifier(c, v.me);
      if (q.error) return q.error;
      const { dropLead } = await import('../../modules/core/leads');
      const body = await c.req.json().catch(() => ({}));
      const r = await dropLead(c.req.param('id') ?? '', q.actor,
        String((body as any)?.reason ?? 'other'), String((body as any)?.detail ?? ''));
      if (!r.ok) return c.json({ error: r.error ?? 'drop failed' }, 400);
      notifyLive(c, { type: LiveEvent.Leads });
      return c.json({ ok: true });
    } catch (e: any) {
      return c.json({ error: e?.message ?? 'drop failed' }, 500);
    }
  });
}
