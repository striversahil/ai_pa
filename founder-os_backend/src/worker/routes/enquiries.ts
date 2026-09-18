// ─────────────────────────────────────────────────────────────────────────────
// routes/enquiries.ts — live sales-pipeline enquiry tracker.
// ─────────────────────────────────────────────────────────────────────────────
import type { Hono } from 'hono';
import { enquiryMe, enquirySend, EnquiryRoutes, createEnquiryStore, authStore, deps, getEstimatesPayload, type Bindings } from '../context';
import { chatTurn, executeProposal } from '../../modules/enquiries/chat';
import { cacheDel } from '../../shared/cache';
import { getGateway } from '../../shared/ai-gateway';
import { runEnquiryExtraction } from '../../modules/enquiries/enrichment';
import { dispatchGitHubWorkflow, INTAKE_WORKFLOW } from '../cron';

// Fire the intake workflow the moment an enquiry is logged (event-driven;
// the 30-min backstop sweep covers anything the dispatch misses).
// Best-effort via waitUntil —
// never blocks or fails the request; no token locally means skip silently.
function kickIntakeNow(c: any): void {
  try {
    const token = String((c.env as any)?.GITHUB_ACCESS_TOKEN ?? '').trim();
    if (!token) return;
    const task = dispatchGitHubWorkflow(INTAKE_WORKFLOW, token);
    if (c.executionCtx && typeof c.executionCtx.waitUntil === 'function') {
      c.executionCtx.waitUntil(task);
    } else {
      void task;
    }
  } catch { /* intake dispatch never fails a request */ }
}

function aiConfigured(c: any): boolean {
  try {
    return getGateway(c.env as any).keyCount > 0;
  } catch {
    return true;
  }
}

// Background AI enrichment (structured fields + procurement redaction cache).
// Fire-and-forget via waitUntil — never blocks or fails the request.
function kick(c: any, id: string): void {
  try {
    const store = createEnquiryStore(c.env);
    const task = runEnquiryExtraction(c.env, store, String(id));
    if (c.executionCtx && typeof c.executionCtx.waitUntil === 'function') {
      c.executionCtx.waitUntil(task);
    } else {
      void task;
    }
  } catch { /* enrichment never fails a request */ }
}

  // Live Zoho status chip: enrich enquiries with Estimate.status (from the
  // 5-min zoho-sent sync's 400 last-modified window). Single D1 IN query,
  // no extra Zoho reads, no AI — status goes live via the same 5-min tick.
  async function attachZohoStatus(enquiries: any[]): Promise<void> {
    const nums = [...new Set((enquiries as any[]).map((e) => String((e as any)?.estNumber ?? '').trim()).filter(Boolean))];
    if (!nums.length) return;
    try {
      const { prisma } = deps();
      const rows = await (prisma as any).estimate.findMany({
        where: { estimateNumber: { in: nums } },
        select: { estimateNumber: true, status: true },
      });
      const map = new Map<string, string>((rows as any[]).map((r) => [String(r.estimateNumber), String(r.status)]));
      for (const e of enquiries as any[]) {
        const s = map.get(String((e as any)?.estNumber ?? '').trim());
        (e as any).zohoStatus = s ?? null;
      }
    } catch {}
  }

