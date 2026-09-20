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
  // When Zoho is no longer `draft` (sent/accepted/declined…), the internal
  // `rateStatus` is auto-promoted to `sent` (Zoho = source of truth — the
  // manual "Mark as sent" button is being eliminated). The read stays fast:
  // the promotion runs as a fire-and-forget `waitUntil` and the chip already
  // reads as sent via `zohoStatus` on this same response.
  async function attachZohoStatus(enquiries: any[]): Promise<void> {
    const nums = [...new Set((enquiries as any[]).map((e) => String((e as any)?.estNumber ?? '').trim()).filter(Boolean))];
    if (!nums.length) return;
    try {
      const { prisma } = deps();
      const rows = await (prisma as any).estimate.findMany({
        where: { estimateNumber: { in: nums } },
        select: { estimateNumber: true, status: true, customerName: true },
      });
      const statusMap = new Map<string, string>((rows as any[]).map((r) => [String(r.estimateNumber), String(r.status)]));
      const customerMap = new Map<string, string>((rows as any[]).map((r) => [String(r.estimateNumber), String(r.customerName ?? '')]));
      for (const e of enquiries as any[]) {
        const key = String((e as any)?.estNumber ?? '').trim();
        const s = statusMap.get(key);
        (e as any).zohoStatus = s ?? null;
        (e as any).zohoCustomerName = customerMap.get(key) ?? null;
        // Stash original so the background promotion can tell whether DB was
        // already `sent` before we derived it for this response.
        (e as any)._origRateStatus = String((e as any)?.rateStatus ?? '');
        // Derive `rateStatus` for this response so the UI reads as sent even
        // before the background DB promotion lands.
        const zs = String(s ?? '').toLowerCase();
        if (zs && zs !== 'draft' && String((e as any)?.rateStatus ?? '') !== 'sent') {
          (e as any).rateStatus = 'sent';
        }
      }
    } catch {}
  }

  // Fire-and-forget DB promotion: Zoho non-draft → Enquiry `sent`.
  // Called after `attachZohoStatus` so the DB catches up to what the response
  // already derived. Never blocks the request.
  function maybePromoteEnquiriesSent(c: any, enquiries: any[]): void {
    try {
      const ids: string[] = [];
      for (const e of enquiries as any[]) {
        const s = String((e as any)?.zohoStatus ?? '').toLowerCase();
        if (!s || s === 'draft') continue;
        if (String((e as any)?.rateStatus ?? '') === 'sent') continue;
        const origRateStatus = String((e as any)?._origRateStatus ?? (e as any)?.rateStatus ?? '');
        // Only promote rows that were NOT already `sent` in the DB (derived above
        // already flipped the in-memory copy). We need the pre-derived value —
        // stash it in attach if needed. Simpler: re-check the map: if zoho non-draft
        // and DB still not sent, update. We track ids via `id`.
        if (origRateStatus === 'sent') continue;
        if (e?.id) ids.push(String(e.id));
      }
      if (!ids.length) return;
      const task = (async () => {
        try {
          const { prisma } = deps();
          // One bulk update per tick is enough; do them individually to avoid
          // D1 `IN` chunking quirks inside updateMany.
          for (const id of ids) {
            try {
              await (prisma as any).enquiry.updateMany({
                where: { id, rateStatus: { not: 'sent' } as any },
                data: { rateStatus: 'sent' },
              });
            } catch {}
          }
        } catch {}
      })();
      if (c.executionCtx && typeof c.executionCtx.waitUntil === 'function') c.executionCtx.waitUntil(task);
      else void task;
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
      if (Array.isArray(list)) {
        await attachZohoStatus(list);
        maybePromoteEnquiriesSent(c, list);
      }
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
      if (enq) {
        await attachZohoStatus([enq]);
        maybePromoteEnquiriesSent(c, [enq]);
      }
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
  // Per-enquiry copilot: agentic sidebar chat (Agnes-primary tools loop).
  app.post('/api/enquiries/:id/chat', async (c) => {
    const me = await enquiryMe(c);
    if (!me) return c.json({ error: 'Authentication required' }, 401);
    const body = await c.req.json().catch(() => ({}));
    const message = String(body?.message ?? '').trim().slice(0, 2000);
    if (!message) return c.json({ error: 'message required' }, 400);
    try {
      const out = await chatTurn(c.env as any, createEnquiryStore(c.env), me, c.req.param('id') ?? '', message);
      return c.json(out);
    } catch (e: any) {
      const msg = String(e?.message ?? 'chat failed');
      const is429 = /429|rate-limit/i.test(msg) || (e as any)?.status === 429;
      console.error('chatTurn failed', e?.stack ?? msg);
      if (is429) return c.json({ error: 'Rate-limited — please wait a minute and retry.', reply: 'The AI is busy (rate-limited). Please retry in 60 seconds.' }, 429);
      return c.json({ error: msg.slice(0, 500), reply: 'Chat failed — please retry.' }, 500);
    }
  });
  app.get('/api/debug/ai-health', async (c) => {
    try {
      const gw = getGateway(c.env as any);
      return c.json({ keys: gw.health(), count: gw.keyCount, hasAgnes: gw.health().some((h: any) => h.provider === 'agnes') });
    } catch (e: any) {
      return c.json({ error: String(e?.message ?? e) }, 500);
    }
  });
  app.post('/api/debug/chat-test', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const msg = String(body?.message ?? 'ping').slice(0, 500);
    try {
      const gw = getGateway(c.env as any);
      const res = await gw.complete({ messages: [{ role: 'user', content: msg }], model: 'agnes-3.0-flash', maxTokens: 200 });
      return c.json({ ok: true, provider: res.provider, model: res.model, content: res.content.slice(0, 500), usage: res.usage });
    } catch (e: any) {
      return c.json({ ok: false, error: String(e?.message ?? e).slice(0, 1000) }, 500);
    }
  });
  app.get('/api/debug/chat-test', async (c) => {
    const msg = String(c.req.query('message') ?? 'ping').slice(0, 500);
    try {
      const gw = getGateway(c.env as any);
      const res = await gw.complete({ messages: [{ role: 'user', content: msg }], model: 'agnes-3.0-flash', maxTokens: 200 });
      return c.json({ ok: true, provider: res.provider, model: res.model, content: res.content.slice(0, 500), usage: res.usage });
    } catch (e: any) {
      return c.json({ ok: false, error: String(e?.message ?? e).slice(0, 1000), stack: String(e?.stack ?? '').slice(0, 500) }, 500);
    }
  });
  app.get('/api/debug/direct-agnes', async (c) => {
    const key = String((c.env as any)?.AGNES_API_KEY ?? '').slice(0, 10);
    const hasKey = !!String((c.env as any)?.AGNES_API_KEY ?? '').trim();
    const start = Date.now();
    try {
      const r = await fetch('https://apihub.agnes-ai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${String((c.env as any)?.AGNES_API_KEY ?? '').trim()}` },
        body: JSON.stringify({ model: 'agnes-3.0-flash', messages: [{ role: 'user', content: 'ping' }], max_tokens: 10 }),
        signal: AbortSignal.timeout(15000),
      });
      const t = Date.now() - start;
      const j: any = await r.json().catch(() => ({}));
      return c.json({ ok: r.ok, status: r.status, hasKey, keyPrefix: key, ms: t, body: JSON.stringify(j).slice(0, 800) });
    } catch (e: any) {
      return c.json({ ok: false, hasKey, keyPrefix: key, ms: Date.now() - start, error: String(e?.message ?? e).slice(0, 1000) }, 500);
    }
  });
  // Streaming variant — SSE, same agentic loop but final content streams
  app.post('/api/enquiries/:id/chat/stream', async (c) => {
    const me = await enquiryMe(c);
    if (!me) return c.json({ error: 'Authentication required' }, 401);
    const body = await c.req.json().catch(() => ({}));
    const message = String(body?.message ?? '').trim().slice(0, 2000);
    if (!message) return c.json({ error: 'message required' }, 400);
    const { streamChatTurn } = await import('../../modules/enquiries/chat');
    const gen = streamChatTurn(c.env as any, createEnquiryStore(c.env), me, c.req.param('id') ?? '', message);
    const stream = new ReadableStream({
      async start(controller) {
        const enc = new TextEncoder();
        const send = (type: string, data: any) => {
          controller.enqueue(enc.encode(`data: ${JSON.stringify({ type, data })}\n\n`));
        };
        try {
          for await (const evt of gen) {
            send(evt.type, evt.data);
          }
          controller.enqueue(enc.encode('data: [DONE]\n\n'));
        } catch (e: any) {
          controller.enqueue(enc.encode(`data: ${JSON.stringify({ type: 'error', data: { error: String(e?.message ?? e).slice(0, 500) } })}\n\n`));
          controller.enqueue(enc.encode('data: [DONE]\n\n'));
        } finally {
          controller.close();
        }
      },
    });
    return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' } });
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
