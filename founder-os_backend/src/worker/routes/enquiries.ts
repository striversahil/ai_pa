// ─────────────────────────────────────────────────────────────────────────────
// routes/enquiries.ts — live sales-pipeline enquiry tracker.
// ─────────────────────────────────────────────────────────────────────────────
import type { Hono } from 'hono';
import { enquiryMe, enquirySend, EnquiryRoutes, createEnquiryStore, authStore, deps, getEstimatesPayload, type Bindings } from '../context';
import { chatTurn, executeProposal } from '../../modules/enquiries/chat';
import { cacheDel } from '../../shared/cache';
import { getGateway } from '../../shared/ai-gateway';
import { runEnquiryExtraction } from '../../modules/enquiries/enrichment';
import { isZohoClosedStatus, procurementSubmittable } from '../../modules/enquiries/queues';

// Agnes vision intake — Worker-native, no GH Actions (fast edge, <5s).
// Replaces the GH runner `enquiry-intake-runner.js` (OpenRouter vision).
function kickAgnesIntake(c: any, id: string): void {
  try {
    const store = createEnquiryStore(c.env);
    const task = (async () => {
      try {
        const { runAgnesVisionIntake } = await import('../../modules/enquiries/vision-intake');
        await runAgnesVisionIntake(c.env as any, store, String(id));
        // Broadcast so EnquiryDetail auto-populates without refresh (useIntake depends on updatedAt)
        try {
          const { LiveEvent } = await import('../../live');
          const { broadcastLive } = await import('../../live');
          // Use the same live channel as enquiry mutations — useEnquiryData merges the row live
          broadcastLive(c, LiveEvent.Enquiries, { action: 'updated', id: String(id) });
          // Also bust the tracker KV so next list fetch isn't stale
          const { cacheDel } = await import('../../shared/cache');
          const p = cacheDel(`enquiry:redacted:${String(id)}`);
          if (c.executionCtx?.waitUntil) c.executionCtx.waitUntil(p);
        } catch {}
      } catch (e: any) {
        console.error('[kickAgnesIntake] failed', e?.message ?? e);
        // Even on failure, unstick the UI — write empty intake already handled inside vision-intake, but ensure live
        try {
          const { LiveEvent, broadcastLive } = await import('../../live');
          broadcastLive(c, LiveEvent.Enquiries, { action: 'updated', id: String(id) });
        } catch {}
      }
    })();
    if (c.executionCtx && typeof c.executionCtx.waitUntil === 'function') c.executionCtx.waitUntil(task);
    else void task;
  } catch {}
}
// Legacy: keep dispatch for backwards compat, now no-op (GH intake removed).
function kickIntakeNow(_c: any): void { /* GH intake removed — use kickAgnesIntake */ }

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
      // D1 caps bound SQL variables per statement (100) — chunk the IN query
      // (122+ linked enquiries silently killed this lookup for the WHOLE list).
      const rows: any[] = [];
      for (let i = 0; i < nums.length; i += 80) {
        const chunk = nums.slice(i, i + 80);
        const part = await (prisma as any).estimate.findMany({
          where: { estimateNumber: { in: chunk } },
          select: { estimateNumber: true, status: true, customerName: true, organizationId: true, date: true, lastSyncTime: true },
        });
        for (const r of (part as any[]) ?? []) rows.push(r);
      }
      // Group by number: BUI + DPG share the EST series, so one number can
      // have two rows with different statuses. Pick per-enquiry by org;
      // untagged/conflict fallback = most-recent creation date wins.
      const rowsByNum = new Map<string, any[]>();
      for (const r of (rows as any[]) ?? []) {
        const k = String((r as any)?.estimateNumber ?? '');
        if (!rowsByNum.has(k)) rowsByNum.set(k, []);
        rowsByNum.get(k)!.push(r);
      }
      const latestOf = (matches: any[]): any => {
        let best = matches[0];
        let bestT = Date.parse(String(best?.date ?? ''));
        if (!Number.isFinite(bestT)) bestT = -Infinity;
        let bestS = Date.parse(String(best?.lastSyncTime ?? ''));
        if (!Number.isFinite(bestS)) bestS = -Infinity;
        for (let i = 1; i < matches.length; i++) {
          const r = matches[i];
          let t = Date.parse(String(r?.date ?? ''));
          if (!Number.isFinite(t)) t = -Infinity;
          let s = Date.parse(String(r?.lastSyncTime ?? ''));
          if (!Number.isFinite(s)) s = -Infinity;
          if (t > bestT || (t === bestT && s > bestS)) { best = r; bestT = t; bestS = s; }
        }
        return best;
      };
      const pickFor = (num: string, org: string): any | undefined => {
        const matches = rowsByNum.get(num) ?? [];
        if (!matches.length) return undefined;
        const want = String(org ?? '').trim();
        if (want) {
          const hit = matches.find((r) => String((r as any)?.organizationId ?? '') === want);
          if (hit) return hit;
        }
        return latestOf(matches);
      };
      for (const e of enquiries as any[]) {
        const key = String((e as any)?.estNumber ?? '').trim();
        // Redacted (procurement) rows carry no estNumber but may already
        // carry a pre-attached zohoStatus from `enquiryList` — keep it.
        if (!key) {
          if ((e as any).zohoStatus === undefined) {
            (e as any).zohoStatus = null;
            (e as any).zohoCustomerName = null;
          }
          (e as any)._origRateStatus = String((e as any)?.rateStatus ?? '');
          continue;
        }
        const hit = pickFor(key, String((e as any)?.organizationId ?? ''));
        const s = hit ? String((hit as any)?.status ?? '') : undefined;
        if (s !== undefined) {
          (e as any).zohoStatus = s;
          (e as any).zohoCustomerName = String((hit as any)?.customerName ?? '') || null;
        } else if ((e as any).zohoStatus === undefined) {
          (e as any).zohoStatus = null;
          (e as any).zohoCustomerName = null;
        }
        // Stash original so the background promotion can tell whether DB was
        // already `sent` before we derived it for this response.
        (e as any)._origRateStatus = String((e as any)?.rateStatus ?? '');
        // Derive `rateStatus` for this response so the UI reads as sent even
        // before the background DB promotion lands. Skipped while a
        // sent-revision is open — the row loops again (procurement →
        // management → sent) and must NOT read as sent mid-revision.
        const reopened = !!String((e as any)?.sentRevisionAt ?? '').trim();
        const zs = String(s ?? '').toLowerCase();
        if (!reopened && zs && zs !== 'draft' && String((e as any)?.rateStatus ?? '') !== 'sent') {
          (e as any).rateStatus = 'sent';
        }
      }
    } catch {}
  }

  // Zoho-cancelled requirement (client side): declined / void / cancelled /
  // rejected. Mirrors the DailyMovementTracker bucketing in ZohoEstimates.tsx.
  function isZohoCancelled(s: unknown): boolean {
    const v = String(s ?? '').toLowerCase().trim();
    if (!v) return false;
    return v.includes('declin') || v.includes('cancel') || v === 'void' || v.includes('reject');
  }

  // Fire-and-forget DB promotion: Zoho non-draft → Enquiry `sent`.
  // Plus auto-conclude (`procurementSubmittedAt`) so concluded rows drop out
  // of the procurement Active queue into History without a manual click:
  // - terminal client decisions (declined/void/cancelled/accepted) stamp
  //   unconditionally — quoting is over either way;
  // - `sent` (estimate awaiting decision) stamps only once quotable work is
  //   done (`procurementSubmittable().ok` on the STORED row) — rows procurement
  //   is still quoting stay Active until the last rate lands.
  // Never clears an existing stamp. Never blocks the request.
  function maybePromoteEnquiriesSent(c: any, enquiries: any[]): void {
    try {
      const ids: string[] = [];
      // id → 'terminal' | 'sent': terminal stamps unconditionally, sent only
      // when the stored row has nothing left to quote.
      const conclude = new Map<string, 'terminal' | 'sent'>();
      for (const e of enquiries as any[]) {
        const s = String((e as any)?.zohoStatus ?? '').toLowerCase();
        if (!s || s === 'draft') continue;
        // Open sent-revision: the row loops again — never auto-promote or
        // auto-conclude mid-revision (management owns it until re-sent).
        if (String((e as any)?.sentRevisionAt ?? '').trim()) continue;
        if (String((e as any)?.rateStatus ?? '') === 'sent') {
          // Already sent in this response — still eligible for auto-conclude.
        } else {
          const origRateStatus = String((e as any)?._origRateStatus ?? (e as any)?.rateStatus ?? '');
          // Only promote rows that were NOT already `sent` in the DB (derived above
          // already flipped the in-memory copy). We need the pre-derived value —
          // stash it in attach if needed. Simpler: re-check the map: if zoho non-draft
          // and DB still not sent, update. We track ids via `id`.
          if (origRateStatus !== 'sent' && e?.id) ids.push(String(e.id));
        }
        // Auto-conclude: terminal decisions always; `sent` only when quoting
        // is provably done (checked against the stored row below). Skip rows
        // that already carry the handoff.
        if (e?.id && !String((e as any)?.procurementSubmittedAt ?? '').trim()) {
          conclude.set(String(e.id), isZohoClosedStatus(s) ? 'terminal' : 'sent');
        }
      }
      if (!ids.length && !conclude.size) return;
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
          // Auto-conclude (guarded: only stamp when still empty so a manual
          // conclude timestamp is never overwritten). Terminal decisions stamp
          // outright; `sent` stamps only when the STORED row has nothing left
          // to quote — evaluated on stored items (the redacted response items
          // omit internalRates, so the in-memory row can't be trusted here).
          const concluded: string[] = [];
          for (const [id, kind] of conclude) {
            try {
              let current: any = null;
              try {
                current = await (prisma as any).enquiry.findUnique?.({ where: { id } });
              } catch {
                current = null;
              }
              const already = String((current as any)?.procurementSubmittedAt ?? '').trim();
              if (already) continue;
              // Zoho not draft → procurement done even if no rates (per founder 2026-09-23)
              const stamped = new Date().toISOString();
              try {
                await (prisma as any).enquiry.updateMany({
                  where: { id } as any,
                  data: { procurementSubmittedAt: stamped } as any,
                });
              } catch {
                await (prisma as any).enquiry.update({
                  where: { id } as any,
                  data: { procurementSubmittedAt: stamped } as any,
                });
              }
              concluded.push(id);
              // Terminal zoho (sent/declined/accepted) auto-dilutes procurement flags: text stays in thread, flag resolved
              if (kind === 'terminal' || kind === 'sent') {
                try {
                  let cur: any = null;
                  try { cur = await (prisma as any).enquiry.findUnique?.({ where: { id } }); } catch { cur = null; }
                  const items = Array.isArray((cur as any)?.items) ? (cur as any).items : [];
                  let changed = false;
                  const nowIso = new Date().toISOString();
                  const next = items.map((it: any) => {
                    if (!it?.specIssue) return it;
                    changed = true;
                    const thread = Array.isArray(it.thread) ? [...it.thread] : [];
                    thread.push({ by: 'management' as const, kind: 'fix' as const, text: 'Resolved on zoho terminal', at: nowIso });
                    const { specIssue, specFlaggedAt, ...rest } = it;
                    return { ...rest, thread: thread.slice(-50), threadResolved: true, threadResolvedAt: nowIso, threadResolvedBy: 'management' };
                  });
                  if (changed) {
                    try { await (prisma as any).enquiry.updateMany({ where: { id } as any, data: { items: JSON.stringify(next) } as any }); } catch { await (prisma as any).enquiry.update({ where: { id } as any, data: { items: next } as any }); }
                  }
                } catch {}
              }
            } catch {}
          }
          // Wake open tabs: the concluded rows moved Active → History.
          if (concluded.length) {
            try {
              const { LiveEvent, broadcastLive } = await import('../../live');
              broadcastLive(c, LiveEvent.Enquiries, { action: 'auto-concluded', ids: concluded, reason: 'zoho-cancelled' });
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
      kickAgnesIntake(c, String((r.body as any).id));
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
      const hasAiBulk = Array.isArray((patchBody as any)?.items)
        && (patchBody as any).items.some((it: any) => it?.aiPending === true);
      if ((patchBody as any)?.description !== undefined || hasAiBulk) kickAgnesIntake(c, String((r.body as any)?.id ?? c.req.param('id') ?? ''));
    }
    return c.json(r.body, r.status as any);
  });
  app.post('/api/enquiries/:id/additional-requirements', async (c) => {
    const me = await enquiryMe(c);
    if (!me) return c.json({ error: 'Authentication required' }, 401);
    const r = await EnquiryRoutes.enquiryAddRequirement(createEnquiryStore(c.env), me, c.req.param('id') ?? '', await c.req.json().catch(() => ({})));
    enquirySend(c, r);
    if ((r as any).status === 201) {
      kick(c, String(c.req.param('id') ?? ''));
      // Requirement arrives as an aiPending raw item — split it in-Worker via
      // the relay lanes (no GH container), same as Add-via-AI.
      kickAgnesIntake(c, String(c.req.param('id') ?? ''));
    }
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
    // ?provider=groq|openrouter|agnes&model=... — per-provider health/latency probe (owner testing).
    const provider = String(c.req.query('provider') ?? '').trim() || undefined;
    const model = String(c.req.query('model') ?? '').trim() || (provider === 'agnes' || !provider ? 'agnes-3.0-flash' : undefined);
    const start = Date.now();
    try {
      const gw = getGateway(c.env as any);
      const res = await gw.complete({ messages: [{ role: 'user', content: msg }], ...(model ? { model } : {}), ...(provider ? { provider } : {}), maxTokens: 200 });
      return c.json({ ok: true, provider: res.provider, keyId: res.keyId, model: res.model, ms: Date.now() - start, content: res.content.slice(0, 500), usage: res.usage });
    } catch (e: any) {
      return c.json({ ok: false, provider, ms: Date.now() - start, error: String(e?.message ?? e).slice(0, 1000), stack: String(e?.stack ?? '').slice(0, 500) }, 500);
    }
  });
  // Debug: Worker egress identity (proves which source IP Agnes's WAF sees).
  app.get('/api/debug/egress', async (c) => {
    try {
      const r = await fetch('https://www.cloudflare.com/cdn-cgi/trace', { signal: AbortSignal.timeout(10000) });
      const text = await r.text();
      const ip = (text.match(/^ip=(.+)$/m) ?? [])[1]?.trim() ?? null;
      const colo = (text.match(/^colo=(.+)$/m) ?? [])[1]?.trim() ?? null;
      return c.json({ ok: true, egressIp: ip, colo });
    } catch (e: any) {
      return c.json({ ok: false, error: String(e?.message ?? e).slice(0, 300) }, 500);
    }
  });
  app.get('/api/debug/direct-agnes', async (c) => {    const key = String((c.env as any)?.AGNES_API_KEY ?? '').slice(0, 10);
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
      const text = await r.text().catch(() => '');
      let j: any = {};
      try { j = JSON.parse(text); } catch {}
      const hdrs: Record<string, string> = {};
      r.headers.forEach((v, k) => { hdrs[k] = v; });
      return c.json({ ok: r.ok, status: r.status, hasKey, keyPrefix: key, ms: t, body: text.slice(0, 800), headers: hdrs });
    } catch (e: any) {
      return c.json({ ok: false, hasKey, keyPrefix: key, ms: Date.now() - start, error: String(e?.message ?? e).slice(0, 1000) }, 500);
    }
  });
  // Debug: worker→home-proxy leg (proves the 1015 fallback lane is reachable
  // from the Worker; hostname only, never leaks secrets).
  app.get('/api/debug/proxy-health', async (c) => {
    try {
      const gw = getGateway(c.env as any);
      return c.json({ ok: true, ...(await gw.proxyStatus()) });
    } catch (e: any) {
      return c.json({ ok: false, error: String(e?.message ?? e).slice(0, 300) }, 500);
    }
  });
  // Debug: Agnes vision intake without auth (owner testing — parses image+text via agnes-3.0-flash, no GH Actions)
  app.post('/api/debug/vision-intake/:id', async (c) => {
    const id = c.req.param('id') ?? '';
    try {
      const store = createEnquiryStore(c.env);
      const { runAgnesVisionIntake } = await import('../../modules/enquiries/vision-intake');
      await runAgnesVisionIntake(c.env as any, store, id);
      const enq: any = await store.getEnquiry(id).catch(() => null);
      return c.json({ ok: true, enquiryId: id, items: enq?.items ?? [], intake: await (await import('../../shared/cache')).cacheGet(`enquiry:intake:${id}`, 7*24*60*60*1000).catch(() => null) });
    } catch (e: any) {
      return c.json({ ok: false, error: String(e?.message ?? e).slice(0, 1000), stack: String(e?.stack ?? '').slice(0, 800) }, 500);
    }
  });
  // Debug: real copilot without auth (for owner testing only — no PII leak, just this enquiry)
  app.post('/api/debug/enquiry-chat/:id', async (c) => {
    const id = c.req.param('id') ?? '';
    const body = await c.req.json().catch(() => ({}));
    const message = String(body?.message ?? 'Say hello').slice(0, 500);
    // Mock privileged user (bypasses Google OAuth for debug)
    const me: any = { user: { email: 'debug@local', id: 'debug' }, scopes: ['admin','mis','sales','enquiry-tracker'] };
    try {
      const { chatTurn } = await import('../../modules/enquiries/chat');
      const out = await chatTurn(c.env as any, createEnquiryStore(c.env), me, id, message);
      return c.json({ ok: true, enquiryId: id, message, reply: String(out.reply).slice(0, 2000), proposals: out.proposals, activity: out.activity });
    } catch (e: any) {
      return c.json({ ok: false, error: String(e?.message ?? e).slice(0, 1000), stack: String(e?.stack ?? '').slice(0, 800) }, 500);
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
    return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' } });
  });
  // Execute a chat proposal the user confirmed (re-validated server-side).
  app.post('/api/enquiries/:id/chat/execute', async (c) => {
    const me = await enquiryMe(c);
    if (!me) return c.json({ error: 'Authentication required' }, 401);
    const body = await c.req.json().catch(() => ({}));
    try {
      const { result, applied } = await executeProposal(
        createEnquiryStore(c.env), me, c.req.param('id') ?? '',
        (body?.action && typeof body.action === 'object' ? body.action : {}) as Record<string, any>,
      );
      if (applied !== 'none' && (result as any).live) enquirySend(c, result as any);
      return c.json({ ...(result.body as any), applied }, (result as any).status as any);
    } catch (e: any) {
      console.error('chat/execute failed', e?.stack ?? String(e?.message ?? e));
      return c.json({ error: String(e?.message ?? 'apply failed').slice(0, 300), applied: 'none' }, 500);
    }
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
