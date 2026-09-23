// ─────────────────────────────────────────────────────────────────────────────
// routes/runner.ts — instant D1 data-read + result-write endpoints for the GH
// Actions runner scripts (scripts/*.js). Heavy AI / cron / Zoho crawling runs on
// the runner; this worker only fetches raw rows and persists results. All
// endpoints are SHARED_SECRET gated and stay well under the 30s CPU limit.
// ─────────────────────────────────────────────────────────────────────────────
import type { Hono } from 'hono';
import { deps, requireSecret, notifyLive, broadcastLive, LiveEvent, createEnquiryStore, type Bindings } from '../context';
import { prisma } from '../../shared/prisma';
import { logger } from '../../shared/logger';
import { cacheGet, cacheSet, cacheDel } from '../../shared/cache';
import { bulkAssignEstimates } from '../../automations/telecalling/service';
import { syncEffortSnapshots } from '../../automations/telecalling/effort-sync';
import { RELAY_ACTIVE_KEY, RELAY_ACTIVE_KEY_BAK, RELAY_TTL_MS } from '../../shared/ai-gateway';

/** Procurement materials roll-up from final display rows (shared by the CRM
 *  snapshot POST and the incremental items-merge below, so both report the
 *  full picture even when only a few rows carry items). */
function computeCrmMaterials(stages: Record<string, { orders: any[] }>, cap: number): any[] {
  try {
    const matMap = new Map<string, { item: string; sku: string; qty: number; orders: number; value: number }>();
    for (const entry of Object.values(stages)) {
      for (const o of (entry as any).orders) {
        for (const li of (Array.isArray(o?.items) ? o.items.slice(0, 50) : [])) {
          const key = String(li?.sku || li?.item_code || li?.name || li?.description || '');
          if (!key) continue;
          const e = matMap.get(key) || { item: String(li?.name || li?.description || key), sku: String(li?.sku || li?.item_code || ''), qty: 0, orders: 0, value: 0 };
          e.qty += parseFloat(li?.quantity) || 0;
          e.value += parseFloat(li?.item_total) || 0;
          e.orders += 1;
          matMap.set(key, e);
        }
      }
    }
    return [...matMap.values()]
      .sort((a, b) => b.qty - a.qty)
      .slice(0, cap)
      .map((m) => ({ ...m, qty: Math.round(m.qty * 100) / 100, value: Math.round(m.value * 100) / 100 }));
  } catch {
    return [];
  }
}