export function registerEnquiryRoutes(app: Hono<{ Bindings: Bindings }>): void {
  app.get('/api/enquiries', async (c) => {
    const me = await enquiryMe(c);
    if (!me) return c.json({ error: 'Authentication required' }, 401);
    // ?view=procurement lets privileged users (root/MIS) preview exactly what
    // procurement sees — the AI-redacted payload, not their full data.
    // ?page=&limit= (10/50) pages newest-first for the queue tables.
    const restricted = c.req.query('view') === 'procurement' || EnquiryRoutes.isRestrictedViewer(me);
    const pageQ = c.req.query('page');
    const limitQ = c.req.query('limit');
    const opts: { redact?: boolean; page?: number; limit?: number; aiConfigured?: boolean } | undefined =
      restricted || pageQ !== undefined || limitQ !== undefined
        ? {
            ...(restricted ? { redact: true, aiConfigured: aiConfigured(c) } : {}),
            ...(pageQ !== undefined ? { page: Number(pageQ) } : {}),
            ...(limitQ !== undefined ? { limit: Number(limitQ) } : {}),
          }
        : undefined;
    const r = await EnquiryRoutes.enquiryList(createEnquiryStore(c.env), me, opts);
    // Enrich with live Zoho status (from Estimate table, already synced every 5min)
    try {
      const list = (r.body as any)?.enquiries;
      if (Array.isArray(list)) await attachZohoStatus(list);
    } catch {}
    if (restricted) {
      for (const id of ((r.body as any)?.redactionPendingIds ?? []) as string[]) kick(c, String(id));
    }
    return c.json(r.body, r.status as any);
  });
  app.get('/api/enquiries/agents', async (c) => {
    const me = await enquiryMe(c);
    if (!me) return c.json({ error: 'Authentication required' }, 401);
    // Restricted (procurement) viewers get NO roster — without names, the
    // stored lead ids can't be resolved to a person on their screen.
    if (c.req.query('view') === 'procurement' || EnquiryRoutes.isRestrictedViewer(me)) return c.json([]);
    // "Lead by" roster = ACTIVE + PRESENT sales staff, exactly like the
    // telecalling dashboard: Telecaller rows that are not soft-deleted and not
    // marked absent (absentSince set by the MIS Controller). Filtered in code
    // (not in the D1 where-clause) so a shim null-handling quirk can never
    // leak absent staff into the list.
    const { prisma } = deps();
    const roster = await prisma.telecaller.findMany({ where: { deleted: false }, orderBy: { order: 'asc' } });
    const agents = (roster as any[])
      .filter((t) => t && !(t as any).absentSince)
      .map((t: any) => ({
        id: String(t.id),
        name: t.name,
        email: t.email ?? null,
        picture: null,
      }));
    return c.json(agents);
  });
  app.get('/api/enquiries/clients', async (c) => {
    const me = await enquiryMe(c);
    if (!me) return c.json({ error: 'Authentication required' }, 401);
    // Restricted (procurement) viewers get NO client names — the pipeline
    // hides client PII for them (same rule as the agents roster above).
    if (c.req.query('view') === 'procurement' || EnquiryRoutes.isRestrictedViewer(me)) return c.json([]);
    const [payload, enquiries] = await Promise.all([
      getEstimatesPayload().catch(() => ({ estimates: [] as any[] })),
      createEnquiryStore(c.env).listEnquiries().catch(() => [] as any[]),
    ]);
    // Merge Zoho customers (with open-estimate counts) + companies already
    // used on enquiries (covers "+ New client" entries pre-Zoho-sync).
    const byKey = new Map<string, { name: string; openEstimates: number; enquiries: number }>();
    for (const e of (payload as any).estimates ?? []) {
      const name = String(e?.customerName ?? '').trim();
      if (!name) continue;
      const key = name.toLowerCase();
      const row = byKey.get(key) ?? { name, openEstimates: 0, enquiries: 0 };
      row.openEstimates += 1;
      byKey.set(key, row);
    }
    for (const e of (enquiries as any[]) ?? []) {
      const name = String((e as any)?.clientCompany ?? '').trim();
      if (!name) continue;
      const key = name.toLowerCase();
      const row = byKey.get(key) ?? { name, openEstimates: 0, enquiries: 0 };
      row.enquiries += 1;
      byKey.set(key, row);
    }
    const clients = [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
    return c.json(clients);
  });
  app.post('/api/enquiries', async (c) => {
    const me = await enquiryMe(c);
    if (!me) return c.json({ error: 'Authentication required' }, 401);
    const body = await c.req.json().catch(() => ({}));
    // Lead auto-detect: no selector in the form — the creator's roster row
    // (matched by login email, telecalling creator-first pattern) owns it.
    if (!String(body?.assignedAgentId ?? '').trim()) {
      try {
        body.assignedAgentId = (await EnquiryRoutes.resolveCreatorAgentId(deps().prisma, me)) ?? '';
      } catch { /* fallback below (auth id) */ }
    }
    const r = await EnquiryRoutes.enquiryCreate(createEnquiryStore(c.env), me, body);
    enquirySend(c, r);
    // New free text needs its procurement-safe rewrite now — otherwise the
    // redacted copy only appears after the next list fetch kicks enrichment.
    if ((r as any).status === 201 && (r.body as any)?.id) {
      kick(c, String((r.body as any).id));
      // ...and the vision intake starts NOW (event-driven) instead of waiting
      // for the next 1-minute sweep.
      kickIntakeNow(c);
    }
    return c.json(r.body, r.status as any);
  });
  app.patch('/api/enquiries/:id', async (c) => {
    const me = await enquiryMe(c);
    if (!me) return c.json({ error: 'Authentication required' }, 401);
    const patchBody = await c.req.json().catch(() => ({}));
    const r = await EnquiryRoutes.enquiryUpdate(createEnquiryStore(c.env), me, c.req.param('id') ?? '', patchBody);
    enquirySend(c, r);
    if ((r as any).status === 200 && (r.body as any)?.id) {
      kick(c, String((r.body as any).id));
      // Fresh free text → re-run vision intake now. Detail-view "Add via AI"
      // saves carry `aiPending` items (unstructured spec + photos) — they
      // kick intake too; plain item-only saves skip it (the sweep covers
      // everything as backstop).
      const hasAiBulk = Array.isArray((patchBody as any)?.items)
        && (patchBody as any).items.some((it: any) => it?.aiPending === true);
      if ((patchBody as any)?.description !== undefined || hasAiBulk) kickIntakeNow(c);
    }
    return c.json(r.body, r.status as any);
  });
  app.post('/api/enquiries/:id/additional-requirements', async (c) => {
    const me = await enquiryMe(c);
    if (!me) return c.json({ error: 'Authentication required' }, 401);
    const r = await EnquiryRoutes.enquiryAddRequirement(createEnquiryStore(c.env), me, c.req.param('id') ?? '', await c.req.json().catch(() => ({})));
    enquirySend(c, r);
    if ((r as any).status === 201) kick(c, String(c.req.param('id') ?? ''));
    return c.json(r.body, r.status as any);
  });
  app.delete('/api/enquiries/:id', async (c) => {
    const me = await enquiryMe(c);
    if (!me) return c.json({ error: 'Authentication required' }, 401);
    const r = await EnquiryRoutes.enquiryDelete(createEnquiryStore(c.env), me, c.req.param('id') ?? '');
    enquirySend(c, r);
    if ((r as any).status === 200) {
      try {
        await cacheDel(`enquiry:redacted:${c.req.param('id') ?? ''}`);
      } catch { /* best-effort */ }
    }
    return c.json(r.body, r.status as any);
  });
  // Scoped single-row read for live merge (see enquiryGet): the broadcast
  // carries ids only, so views fetch the one changed row. Restricted
  // (procurement) viewers get 403 — their payload only comes from the list.
  app.get('/api/enquiries/:id', async (c) => {
    const me = await enquiryMe(c);
    if (!me) return c.json({ error: 'Authentication required' }, 401);
    const r = await EnquiryRoutes.enquiryGet(createEnquiryStore(c.env), me, c.req.param('id') ?? '');
    try {
      const enq = (r.body as any)?.enquiry;
      if (enq) await attachZohoStatus([enq]);
    } catch {}
    return c.json(r.body, r.status as any);
  });
  app.get('/api/enquiries/:id/comments', async (c) => {    const me = await enquiryMe(c);
    if (!me) return c.json({ error: 'Authentication required' }, 401);
    const restricted = c.req.query('view') === 'procurement' || EnquiryRoutes.isRestrictedViewer(me);
    const r = await EnquiryRoutes.enquiryComments(createEnquiryStore(c.env), me, c.req.param('id') ?? '', restricted ? { redact: true, aiConfigured: aiConfigured(c) } : undefined);
    if (restricted) {
      for (const id of ((r.body as any)?.redactionPendingIds ?? []) as string[]) kick(c, String(id));
    }
    return c.json(r.body, r.status as any);
  });
  app.get('/api/enquiries/:id/intake', async (c) => {
    const me = await enquiryMe(c);
    if (!me) return c.json({ error: 'Authentication required' }, 401);
    const r = await EnquiryRoutes.enquiryIntake(me, c.req.param('id') ?? '');
    return c.json(r.body, r.status as any);
  });
  // Per-enquiry copilot: agentic sidebar chat (OpenRouter-only tools loop).
  app.post('/api/enquiries/:id/chat', async (c) => {
    const me = await enquiryMe(c);
    if (!me) return c.json({ error: 'Authentication required' }, 401);
    const body = await c.req.json().catch(() => ({}));
    const message = String(body?.message ?? '').trim().slice(0, 2000);
    if (!message) return c.json({ error: 'message required' }, 400);
    const out = await chatTurn(c.env as any, createEnquiryStore(c.env), me, c.req.param('id') ?? '', message);
    return c.json(out);
  });
  // Execute a chat proposal the user confirmed (re-validated server-side).
  app.post('/api/enquiries/:id/chat/execute', async (c) => {
    const me = await enquiryMe(c);
    if (!me) return c.json({ error: 'Authentication required' }, 401);
    const body = await c.req.json().catch(() => ({}));
    const { result, applied } = await executeProposal(
      createEnquiryStore(c.env), me, c.req.param('id') ?? '',
      (body?.action && typeof body.action === 'object' ? body.action : {}) as Record<string, any>,
    );
    if (applied !== 'none' && (result as any).live) enquirySend(c, result as any);
    return c.json({ ...(result.body as any), applied }, (result as any).status as any);
  });
  app.post('/api/enquiries/:id/comments', async (c) => {
    const me = await enquiryMe(c);
    if (!me) return c.json({ error: 'Authentication required' }, 401);
    const r = await EnquiryRoutes.enquiryAddComment(createEnquiryStore(c.env), me, c.req.param('id') ?? '', await c.req.json().catch(() => ({})));
    enquirySend(c, r);
    if ((r as any).status === 201) kick(c, String(c.req.param('id') ?? ''));
    return c.json(r.body, r.status as any);
  });
  // B2B EST-No. Check & Assign button: check the Zoho estimate exists; if
  // free, assign it to this enquiry's agent (Lead By) + stamp creator.
  // If held by someone else, report the holder only — never steal.
  app.post('/api/enquiries/:id/claim-estimate', async (c) => {
    const me = await enquiryMe(c);
    if (!me) return c.json({ error: 'Authentication required' }, 401);
    const id = c.req.param('id') ?? '';
    const body = await c.req.json().catch(() => ({}));
    try {
      const store = createEnquiryStore(c.env);
      const enquiry: any = await store.getEnquiry(id).catch(() => null);
      if (!enquiry) return c.json({ error: 'enquiry not found' }, 404);
      const estNumber = String((body as any)?.estNumber ?? (enquiry as any)?.estNumber ?? '').trim();
      const agentId = String((enquiry as any)?.assignedAgentId ?? '').trim();
      if (!estNumber) return c.json({ error: 'Add EST No. first' }, 400);
      if (!agentId) return c.json({ error: 'Enquiry has no Lead By agent' }, 400);
      const { claimEstimateForAgent } = await import('../../modules/enquiries/estimate-link');
      const out = await claimEstimateForAgent(estNumber, agentId, `B2B enquiry claim (${String((enquiry as any)?.enquiryNumber ?? id).slice(0, 40)})`);
      if (out.ok) {
        const { LiveEvent } = await import('../../live');
        enquirySend(c, { status: 200, body: { ok: true }, live: { type: LiveEvent.Enquiries, extra: { action: 'estimate-claimed', id } } } as any);
        try {
          const { notifyLive, LiveEvent: LE } = await import('../context');
          notifyLive(c, { type: (LE as any).Telecalling });
        } catch { /* best-effort */ }
      }
      return c.json(out, out.ok ? 200 : out.alreadyAssigned ? 409 : 404);
    } catch (e: any) {
      return c.json({ ok: false, error: e?.message || 'claim failed' }, 500);
    }
  });
}