export function registerRunnerRoutes(app: Hono<{ Bindings: Bindings }>): void {
  // ── agnes-relay lane (on-demand GH egress for Agnes 1015 storms) ──────────
  // The relay run registers itself here on boot and heartbeats; the gateway
  // routes Agnes traffic via AGNES_PROXY_URL only while this KV flag is
  // fresh. TTL-bounded, so a killed run stops attracting traffic on its own.
  app.post('/api/runner/relay/register', async (c) => {
    if (!requireSecret(c)) return c.text('Unauthorized', 401);
    const body = await c.req.json().catch(() => ({}));
    const lane = String(body?.lane ?? 'primary') === 'bak' ? 'bak' : 'primary';
    const key = lane === 'bak' ? RELAY_ACTIVE_KEY_BAK : RELAY_ACTIVE_KEY;
    const runId = String(body?.runId ?? '');
    const now = Date.now();
    // runId-aware compare-and-set: during rolling restarts two runs of one
    // lane briefly overlap — the old run must neither steal the flag back
    // nor deregister under the live new run.
    const cur: any = await cacheGet(key, RELAY_TTL_MS).catch(() => null);
    if (body?.active === false) {
      if (cur && cur.runId && runId && cur.runId !== runId) {
        return c.json({ ok: true, active: false, lane, cleared: false, reason: 'not-owner' });
      }
      await cacheDel(key);
      return c.json({ ok: true, active: false, lane, cleared: true });
    }
    const durationMin = Math.max(10, Math.min(Number(body?.durationMin ?? 180), 350));
    if (cur && cur.runId && runId && cur.runId !== runId) {
      // Superseded: a newer run already owns this lane — old run exits early.
      return c.json({ ok: false, active: true, lane, reason: 'superseded', owner: String(cur.runId).slice(0, 8) }, 409);
    }
    const startedAt = Number(cur?.startedAt) > 0 && cur?.runId === runId ? Number(cur.startedAt) : now;
    const ttlSec = Math.max(60, Math.min(Number(body?.ttlSec ?? RELAY_TTL_MS / 1000), RELAY_TTL_MS / 1000));
    const expiresAt = startedAt + durationMin * 60_000;
    try {
      await cacheSet(key, { at: new Date().toISOString(), runId, lane, startedAt, expiresAt }, ttlSec * 1000);
    } catch (e: any) {
      return c.json({ ok: false, error: String(e?.message ?? e).slice(0, 200) }, 500);
    }
    return c.json({ ok: true, active: true, lane, ttlSec, startedAt, expiresAt });
  });
  // ── whatsapp-digest runner ───────────────────────────────────────────────────
  app.get('/api/runner/messages/unprocessed', async (c) => {
    if (!requireSecret(c)) return c.text('Unauthorized', 401);
    const { StorageRepository } = deps();
    const messages = await StorageRepository.fetchUnprocessedMessages();
    return c.json(messages.map((m: any) => ({
      id: m.id, chatId: m.chatId, sender: m.sender, body: m.body,
      timestamp: m.timestamp instanceof Date ? m.timestamp.toISOString() : m.timestamp,
    })));
  });

  app.get('/api/runner/digests/latest', async (c) => {
    if (!requireSecret(c)) return c.text('Unauthorized', 401);
    const { StorageRepository } = deps();
    const chatId = c.req.query('chatId') || '';
    if (!chatId) return c.json({ error: 'chatId query required' }, 400);
    const digest = await StorageRepository.fetchLatestDigestByChatId(chatId);
    if (!digest) return c.json({ digest: null });
    return c.json({ digest: { summary: digest.summary, priority: digest.priority, suggestedReply: digest.suggestedReply } });
  });

  app.get('/api/runner/chat-notes', async (c) => {
    if (!requireSecret(c)) return c.text('Unauthorized', 401);
    const { StorageRepository } = deps();
    const chatId = c.req.query('chatId') || '';
    if (!chatId) return c.json({ error: 'chatId query required' }, 400);
    const note = await StorageRepository.getChatNote(chatId);
    return c.json({ content: note?.content || '' });
  });

  app.post('/api/runner/digests', async (c) => {
    if (!requireSecret(c)) return c.text('Unauthorized', 401);
    const { StorageRepository } = deps();
    const body = await c.req.json().catch(() => ({}));
    if (!body.chatId || !body.summary) return c.json({ error: 'chatId + summary required' }, 400);
    const digest = await StorageRepository.saveDigest({
      chatId: body.chatId,
      chatName: body.chatName || body.chatId,
      summary: body.summary,
      priority: body.priority || 'medium',
      category: body.category || 'General',
      sentiment: body.sentiment || 'neutral',
      requiresFounder: !!body.requiresFounder,
      suggestedReply: body.suggestedReply || undefined,
    });
    broadcastLive(c, LiveEvent.Digests, { chatId: body.chatId });
    return c.json({ ok: true, id: digest.id });
  });

  app.post('/api/runner/tasks', async (c) => {
    if (!requireSecret(c)) return c.text('Unauthorized', 401);
    const { StorageRepository } = deps();
    const body = await c.req.json().catch(() => ({}));
    if (!body.title) return c.json({ error: 'title required' }, 400);
    let deadline: Date | null = null;
    if (body.deadline) { const d = new Date(body.deadline); if (!isNaN(d.getTime())) deadline = d; }
    const task = await StorageRepository.createTask({
      title: body.title,
      owner: body.owner || 'Founder',
      status: body.status || 'PENDING',
      deadline,
      source: body.source || 'WHATSAPP',
      sourceId: body.sourceId || null,
    });
    broadcastLive(c, LiveEvent.Tasks);
    return c.json({ ok: true, id: task.id });
  });

  app.post('/api/runner/pending-items', async (c) => {
    if (!requireSecret(c)) return c.text('Unauthorized', 401);
    const { StorageRepository } = deps();
    const body = await c.req.json().catch(() => ({}));
    if (!body.chatId || !body.description) return c.json({ error: 'chatId + description required' }, 400);
    let dueDate: Date | null = null;
    if (body.dueDate) { const d = new Date(body.dueDate); if (!isNaN(d.getTime())) dueDate = d; }
    const item = await StorageRepository.createChatPendingItem({
      chatId: body.chatId,
      chatName: body.chatName || body.chatId,
      description: body.description,
      dueDate,
    });
    broadcastLive(c, LiveEvent.PendingItems, { chatId: body.chatId });
    return c.json({ ok: true, id: item.id });
  });

  app.post('/api/runner/messages/mark-processed', async (c) => {
    if (!requireSecret(c)) return c.text('Unauthorized', 401);
    const { StorageRepository } = deps();
    const body = await c.req.json().catch(() => ({}));
    const ids = Array.isArray(body.ids) ? body.ids.map(String).filter(Boolean) : [];
    if (!ids.length) return c.json({ ok: true, count: 0 });
    await StorageRepository.markMessagesProcessed(ids);
    broadcastLive(c, LiveEvent.Messages, { count: ids.length });
    return c.json({ ok: true, count: ids.length });
  });

  // ── morning-brief / eod-summary runner ───────────────────────────────────────
  app.get('/api/runner/brief-data', async (c) => {
    if (!requireSecret(c)) return c.text('Unauthorized', 401);
    const { StorageRepository, prisma } = deps();
    const [digests, tasks, pendingItems, emails, estimates] = await Promise.all([
      StorageRepository.fetchDigests(15),
      StorageRepository.fetchTasks(),
      StorageRepository.fetchOpenChatPendingItems(),
      StorageRepository.fetchUnprocessedEmails(),
      prisma.estimate.findMany({ where: { status: 'sent' }, include: { classification: true } }),
    ]);
    return c.json({ digests, tasks, pendingItems, emails, estimates });
  });

  app.post('/api/runner/founder-notes', async (c) => {
    if (!requireSecret(c)) return c.text('Unauthorized', 401);
    const { StorageRepository } = deps();
    const body = await c.req.json().catch(() => ({}));
    if (!body.content) return c.json({ error: 'content required' }, 400);
    const note = await StorageRepository.saveFounderNote(String(body.content));
    broadcastLive(c, LiveEvent.FounderNotes);
    return c.json({ ok: true, id: note.id, createdAt: note.createdAt });
  });

  // ── zoho-sent-analyzer runner ────────────────────────────────────────────────
  app.get('/api/runner/zoho/state', async (c) => {
    if (!requireSecret(c)) return c.text('Unauthorized', 401);
    const { prisma } = deps();
    const [estimates, maxComments, lastCompleteSync] = await Promise.all([
      prisma.estimate.findMany({ include: { classification: true } }),
      prisma.comment.groupBy({ by: ['estimateId'], _max: { commentId: true } }),
      prisma.setting.findUnique({ where: { key: 'sales_copilot:last_complete_sync_at' } }),
    ]);
    const maxCommentIdByEstimate: Record<string, string> = {};
    for (const row of maxComments) {
      maxCommentIdByEstimate[row.estimateId] = (row._max.commentId as string) || '';
    }
    return c.json({
      estimates,
      maxCommentIdByEstimate,
      lastCompleteSyncAt: lastCompleteSync?.value || null,
    });
  });

  // ── Zoho sales-orders-today (fetched by the GH runner; served to the dashboard)
  // The runner computes "active sales orders created today (IST)" from the Zoho
  // salesorders API (same curl credentials as the estimates sync) and POSTs it
  // here every tick. The dashboard reads this KV payload — no Zoho fetch on the
  // request path.
  app.post('/api/runner/zoho/salesorders-today', async (c) => {
    if (!requireSecret(c)) return c.text('Unauthorized', 401);
    const body = await c.req.json().catch(() => ({}));
    if (typeof body?.date !== 'string' || typeof body?.count !== 'number') {
      return c.json({ error: 'date (YYYY-MM-DD) and count (number) required' }, 400);
    }
    const orders = Array.isArray(body.orders)
      ? body.orders.slice(0, 50).map((o: any) => ({
          so: String(o?.so ?? ''), ref: String(o?.ref ?? ''), customer: String(o?.customer ?? ''),
          total: Number(o?.total) || 0, status: String(o?.status ?? ''), time: String(o?.time ?? ''),
          org: String(o?.org ?? ''),
        }))
      : [];
    const cache = require('../../shared/cache');
    const byOrg = body.byOrg && typeof body.byOrg === 'object' ? body.byOrg : {};
    const next = { date: body.date, count: body.count, totalValue: Number(body.totalValue) || 0, statuses: body.statuses || {}, orders, byOrg };
    // Only invalidate the (30-min-TTL) estimates cache when the SO data actually
    // changed — the dashboard KPI/feed rides on /api/estimates, and pointless
    // invalidations would force a ~3s cold recompute every 15 min.
    const prev = await cache.cacheGet('zoho:salesorders_today', 45 * 60 * 1000);
    const changed = !prev
      || prev.date !== next.date
      || prev.count !== next.count
      || prev.totalValue !== next.totalValue
      || JSON.stringify(prev.orders ?? []) !== JSON.stringify(next.orders);
    await cache.cacheSet('zoho:salesorders_today', next, 45 * 60 * 1000);
    if (changed) {
      try {
        const { invalidateEstimatesCache } = require('../../shared/estimates-cache');
        await invalidateEstimatesCache();
      } catch { /* invalidation is best-effort */ }
      // The dashboard KPI/feed rides on /api/estimates but only refetches on
      // live events it subscribes to ("estimates" | "baseline" | "automation"
      // — see ZohoEstimates useLiveRefresh). Broadcast so open tabs pick up
      // the new sales-order tile within ~2s instead of the 15-min poll.
      notifyLive(c, { type: 'estimates', source: 'salesorders-today' });
    }
    return c.json({ ok: true, changed });
  });

  // ── CRM sales-orders snapshot (fetched by the GH runner; served to the CRM dashboard)
  // The runner pages /api/v3/salesorders (Status.All), computes each open order's
  // next pending process step and POSTs the department-grouped snapshot here.
  // Every snapshot is DIFFED against the previous one (KV) and the movement is
  // written to the DepartmentScoreEvent ledger — the department-level points
  // game, exactly like the telecalling leaderboard:
  //   new SO created today       → CRM +25
  //   left the confirm stage     → CRM +50 and Procurement +25 (material allocated)
  //   left the invoice stage     → Accounts +50
  //   left the ship stage        → Dispatch +50
  //   closed as paid             → Accounts +100 (implies all stage completions)
  //   closed cancelled/void      → −20 charged to the dept owning the stage it was in
  // Stage → desk ownership: confirm=CRM, invoice=Accounts, ship=Dispatch, payment=Accounts.
  const CRM_SNAPSHOT_KEY = 'crm:salesorders_snapshot';
  const CRM_DATA_CACHE_KEY = 'crm:data';
  // Org-scoped SO key: identical SO numbers in two Zoho orgs are distinct
  // pipeline rows. Legacy snapshot rows without `org` keep bare keys.
  const crmKey = (o: any) => (o?.org ? `${o.org}:` : '') + String(o?.so ?? '');
  // Freshness window (dashboard "live") vs retention window (outage survival).
  // The snapshot is always WRITTEN with the 7-day TTL so a Zoho outage serves
  // the last-known pipeline with a stale badge instead of zeroing out; reads
  // use the 45-min TTL when they need strictly-fresh data.
  const CRM_SNAPSHOT_KEEP_MS = 7 * 24 * 60 * 60 * 1000;  const CRM_STAGES = ['confirm', 'invoice', 'ship', 'payment'];
  const STAGE_DEPT: Record<string, string> = { confirm: 'crm', invoice: 'accounts', ship: 'dispatch', payment: 'accounts' };
  // Completing a stage credits these (dept, points, reason) pairs, in order.
  const STAGE_COMPLETION: Record<string, Array<[string, number, string]>> = {
    confirm: [['crm', 50, 'Sales order confirmed'], ['procurement', 25, 'Material allocated — cleared confirm']],
    invoice: [['accounts', 50, 'Invoice raised']],
    ship: [['dispatch', 50, 'Order shipped']],
    payment: [['accounts', 100, 'Payment received']],
  };

  app.post('/api/runner/crm/snapshot', async (c) => {
    if (!requireSecret(c)) return c.text('Unauthorized', 401);
    const body = await c.req.json().catch(() => ({}));
    if (typeof body?.date !== 'string' || typeof body?.totalActive !== 'number' || !body?.stages) {
      return c.json({ error: 'date, totalActive, and stages required' }, 400);
    }
    const stages: Record<string, { count: number; value: number; orders: any[] }> = {};
    for (const [step, entry] of Object.entries(body.stages)) {
      const e = entry as any;
      stages[step] = {
        count: Number(e?.count) || 0,
        value: Number(e?.value) || 0,
        orders: Array.isArray(e?.orders) ? e.orders.slice(0, 400) : [],
      };
    }

    const { cacheGet, cacheSet, cacheDel } = require('../../shared/cache');
    const prev: any = await cacheGet(CRM_SNAPSHOT_KEY, 24 * 60 * 60 * 1000);

    // Diff source: the runner's full lightweight `index` (UNCAPPED — every SO),
    // so per-stage display caps (400) never hide points movements. Older
    // runners that don't send `index` fall back to the truncated order rows.
    // Keys are org-scoped (see crmKey); the `so` field is kept on every value
    // so a pre-multi-org (bare-key) snapshot still matches via fallback — the
    // deploy-transition tick loses no close/cancel credits.
    const toEntry = (o: any, fallbackStage: string) => ({
      so: String(o?.so ?? ''),
      stage: String(o?.stage || fallbackStage || ''),
      paidStatus: String(o?.paidStatus || ''),
      createdToday: !!o?.createdToday,
      salesperson: String(o?.salesperson || ''),
    });
    // Previous active orders: key → { stage, paidStatus }.
    const prevBySo = new Map<string, { stage: string; paidStatus: string }>();
    if (Array.isArray(prev?.index) && prev.index.length > 0) {
      for (const o of prev.index) {
        if (o?.so) prevBySo.set(crmKey(o), { stage: String(o.stage || ''), paidStatus: String(o.paidStatus || '') });
      }
    } else {
      const prevSource = prev?.stages || prev?.byProcess || {};
      for (const [stage, entry] of Object.entries(prevSource)) {
        for (const o of (entry as any)?.orders ?? []) {
          if (o?.so) prevBySo.set(crmKey(o), { stage, paidStatus: String(o.paidStatus || '') });
        }
      }
    }
    // New active orders: key → { so, stage, paidStatus, createdToday, salesperson }.
    const nextBySo = new Map<string, { so: string; stage: string; paidStatus: string; createdToday: boolean; salesperson: string }>();
    if (Array.isArray((body as any)?.index) && (body as any).index.length > 0) {
      for (const o of (body as any).index) {
        if (o?.so && String(o.stage || '') !== 'complete') nextBySo.set(crmKey(o), toEntry(o, ''));
      }
    } else {
      for (const [stage, entry] of Object.entries(stages)) {
        for (const o of entry.orders) {
          if (o?.so) nextBySo.set(crmKey(o), toEntry(o, stage));
        }
      }
    }
    const day = body.date;
    const events: { dept: string; soNumber: string; points: number; reason: string; actor: string | null; day: string }[] = [];
    const credit = (dept: string, so: string, points: number, reason: string, actor?: string | null) =>
      events.push({ dept, soNumber: so, points, reason, actor: actor || null, day });

    // Stage-completion credits for an order advancing through the pipeline.
    const awardStageCompletions = (fromIdx: number, toIdxInclusive: number, so: string, salesperson: string | null) => {
      for (let i = fromIdx; i <= toIdxInclusive; i++) {
        const stage = CRM_STAGES[i];
        for (const [dept, points, reason] of STAGE_COMPLETION[stage] || []) {
          credit(dept, so, points, reason, dept === 'crm' || dept === 'dispatch' ? salesperson : null);
        }
      }
    };

    for (const [key, next] of nextBySo) {
      // Fallback to the bare SO number so a snapshot written before the
      // multi-org deploy still matches (one transitional tick, no lost credits).
      const prevEntry = prevBySo.get(key) ?? prevBySo.get(next.so);
      if (!prevEntry) {
        // First time visible in the pipeline. Only orders CREATED TODAY earn the
        // new-order credit (prevents a re-credit flood if the KV snapshot expired).
        if (next.createdToday) credit('crm', key, 25, 'New sales order created', next.salesperson);
        continue;
      }
      if (prevEntry.stage !== next.stage) {
        const prevIdx = CRM_STAGES.indexOf(prevEntry.stage);
        const nextIdx = CRM_STAGES.indexOf(next.stage);
        if (nextIdx > prevIdx) awardStageCompletions(prevIdx, nextIdx - 1, key, next.salesperson);
        // Regression (credit note / manual revert) scores nothing.
      }
      if (next.paidStatus === 'paid' && prevEntry.paidStatus !== 'paid') {
        credit('accounts', key, 100, 'Payment received', null);
      }
    }

    // Closed orders (absent from the active stages): paid → Accounts +100 with
    // all stage completions implied; cancelled/void → −20 to the dept that
    // owned the stage the order was sitting in.
    const closedList: any[] = Array.isArray(body.closed) ? body.closed.slice(0, 400) : [];
    for (const co of closedList) {
      const key = crmKey(co);
      const prevEntry = prevBySo.get(key) ?? prevBySo.get(String(co?.so || ''));
      if (!prevEntry) continue; // wasn't active in the previous snapshot — nothing to credit
      const status = String(co?.status || '');
      const salesperson = String(co?.salesperson || '') || null;
      if (status === 'cancelled' || status === 'void') {
        credit(STAGE_DEPT[prevEntry.stage] || 'crm', key, -20, `Order cancelled (was in ${prevEntry.stage})`, salesperson);
      } else if ((co?.paidStatus === 'paid' || co?.orderStatus === 'closed') && prevEntry.paidStatus !== 'paid') {
        const prevIdx = CRM_STAGES.indexOf(prevEntry.stage);
        if (prevIdx >= 0) awardStageCompletions(prevIdx, CRM_STAGES.length - 1, key, salesperson);
      }
    }

    // Persist the ledger first (best-effort — never block the snapshot).
    let persisted = 0;
    if (events.length > 0) {
      try {
        const res = await prisma.departmentScoreEvent.createMany({ data: events });
        persisted = res?.count ?? events.length;
      } catch (e: any) {
        logger.warn({ err: e?.message, events: events.length }, 'crm snapshot: score ledger write failed');
      }
    }

    // Item backfill (delta-fetch): the runner sends items ONLY for rows it
    // fetched this tick; rows it skipped carry the previous itemsSig with
    // empty items. Copy the stored items over when the sig matches, so the
    // dashboard never loses line detail on delta ticks.
    // Preserve-on-failure: when a row's fetch FAILED this tick (empty new sig
    // but a non-empty stored sig + stored items), keep the stored items AND
    // restore the stored sig in the saved index — otherwise one bad tick
    // permanently wipes that row's detail and the row is never retried.
    let backfilled = 0;
    let preserved = 0;
    const prevSigBySo = new Map<string, string>();
    try {
      for (const o of (Array.isArray(prev?.index) ? prev.index : [])) {
        if (o?.so) prevSigBySo.set(crmKey(o), String(o.itemsSig || ''));
      }
      const nextSigBySo = new Map<string, string>();
      for (const o of (Array.isArray((body as any)?.index) ? (body as any).index : [])) {
        if (o?.so) nextSigBySo.set(crmKey(o), String(o.itemsSig || ''));
      }
      const prevItemsBySo = new Map<string, { items: any[]; lineCount: number }>();
      const prevSrc = prev?.stages || prev?.byProcess || {};
      for (const entry of Object.values(prevSrc)) {
        for (const o of (entry as any)?.orders ?? []) {
          if (o?.so && Array.isArray(o?.items) && o.items.length > 0 && !prevItemsBySo.has(crmKey(o))) {
            prevItemsBySo.set(crmKey(o), { items: o.items, lineCount: Number(o.lineCount) || o.items.length });
          }
        }
      }
      for (const entry of Object.values(stages)) {
        for (const o of (entry as any).orders) {
          if (o?.so && (!Array.isArray(o?.items) || o.items.length === 0)) {
            const key = crmKey(o);
            const bare = String(o.so);
            const sig = nextSigBySo.get(key) || '';
            const hit = prevItemsBySo.get(key) ?? prevItemsBySo.get(bare);
            if (sig && hit && (prevSigBySo.get(key) ?? prevSigBySo.get(bare)) === sig) {
              o.items = hit.items;
              o.lineCount = hit.lineCount;
              backfilled++;
            } else if (!sig && hit && ((prevSigBySo.get(key) ?? prevSigBySo.get(bare)) || '')) {
              // Fetch failed (or never ran) for a row we HAD detail for:
              // keep the stored items so the dropdown never goes blank.
              // The index-sig restore below keeps the old sig, so the row
              // stays queued for retry instead of being forgotten.
              o.items = hit.items;
              o.lineCount = hit.lineCount;
              preserved++;
            }
          }
        }
      }
    } catch { /* backfill is best-effort — snapshot still stores */ }
    // Materials are recomputed server-side from the FINAL order rows (fetched
    // + backfilled items), so delta ticks — where the runner only sends items
    // for changed rows — still report the full procurement picture.
    const materials: any[] = computeCrmMaterials(stages, 300);
    // Restore stored item sigs for preserve-on-failure rows: the runner sent
    // an empty sig (fetch failed), but we kept the stored items above — the
    // saved index must keep pointing at them or the row is never retried and
    // the next fingerprint check misfires.
    let storedIndex: any[] = Array.isArray((body as any)?.index) ? (body as any).index.slice(0, 10000) : [];
    if (preserved > 0) {
      storedIndex = storedIndex.map((o: any) => {
        if (o?.so && !String(o?.itemsSig || '') && (prevSigBySo.get(crmKey(o)) || '')) {
          return { ...o, itemsSig: prevSigBySo.get(crmKey(o)) };
        }
        return o;
      });
    }
    const snapshotBody = {
      date: body.date,
      fetchedAt: typeof (body as any)?.fetchedAt === 'string' ? (body as any).fetchedAt : null,
      fingerprint: typeof (body as any)?.fingerprint === 'string' ? (body as any).fingerprint : null,
      totalActive: Number(body.totalActive) || 0,
      totalValue: Number(body.totalValue) || 0,
      stages,
      byProcess: stages, // legacy alias (pre-department dashboards)
      closed: closedList,
      materials,
      salespeople: Array.isArray(body.salespeople) ? body.salespeople.slice(0, 200) : [],
      // Full lightweight index (uncapped) — the next tick's diff source.
      index: storedIndex,
      meta: { ...(body.meta ?? null), withLineItems: materials.length > 0 },
      computedAt: new Date().toISOString(),
    };
    // Totals-change detection: skip the cache bust + live broadcast when
    // nothing moved (no ledger events AND identical counts/values), so idle
    // ticks don't refetch every open tab. The KV snapshot is still refreshed.
    const prevStages = prev?.stages || prev?.byProcess || {};
    const num = (v: unknown) => Number(v) || 0; // missing stage keys → 0, never NaN
    const totalsChanged =
      !prev ||
      num(prev?.totalActive) !== snapshotBody.totalActive ||
      num(prev?.totalValue) !== snapshotBody.totalValue ||
      CRM_STAGES.some((s) => num(prevStages?.[s]?.count) !== num(stages?.[s]?.count));
    await cacheSet(CRM_SNAPSHOT_KEY, snapshotBody, CRM_SNAPSHOT_KEEP_MS);
    if (persisted > 0 || totalsChanged) {
      // The aggregated data() cache derives from the snapshot + ledger — bust it.
      await cacheDel(CRM_DATA_CACHE_KEY).catch(() => {});
      broadcastLive(c, LiveEvent.Crm, { totalActive: snapshotBody.totalActive, events: persisted });
    }
    return c.json({ ok: true, events: persisted, broadcast: persisted > 0 || totalsChanged, backfilled, preserved });
  });

  // ── CRM incremental items merge (background fill) ─────────────────────────
  // The runner fetches line-item details for a bounded batch per tick; on
  // heartbeat ticks (pipeline unchanged) there is no snapshot POST, so those
  // batches land here instead. Merges items into the STORED snapshot's
  // display rows (unknown SOs ignored), refreshes index sigs, recomputes
  // materials, busts the data cache and broadcasts — no ledger diff (items
  // don't move pipeline stages, so they never score points).
  app.post('/api/runner/crm/items', async (c) => {
    if (!requireSecret(c)) return c.text('Unauthorized', 401);
    const body = await c.req.json().catch(() => ({}));
    const rows: any[] = Array.isArray(body?.items) ? body.items : [];
    if (rows.length === 0) return c.json({ ok: true, merged: 0 });
    const { cacheGet, cacheSet, cacheDel } = require('../../shared/cache');
    const snap: any = await cacheGet(CRM_SNAPSHOT_KEY, 24 * 60 * 60 * 1000);
    if (!snap) return c.json({ ok: false, error: 'no snapshot to merge into' }, 404);
    if (typeof body?.date === 'string' && snap?.date && body.date !== snap.date) {
      return c.json({ ok: false, error: 'snapshot date moved — send a full snapshot instead' }, 409);
    }
    const bySo = new Map<string, any>();
    for (const r of rows) {
      if (r?.so && Array.isArray(r?.items)) bySo.set(crmKey(r), r);
    }
    if (bySo.size === 0) return c.json({ ok: true, merged: 0 });
    let merged = 0;
    const src = snap?.stages || snap?.byProcess || {};
    for (const entry of Object.values(src)) {
      for (const o of (entry as any)?.orders ?? []) {
        const r = o?.so ? (bySo.get(crmKey(o)) ?? bySo.get(String(o.so))) : null;
        if (!r) continue;
        o.items = r.items.slice(0, 200);
        o.lineCount = Number(r.lineCount) || r.items.length;
        merged++;
      }
    }
    if (merged === 0) return c.json({ ok: true, merged: 0 });
    if (Array.isArray(snap.index)) {
      const sigBySo = new Map<string, string>();
      for (const r of rows) {
        if (r?.so && typeof r?.itemsSig === 'string' && r.itemsSig) sigBySo.set(crmKey(r), r.itemsSig);
      }
      snap.index = snap.index.map((o: any) => {
        if (!o?.so) return o;
        const sig = sigBySo.get(crmKey(o)) ?? sigBySo.get(String(o.so));
        return sig ? { ...o, itemsSig: sig } : o;
      });
    }
    snap.materials = computeCrmMaterials(snap.stages || {}, 300);
    snap.meta = { ...(snap.meta ?? null), withLineItems: (snap.materials as any[]).length > 0 };
    snap.computedAt = new Date().toISOString();
    await cacheSet(CRM_SNAPSHOT_KEY, snap, CRM_SNAPSHOT_KEEP_MS);
    await cacheDel(CRM_DATA_CACHE_KEY).catch(() => {});
    broadcastLive(c, LiveEvent.Crm, { itemsMerged: merged });
    return c.json({ ok: true, merged });
  });

  // ── CRM fingerprint + heartbeat (no-change fast path) ──────────────────────
  // The runner hashes the full pipeline state and checks it here before POSTing
  // a snapshot. Unchanged → heartbeat (refreshes KV TTL + fetchedAt, no ledger
  // diff, no cache bust, no broadcast) so idle ticks cost ~zero and never
  // refetch open tabs. TTL expiry alone can't zero the dashboard: the
  // heartbeat keeps the snapshot alive while its date is still today.
  app.get('/api/runner/crm/fingerprint', async (c) => {
    if (!requireSecret(c)) return c.text('Unauthorized', 401);
    const { cacheGet }: { cacheGet: <T>(key: string, ttlMs: number) => Promise<T | null> } = require('../../shared/cache');
    const snap: any = await cacheGet(CRM_SNAPSHOT_KEY, 24 * 60 * 60 * 1000);
    // Delta-fetch support: per-SO [stage, itemsSig] for stored DISPLAY rows
    // only (bounded, ~KBs). The runner fetches Zoho details solely for rows
    // that are new, moved stage, or never captured — a single new SO costs
    // exactly 1 detail call instead of ~500.
    const sigs: Record<string, [string, string]> = {};
    try {
      const prevSigBySo = new Map<string, string>();
      for (const o of (Array.isArray(snap?.index) ? snap.index : [])) {
        if (o?.so) prevSigBySo.set(crmKey(o), String(o.itemsSig || ''));
      }
      const src = snap?.stages || snap?.byProcess || {};
      for (const [stage, entry] of Object.entries(src)) {
        for (const o of (entry as any)?.orders ?? []) {
          if (o?.so && !sigs[crmKey(o)]) {
            sigs[crmKey(o)] = [String(stage), prevSigBySo.get(crmKey(o)) || ''];
          }
        }
      }
    } catch { /* sigs stay empty → runner fetches everything (safe fallback) */ }
    return c.json({ fingerprint: snap?.fingerprint ?? null, date: snap?.date ?? null, sigs });
  });

  app.post('/api/runner/crm/heartbeat', async (c) => {
    if (!requireSecret(c)) return c.text('Unauthorized', 401);
    const body = await c.req.json().catch(() => ({}));
    const { cacheGet, cacheSet }: {
      cacheGet: <T>(key: string, ttlMs: number) => Promise<T | null>;
      cacheSet: <T>(key: string, value: T, ttlMs: number) => Promise<void>;
    } = require('../../shared/cache');
    const snap: any = await cacheGet(CRM_SNAPSHOT_KEY, 24 * 60 * 60 * 1000);
    if (!snap) return c.json({ ok: false, error: 'no snapshot to refresh' }, 404);
    if (typeof body?.fingerprint === 'string' && snap?.fingerprint && body.fingerprint !== snap.fingerprint) {
      return c.json({ ok: false, error: 'fingerprint mismatch — POST a full snapshot' }, 409);
    }
    snap.fetchedAt = typeof body?.fetchedAt === 'string' ? body.fetchedAt : snap.fetchedAt;
    await cacheSet(CRM_SNAPSHOT_KEY, snap, CRM_SNAPSHOT_KEEP_MS);
    return c.json({ ok: true });
  });

  // ── CRM manual actions (CrmOrderAction override layer) ─────────────────────
  // Operators advance/cancel orders from the dashboard; the runner fetches
  // recent actions and applies them on top of Zoho's raw status.
  app.get('/api/runner/crm/actions', async (c) => {
    if (!requireSecret(c)) return c.text('Unauthorized', 401);
    const since = c.req.query('since') || '1970-01-01';
    try {
      const rows = await prisma.crmOrderAction.findMany({
        where: { day: { gte: since } },
        orderBy: { createdAt: 'asc' }, // latest row per SO wins (runner overwrites)
        take: 2000,
      });
      return c.json({ actions: rows });
    } catch (e: any) {
      logger.warn({ err: e?.message }, 'crm actions read failed');
      return c.json({ actions: [] });
    }
  });

  // ── Zoho analyzer no-change fingerprint (KV) ────────────────────────────────
  const ZOHO_FP_KEY = 'zoho:analyzer:state_fingerprint';
  const ZOHO_FP_TTL_MS = 24 * 60 * 60 * 1000;

  app.get('/api/runner/zoho/fingerprint', async (c) => {
    if (!requireSecret(c)) return c.text('Unauthorized', 401);
    const { cacheGet }: { cacheGet: <T>(key: string, ttlMs: number) => Promise<T | null> } = require('../../shared/cache');
    const fp = await cacheGet<string>(ZOHO_FP_KEY, ZOHO_FP_TTL_MS);
    // While ANY active estimate still lacks lead details (detailsCaptured=0),
    // the runner must keep re-entering the pass instead of trusting the
    // no-change fingerprint — this is what keeps new/uncaptured estimates in
    // the 15-min capture loop until the sales agent posts the lead block
    // (~40 min). Estimates that exhausted their 10-turn AI budget
    // (detailsFailed=1) are terminal and must NOT hold the loop open.
    // Fail-open (true) so an error never starves capture.
    let needsBackfill = true;
    try {
      const { prisma } = deps();
      const pending = await prisma.estimate.count({ where: { status: 'sent', detailsCaptured: false, detailsFailed: false } });
      needsBackfill = pending > 0;
    } catch (e: any) {
      console.warn({ err: e?.message }, 'fingerprint: pending-details count failed — keeping backfill enabled');
    }
    return c.json({ fingerprint: fp ?? null, needsBackfill });
  });

  app.post('/api/runner/zoho/fingerprint', async (c) => {
    if (!requireSecret(c)) return c.text('Unauthorized', 401);
    const { cacheSet }: { cacheSet: <T>(key: string, value: T, ttlMs: number) => Promise<void> } = require('../../shared/cache');
    const body = await c.req.json().catch(() => ({}));
    const fp = typeof body?.fingerprint === 'string' && body.fingerprint ? body.fingerprint : null;
    if (fp) await cacheSet(ZOHO_FP_KEY, fp, ZOHO_FP_TTL_MS);
    return c.json({ ok: true });
  });

  app.post('/api/runner/zoho/comments', async (c) => {
    if (!requireSecret(c)) return c.text('Unauthorized', 401);
    const { prisma } = deps();
    const body = await c.req.json().catch(() => ({}));
    const comments = Array.isArray(body.comments) ? body.comments : [];
    const incoming = comments.filter((cm: any) => cm?.commentId);
    const existing = new Map<string, any>();
    for (let i = 0; i < incoming.length; i += 80) {
      const chunk = incoming.slice(i, i + 80).map((cm: any) => String(cm.commentId));
      try {
        const rows = await prisma.comment.findMany({ where: { commentId: { in: chunk } } });
        for (const r of rows as any[]) existing.set(String(r.commentId), r);
      } catch (e: any) {
        console.warn({ err: e?.message }, 'zoho/comments dedupe read failed — falling back to full upsert');
      }
    }
    let upserted = 0;
    for (const cm of incoming) {
      const prev = existing.get(String(cm.commentId));
      const next = {
        estimateId: cm.estimateId,
        description: cm.description || '',
        commentedBy: cm.commentedBy || '',
        date: cm.date || '',
        dateDescription: cm.dateDescription || '',
        dateFormatted: cm.dateFormatted || null,
      };
      const unchanged =
        prev &&
        prev.estimateId === next.estimateId &&
        prev.description === next.description &&
        prev.commentedBy === next.commentedBy &&
        prev.date === next.date &&
        prev.dateDescription === next.dateDescription &&
        (prev.dateFormatted ?? null) === next.dateFormatted;
      if (unchanged) continue;
      await prisma.comment.upsert({
        where: { commentId: cm.commentId },
        update: next,
        create: { commentId: cm.commentId, ...next },
      });
      upserted++;
    }
    notifyLive(c, { type: 'estimates' });
    // Only invalidate caches when comments actually changed — the runner POSTs
    // every 15 min even with zero deltas, and an unconditional invalidation
    // forces a cold ~3s recompute of /api/estimates on the next visitor.
    if (upserted > 0) {
      const { invalidateDerivedEstimateCaches } = require('../../shared/estimates-cache');
      await invalidateDerivedEstimateCaches();
    }
    return c.json({ ok: true, count: upserted, skipped: incoming.length - upserted });
  });

  app.post('/api/runner/zoho/status', async (c) => {
    if (!requireSecret(c)) return c.text('Unauthorized', 401);
    const body = await c.req.json().catch(() => ({}));
    const updates = Array.isArray(body.updates) ? body.updates : [];
    const { applyStatusUpdates } = await import('../../modules/estimates/status-sync');
    const { updated, enquiriesAutoSent } = (await applyStatusUpdates(updates)) as any;
    notifyLive(c, { type: 'estimates' });
    // Zoho status chip on Sales Enquiry dashboard is derived from Estimate.status
    // (enriched in /api/enquiries list via Estimate table, no extra Zoho reads).
    // Sales enquiries subscribe only to `enquiries` live events, so a status
    // flip must also nudge enquiries live or the Zoho chip stays stale until
    // the next 5-min poll. Same pattern as lead-details below.
    if (updated > 0 || (enquiriesAutoSent ?? 0) > 0) notifyLive(c, { type: LiveEvent.Enquiries });
    // A status flip to accepted/confirmed writes a slab close credit into the
    // telecalling ledger (recordConversionClose above) — the Telecalling
    // dashboard subscribes narrowly to automation/telecalling events, so it
    // needs its own broadcast or an open tab never shows the win until a
    // manual refresh. Same dual-notify precedent as the lead-details route.
    notifyLive(c, { type: LiveEvent.Telecalling });
    if (updated > 0) {
      const { invalidateDerivedEstimateCaches } = require('../../shared/estimates-cache');
      await invalidateDerivedEstimateCaches();
    }
    return c.json({ ok: true, count: updated, enquiriesAutoSent: enquiriesAutoSent ?? 0 });
  });

  app.post('/api/runner/zoho/classification', async (c) => {
    if (!requireSecret(c)) return c.text('Unauthorized', 401);
    const { prisma } = deps();
    const body = await c.req.json().catch(() => ({}));
    const { estimateId, classification } = body;
    if (!estimateId || !classification) return c.json({ error: 'estimateId + classification required' }, 400);
    const now = new Date();
    const toYN = (v: unknown) => (v === 'Yes' || v === 'yes' || v === true ? 'Yes' : 'No');

    // Skip re-invalidating when the classification is unchanged — the runner
    // force-reclassifies ~100 estimates in one pass, and each one previously
    // blew the /api/estimates cache (→ a 3s cold recompute for the next user).
    let changed = true;
    try {
      const prev = await prisma.classification.findUnique({ where: { estimateId } });
      if (prev) {
        changed =
          prev.meaningfulUpdate !== !!classification.meaningfulUpdate ||
          prev.notAnswering !== toYN(classification.notAnswering) ||
          prev.movingSlow !== toYN(classification.movingSlow) ||
          prev.underDiscussion !== toYN(classification.underDiscussion) ||
          prev.confirm !== toYN(classification.confirm) ||
          prev.intentScore !== (classification.intentScore ?? 2) ||
          prev.reasoning !== (classification.reasoning || '') ||
          prev.summary !== (classification.summary || '') ||
          (prev.salesAgent || 'Unassigned').trim() !== (classification.salesAgent || 'Unassigned').trim();
      }
    } catch (e: any) {
      console.warn({ err: e?.message, estimateId }, 'classification change-check failed — assuming changed');
    }

    await prisma.classification.upsert({
      where: { estimateId },
      update: {
        meaningfulUpdate: !!classification.meaningfulUpdate,
        notAnswering: toYN(classification.notAnswering),
        movingSlow: toYN(classification.movingSlow),
        underDiscussion: toYN(classification.underDiscussion),
        confirm: toYN(classification.confirm),
        intentScore: classification.intentScore ?? 2,
        reasoning: classification.reasoning || '',
        summary: classification.summary || '',
        salesAgent: (classification.salesAgent || 'Unassigned').trim(),
        processedAt: now,
      },
      create: {
        estimateId,
        meaningfulUpdate: !!classification.meaningfulUpdate,
        notAnswering: toYN(classification.notAnswering),
        movingSlow: toYN(classification.movingSlow),
        underDiscussion: toYN(classification.underDiscussion),
        confirm: toYN(classification.confirm),
        intentScore: classification.intentScore ?? 2,
        reasoning: classification.reasoning || '',
        summary: classification.summary || '',
        salesAgent: (classification.salesAgent || 'Unassigned').trim(),
        processedAt: now,
      },
    });
    await prisma.estimate.update({ where: { estimateId }, data: { lastSyncTime: now } });
    notifyLive(c, { type: 'estimates' });
    if (changed) {
      const { invalidateDerivedEstimateCaches } = require('../../shared/estimates-cache');
      await invalidateDerivedEstimateCaches();
    }
    return c.json({ ok: true });
  });

  // ── email-brain-index runner ─────────────────────────────────────────────────
  app.post('/api/runner/emails', async (c) => {
    if (!requireSecret(c)) return c.text('Unauthorized', 401);
    const { StorageRepository } = deps();
    const body = await c.req.json().catch(() => ({}));
    const emails = Array.isArray(body.emails) ? body.emails : [];
    let saved = 0;
    for (const e of emails) {
      if (!e.subject || !e.sender || !e.body) continue;
      await StorageRepository.storeEmail({ subject: e.subject, sender: e.sender, body: e.body });
      saved++;
    }
    if (saved > 0) broadcastLive(c, LiveEvent.Email);
    return c.json({ ok: true, count: saved });
  });

  app.get('/api/runner/brain/sources', async (c) => {
    if (!requireSecret(c)) return c.text('Unauthorized', 401);
    const { prisma } = deps();
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const [messages, emails, digests, estimates, tasks] = await Promise.all([
      prisma.message.findMany({ where: { timestamp: { gte: cutoff } }, orderBy: { timestamp: 'desc' }, take: 500 }),
      prisma.email.findMany({ orderBy: { createdAt: 'desc' }, take: 300 }),
      prisma.digest.findMany({ orderBy: { createdAt: 'desc' }, take: 300 }),
      prisma.estimate.findMany({ include: { comments: true, classification: true }, orderBy: { lastSyncTime: 'desc' }, take: 500 }),
      prisma.task.findMany({ orderBy: { createdAt: 'desc' }, take: 300 }),
    ]);
    return c.json({ messages, emails, digests, estimates, tasks });
  });

  app.post('/api/runner/brain/context', async (c) => {
    if (!requireSecret(c)) return c.text('Unauthorized', 401);
    const body = await c.req.json().catch(() => ({}));
    const rows = Array.isArray(body.rows) ? body.rows : [];
    const db = c.env.DB;
    if (!db || !db.batch) return c.json({ ok: true, count: 0 });
    const incoming = rows.filter((r: any) => r?.source && r?.sourceId && r?.content);
    const existing = new Map<string, any>();
    const bySource = new Map<string, any[]>();
    for (const r of incoming) {
      const key = String(r.source);
      if (!bySource.has(key)) bySource.set(key, []);
      bySource.get(key)!.push(r);
    }
    for (const [source, srows] of bySource) {
      for (let i = 0; i < srows.length; i += 80) {
        const chunk = srows.slice(i, i + 80).map((r: any) => String(r.sourceId));
        const ph = chunk.map(() => '?').join(',');
        try {
          const res = await db
            .prepare(`SELECT source, sourceId, content, metadata FROM "BrainContext" WHERE source = ? AND sourceId IN (${ph})`)
            .bind(source, ...chunk)
            .all();
          for (const r of res.results || []) existing.set(`${r.source}:${r.sourceId}`, r);
        } catch (e: any) {
          console.warn({ err: e?.message, source }, 'brain/context dedupe read failed — falling back to full upsert');
        }
      }
    }
    let upserted = 0;
    const stmts: any[] = [];
    for (const row of incoming) {
      const now = new Date();
      const prev = existing.get(`${row.source}:${row.sourceId}`);
      if (prev && prev.content === row.content && (prev.metadata ?? null) === (row.metadata || null)) continue;
      stmts.push(
        db
          .prepare(
            `INSERT INTO "BrainContext" (id, source, sourceId, entityName, content, metadata, indexedAt, eventDate)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(source, sourceId) DO UPDATE SET
               entityName = excluded.entityName,
               content = excluded.content,
               metadata = excluded.metadata,
               indexedAt = excluded.indexedAt,
               eventDate = excluded.eventDate`,
          )
          .bind(
            crypto.randomUUID(),
            row.source,
            row.sourceId,
            row.entityName || null,
            row.content,
            row.metadata || null,
            now.toISOString(),
            row.eventDate ? new Date(row.eventDate).toISOString() : now.toISOString(),
          ),
      );
      upserted++;
    }
    for (let i = 0; i < stmts.length; i += 100) {
      await db.batch(stmts.slice(i, i + 100));
    }
    if (upserted > 0) broadcastLive(c, LiveEvent.Brain);
    return c.json({ ok: true, count: upserted, skipped: incoming.length - upserted });
  });

  // ── MIS bulk assignment enforcement (one-shot ops tool) ──────────────────────
  // Body: { moves: [{ estimateNumber?, estimateId?, telecallerId }], followUpAgents?: [id], reason?: string }
  // Thin secret-gated wrapper around the shared bulkAssignEstimates core (also
  // used by the interactive MIS endpoint). See service.ts for semantics.
  app.post('/api/runner/estimates/bulk-assign', async (c) => {
    if (!requireSecret(c)) return c.text('Unauthorized', 401);
    const body = await c.req.json().catch(() => ({}));
    const moves = Array.isArray(body.moves) ? body.moves : [];
    const followUpAgents = Array.isArray(body.followUpAgents) ? body.followUpAgents : [];
    if (moves.length === 0 && followUpAgents.length === 0) {
      return c.json({ error: 'moves[] or followUpAgents[] required' }, 400);
    }
    const result = await bulkAssignEstimates(moves, { followUpAgents, reason: body.reason });
    if (result.moved.length > 0 || result.flagsUpdated.length > 0) notifyLive(c, { type: LiveEvent.Telecalling });
    return c.json({ ok: result.errors.length === 0, movedCount: result.moved.length, ...result });
  });

  // ── telecalling effort-sync (every-15min GH runner) ──────────────────────────
  // Pulls ALL pages of the NeoDove lead-call-log for today + 2 prior IST days
  // (worker-side fetch — GH egress is blocked by NeoDove) and persists per-day
  // snapshots to Setting `telecalling:effort:<YYYY-MM-DD>`. The 30-min
  // assignment engine reads these for the snatch shield; the MIS Shield tab
  // reads them for audit. Fail-open: ok:false leaves the engine unshielded.
  app.post('/api/runner/telecalling/effort-sync', async (c) => {
    if (!requireSecret(c)) return c.text('Unauthorized', 401);
    const result = await syncEffortSnapshots();
    if (result.ok) notifyLive(c, { type: LiveEvent.Telecalling });
    return c.json(result);
  });

  // ── enquiry price-memory backfill (GH runner, paged) ─────────────────────────
  // Returns finalized line items (finalRate set, spec undisputed) for Pinecone
  // indexing. Paged over enquiries newest-first: ?offset=&limit= (max 100).
  app.get('/api/runner/enquiry-memory/finalized', async (c) => {    if (!requireSecret(c)) return c.text('Unauthorized', 401);
    const offset = Math.max(0, Math.floor(Number(c.req.query('offset')) || 0));
    const limit = Math.min(100, Math.max(1, Math.floor(Number(c.req.query('limit')) || 50)));
    const store = createEnquiryStore(c.env);
    const page = await store.listEnquiriesPaged(offset, limit);
    const rows: any[] = [];
    for (const e of (page.rows as any[]) ?? []) {
      const items = Array.isArray((e as any).items) ? (e as any).items : [];
      items.forEach((it: any, idx: number) => {
        const rate = it?.finalRate;
        if (rate === undefined || rate === null || !Number.isFinite(Number(rate))) return;
        if (it?.specIssue) return;
        rows.push({
          enquiryId: String((e as any).id),
          itemIndex: idx,
          name: String(it?.name ?? ''),
          qty: String(it?.qty ?? ''),
          spec: String(it?.spec ?? ''),
          rates: Array.isArray(it?.rates) ? it.rates.map((r: any) => ({ vendor: String(r?.vendor ?? ''), rate: Number(r?.rate) })) : [],
          finalRate: Number(rate),
          markup: it?.markup !== undefined && it?.markup !== null ? Number(it.markup) : undefined,
          selectedVendor: it?.selectedVendor ? String(it.selectedVendor) : undefined,
          finalizedAt: it?.finalizedAt ? String(it.finalizedAt) : String((e as any).updatedAt ?? (e as any).createdAt ?? ''),
        });
      });
    }
    return c.json({ rows, nextOffset: offset + page.rows.length, total: page.total });
  });

  // ── enquiry intake queue (GH intake runner, parallel-safe) ──────────────────
  // Per-enquiry done/claim markers in Setting (NOT a time watermark — parallel
  // runners completing out of order can never strand an enquiry):
  //   enquiry:intake:done:<id>  = updatedAt already processed (reprocesses
  //                               when the row gets newer than this)
  //   enquiry:intake:claim:<id> = runner claim instant (fresh < 10 min means
  //                               another runner owns it; stale claims are
  //                               ignored so crashed runs never block the queue)
  // GET pending: candidate rows for claiming (full rows, secret-gated).
  // Media is capped (4 images/enq, <=2M chars each) so the payload stays small;
  // oversized items are flagged mediaTruncated for the runner to note.
  const INTAKE_DONE = 'enquiry:intake:done:';
  const INTAKE_CLAIM = 'enquiry:intake:claim:';
  const CLAIM_TTL_MS = 10 * 60 * 1000;

  async function readSettingMap(db: any, keys: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (!db || keys.length === 0) return out;
    for (let i = 0; i < keys.length; i += 100) {
      const chunk = keys.slice(i, i + 100);
      try {
        const res = await db
          .prepare(`SELECT key, value FROM Setting WHERE key IN (${chunk.map(() => '?').join(',')})`)
          .bind(...chunk)
          .all();
        for (const r of (res as any).results ?? []) out.set(String((r as any).key), String((r as any).value ?? ''));
      } catch { /* best-effort */ }
    }
    return out;
  }

  function slimEnquiry(e: any): any {
    const MAX_IMAGE_CHARS = 2_000_000;
    const MAX_IMAGES = 4;
    const items = Array.isArray((e as any).items) ? (e as any).items : [];
    let images = 0;
    let mediaTruncated = false;
    const takeImage = (url: unknown, name?: unknown): { type: string; url: string; name?: string } | null => {
      if (typeof url !== 'string' || (!url.startsWith('data:image/') && !url.startsWith('http'))) return null;
      if (images >= MAX_IMAGES || url.length > MAX_IMAGE_CHARS) { mediaTruncated = true; return null; }
      images++;
      return name ? { type: 'image', url, name: String(name) } : { type: 'image', url };
    };
    // Enquiry-level photos first (unstructured intake), then per-item media.
    const enquiryImages: Array<{ type: string; url: string }> = [];
    try {
      // The D1 store returns imageUrls as a parsed array; older shapes may
      // carry the raw JSON string — accept both (a String(array) is NOT
      // valid JSON, so guessing wrong silently drops every image).
      const raw = (e as any).imageUrls;
      const rawUrls = Array.isArray(raw) ? raw : (raw ? JSON.parse(String(raw)) : []);
      for (const u of (Array.isArray(rawUrls) ? rawUrls : []).slice(0, MAX_IMAGES)) {
        const kept = takeImage(typeof u === 'string' ? u : (u as any)?.url);
        if (kept) enquiryImages.push(kept);
      }
    } catch { /* imageUrls unparseable — item media still flows */ }
    const slimItems = items.slice(0, 30).map((it: any) => {
      const media = Array.isArray(it?.media) ? it.media : [];
      const kept: Array<{ type: string; url: string; name?: string }> = [];
      for (const m of media) {
        if (m?.type !== 'image') continue;
        const k = takeImage(m?.url, m?.name);
        if (k) kept.push(k);
        else if (typeof m?.url === 'string') mediaTruncated = true;
      }
      return { name: String(it?.name ?? ''), qty: String(it?.qty ?? ''), spec: String(it?.spec ?? ''), media: kept };
    });
    // AI bulk-add (detail-view "Add via AI"): unstructured specs awaiting the
    // vision split. The runner uses this as its Stage-A text instead of the
    // enquiry description (item specs are otherwise invisible to the router).
    const aiBulkText = items
      .filter((it: any) => it?.aiPending === true)
      .map((it: any) => String(it?.spec ?? '').trim())
      .filter(Boolean)
      .join('\n\n')
      .slice(0, 3000);
    return { ...(e as any), items: slimItems, enquiryImages, mediaTruncated, aiBulkText };
  }

  app.get('/api/runner/enquiry-intake/pending', async (c) => {
    if (!requireSecret(c)) return c.text('Unauthorized', 401);
    const limit = Math.min(50, Math.max(1, Math.floor(Number(c.req.query('limit')) || 20)));
    const store = createEnquiryStore(c.env);
    // Scan newest-first for candidates (cap the scan; the queue drains over ticks).
    const candidates: any[] = [];
    let offset = 0;
    for (let page = 0; page < 4 && candidates.length < limit * 4; page++) {
      const res = await store.listEnquiriesPaged(offset, 50);
      if (res.rows.length === 0) break;
      candidates.push(...((res.rows as any[]) ?? []));
      offset += res.rows.length;
      if (offset >= (res as any).total) break;
    }
    const now = Date.now();
    const keys: string[] = [];
    for (const e of candidates) {
      keys.push(INTAKE_DONE + String((e as any).id), INTAKE_CLAIM + String((e as any).id));
    }
    const markers = await readSettingMap((c.env as any).DB, keys);
    const rows: any[] = [];
    for (const e of candidates) {
      if (rows.length >= limit) break;
      const id = String((e as any).id);
      const updatedAt = String((e as any).updatedAt ?? (e as any).createdAt ?? '');
      const done = markers.get(INTAKE_DONE + id);
      if (done && done >= updatedAt) continue;
      const claim = markers.get(INTAKE_CLAIM + id);
      if (claim && now - new Date(claim).getTime() < CLAIM_TTL_MS) continue;
      rows.push(slimEnquiry(e));
    }
    return c.json({ rows });
  });

  // POST claim: stake out ids for this runner (best-effort, idempotent).
  app.post('/api/runner/enquiry-intake/claim', async (c) => {
    if (!requireSecret(c)) return c.text('Unauthorized', 401);
    const body = await c.req.json().catch(() => ({}));
    const ids = (Array.isArray(body?.ids) ? body.ids : []).map((v: any) => String(v ?? '')).filter(Boolean).slice(0, 25);
    if (ids.length === 0) return c.json({ claimed: [] });
    const now = new Date().toISOString();
    const db = (c.env as any).DB;
    const claimed: string[] = [];
    const markers = await readSettingMap(db, ids.map((id) => INTAKE_CLAIM + id));
    const stmts: any[] = [];
    for (const id of ids) {
      const claim = markers.get(INTAKE_CLAIM + id);
      if (claim && Date.now() - new Date(claim).getTime() < CLAIM_TTL_MS) continue;
      stmts.push(
        db.prepare(`INSERT INTO Setting(key, value, updatedAt) VALUES(?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt`)
          .bind(INTAKE_CLAIM + id, now, now),
      );
      claimed.push(id);
    }
    for (let i = 0; i < stmts.length; i += 50) {
      try {
        await db.batch(stmts.slice(i, i + 50));
      } catch { /* best-effort */ }
    }
    return c.json({ claimed });
  });

  // POST result: applies vision-extraction output. Fill-empty-only semantics:
  // structured fields only when blank, items only when the row has none,
  // suggestions + missing slots go to KV for the sales UI. Never prices.
  app.post('/api/runner/enquiry-intake/result', async (c) => {
    if (!requireSecret(c)) return c.text('Unauthorized', 401);
    const body = await c.req.json().catch(() => ({}));
    const enquiryId = String(body?.enquiryId ?? '');
    if (!enquiryId) return c.json({ error: 'enquiryId required' }, 400);
    const store = createEnquiryStore(c.env);
    const existing: any = await store.getEnquiry(enquiryId).catch(() => null);
    if (!existing) return c.json({ error: 'not found' }, 404);
    const updates: Record<string, any> = {};
    for (const f of ['title', 'clientCompany', 'contactName', 'contactEmail', 'contactPhone', 'location', 'sourceLead']) {
      const v = String((body.fields as any)?.[f] ?? '').trim();
      if (!v || String(existing[f] ?? '').trim()) continue;
      // "Lead of <agent>" is the owning salesperson, not a lead source —
      // drop anything that smells like an agent reference.
      if (f === 'sourceLead' && /sales|lead\s*of|agent/i.test(v)) continue;
      (updates as any)[f] = v.slice(0, 300);
    }
    const incomingItems = Array.isArray(body.items) ? body.items : [];
    const existingItems = Array.isArray(existing.items) ? existing.items : [];
    if (existingItems.length === 0 && incomingItems.length > 0) {
      (updates as any).items = incomingItems.slice(0, 50).map((it: any) => ({
        name: String(it?.name ?? '').slice(0, 300),
        qty: String(it?.qty ?? '').slice(0, 120),
        spec: String(it?.spec ?? '').slice(0, 2000),
        media: [],
        ...(it?.category ? { category: String(it.category).slice(0, 120) } : {}),
        ...(it?.verbatim ? { verbatim: String(it.verbatim).slice(0, 500) } : {}),
      }));
    } else {
      // AI bulk-add merge: replace `aiPending` raw items with the
      // vision-split lines (deduped, photos carried over). Null = none
      // pending, row untouched.
      const { applyIntakeBulkResult } = await import('../../modules/enquiries/update');
      const merged = applyIntakeBulkResult(existingItems, incomingItems);
      if (merged) (updates as any).items = merged;
      else if (incomingItems.length > 0 && existingItems.length > 0) {
        // No aiPending row on the stored enquiry — the router lines are
        // discarded and the row is untouched. Logs here (not silently)
        // so a dropped Add-via-AI flag is visible in `wrangler tail`.
        console.log(`intake-result ${enquiryId}: ${incomingItems.length} lines discarded, no aiPending item stored`);
      }
    }
    // A finalized row given fresh undecided loop items (bulk-split lines
    // carry no decision) must drop back to rates_received — otherwise the
    // Management panel stays locked with items nobody can save (Enquiry 5).
    // Fully-decided rows stay finalized.
    if (String((existing as any)?.rateStatus ?? '') === 'finalized') {
      const mergedItems = Array.isArray((updates as any).items) ? (updates as any).items : existingItems;
      const loop = mergedItems.filter((it: any) => !it?.specIssue && !it?.rateAvailable && !it?.internalRates);
      const done = loop.filter((it: any) => it?.finalRate !== undefined && it?.finalRate !== null && Number.isFinite(Number(it?.finalRate)));
      const loopDone = loop.length === 0 ? mergedItems.length > 0 : done.length === loop.length;
      if (!loopDone) (updates as any).rateStatus = 'rates_received';
    }
    let updated: any = existing;
    if (Object.keys(updates).length > 0) {
      updated = await store.updateEnquiry(enquiryId, updates).catch(() => null) ?? existing;
    }
    try {
      await cacheSet(`enquiry:intake:${enquiryId}`, {
        at: new Date().toISOString(),
        suggestions: Array.isArray(body.suggestions) ? body.suggestions.slice(0, 25) : [],
        missing: Array.isArray(body.missing) ? body.missing.slice(0, 25).map((s: any) => String(s).slice(0, 300)) : [],
        candidates: Array.isArray(body.candidates) ? body.candidates.slice(0, 10) : [],
      }, 7 * 24 * 60 * 60 * 1000);
    } catch { /* best-effort */ }
    // Mark done at the post-write updatedAt (edits landing after our write
    // stay newer and reprocess); release our claim with an expired stamp.
    const doneAt = String((updated as any)?.updatedAt ?? existing.updatedAt ?? new Date().toISOString());
    const nowIso = new Date().toISOString();
    const expired = new Date(Date.now() - CLAIM_TTL_MS - 1000).toISOString();
    try {
      await (c.env as any).DB.batch([
        (c.env as any).DB.prepare(
          `INSERT INTO Setting(key, value, updatedAt) VALUES(?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt`,
        ).bind(INTAKE_DONE + enquiryId, doneAt, nowIso),
        (c.env as any).DB.prepare(
          `INSERT INTO Setting(key, value, updatedAt) VALUES(?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt`,
        ).bind(INTAKE_CLAIM + enquiryId, expired, nowIso),
      ]);
    } catch { /* best-effort */ }
    if (Object.keys(updates).length > 0) {
      try {
        await cacheDel('enquiry-tracker:data');
      } catch { /* best-effort */ }
      notifyLive(c, { type: LiveEvent.Enquiries });
    }
    return c.json({ ok: true, appliedFields: Object.keys(updates).filter((k) => k !== 'items'), appliedItems: (updates as any).items?.length ?? 0 });
  });
}