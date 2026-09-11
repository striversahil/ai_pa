// ─────────────────────────────────────────────────────────────────────────────
// routes/runner.ts — instant D1 data-read + result-write endpoints for the GH
// Actions runner scripts (scripts/*.js). Heavy AI / cron / Zoho crawling runs on
// the runner; this worker only fetches raw rows and persists results. All
// endpoints are SHARED_SECRET gated and stay well under the 30s CPU limit.
// ─────────────────────────────────────────────────────────────────────────────
import type { Hono } from 'hono';
import { deps, requireSecret, notifyLive, broadcastLive, LiveEvent, type Bindings } from '../context';
import { prisma } from '../../shared/prisma';
import { logger } from '../../shared/logger';
import { bulkAssignEstimates } from '../../automations/telecalling/service';
import { syncEffortSnapshots } from '../../automations/telecalling/effort-sync';

export function registerRunnerRoutes(app: Hono<{ Bindings: Bindings }>): void {
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
        }))
      : [];
    const cache = require('../../shared/cache');
    const next = { date: body.date, count: body.count, totalValue: Number(body.totalValue) || 0, statuses: body.statuses || {}, orders };
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
  const CRM_STAGES = ['confirm', 'invoice', 'ship', 'payment'];
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

    // Previous active orders: so → { stage, paidStatus }.
    const prevBySo = new Map<string, { stage: string; paidStatus: string }>();
    const prevSource = prev?.stages || prev?.byProcess || {};
    for (const [stage, entry] of Object.entries(prevSource)) {
      for (const o of (entry as any)?.orders ?? []) {
        if (o?.so) prevBySo.set(String(o.so), { stage, paidStatus: String(o.paidStatus || '') });
      }
    }
    // New active orders: so → { stage, paidStatus, createdToday, salesperson }.
    const nextBySo = new Map<string, { stage: string; paidStatus: string; createdToday: boolean; salesperson: string }>();
    for (const [stage, entry] of Object.entries(stages)) {
      for (const o of entry.orders) {
        if (o?.so) nextBySo.set(String(o.so), {
          stage,
          paidStatus: String(o.paidStatus || ''),
          createdToday: !!o.createdToday,
          salesperson: String(o.salesperson || ''),
        });
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

    for (const [so, next] of nextBySo) {
      const prevEntry = prevBySo.get(so);
      if (!prevEntry) {
        // First time visible in the pipeline. Only orders CREATED TODAY earn the
        // new-order credit (prevents a re-credit flood if the KV snapshot expired).
        if (next.createdToday) credit('crm', so, 25, 'New sales order created', next.salesperson);
        continue;
      }
      if (prevEntry.stage !== next.stage) {
        const prevIdx = CRM_STAGES.indexOf(prevEntry.stage);
        const nextIdx = CRM_STAGES.indexOf(next.stage);
        if (nextIdx > prevIdx) awardStageCompletions(prevIdx, nextIdx - 1, so, next.salesperson);
        // Regression (credit note / manual revert) scores nothing.
      }
      if (next.paidStatus === 'paid' && prevEntry.paidStatus !== 'paid') {
        credit('accounts', so, 100, 'Payment received', null);
      }
    }

    // Closed orders (absent from the active stages): paid → Accounts +100 with
    // all stage completions implied; cancelled/void → −20 to the dept that
    // owned the stage the order was sitting in.
    const closedList: any[] = Array.isArray(body.closed) ? body.closed.slice(0, 400) : [];
    for (const co of closedList) {
      const so = String(co?.so || '');
      const prevEntry = prevBySo.get(so);
      if (!prevEntry) continue; // wasn't active in the previous snapshot — nothing to credit
      const status = String(co?.status || '');
      const salesperson = String(co?.salesperson || '') || null;
      if (status === 'cancelled' || status === 'void') {
        credit(STAGE_DEPT[prevEntry.stage] || 'crm', so, -20, `Order cancelled (was in ${prevEntry.stage})`, salesperson);
      } else if ((co?.paidStatus === 'paid' || co?.orderStatus === 'closed') && prevEntry.paidStatus !== 'paid') {
        const prevIdx = CRM_STAGES.indexOf(prevEntry.stage);
        if (prevIdx >= 0) awardStageCompletions(prevIdx, CRM_STAGES.length - 1, so, salesperson);
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

    await cacheSet(
      CRM_SNAPSHOT_KEY,
      {
        date: body.date,
        totalActive: Number(body.totalActive) || 0,
        totalValue: Number(body.totalValue) || 0,
        stages,
        byProcess: stages, // legacy alias (pre-department dashboards)
        closed: closedList,
        materials: Array.isArray(body.materials) ? body.materials.slice(0, 300) : [],
        salespeople: Array.isArray(body.salespeople) ? body.salespeople.slice(0, 200) : [],
        meta: body.meta ?? null,
        computedAt: new Date().toISOString(),
      },
      45 * 60 * 1000,
    );
    // The aggregated data() cache derives from the snapshot + ledger — bust it.
    await cacheDel(CRM_DATA_CACHE_KEY).catch(() => {});
    broadcastLive(c, LiveEvent.Crm, { totalActive: Number(body.totalActive) || 0, events: persisted });
    return c.json({ ok: true, events: persisted });
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
    const { prisma } = deps();
    const body = await c.req.json().catch(() => ({}));
    const updates = Array.isArray(body.updates) ? body.updates : [];
    let updated = 0;
    for (const u of updates) {
      if (!u.estimateId || !u.status) continue;
      await prisma.estimate.update({
        where: { estimateId: u.estimateId },
        data: { status: u.status, lastSyncTime: new Date() },
      });
      if (u.status === 'accepted' || u.status === 'confirmed') {
        try {
          const { recordConversionClose } = require('../../automations/telecalling/service');
          await recordConversionClose(u.estimateId);
        } catch (e: any) {
          console.warn({ err: e?.message, estimateId: u.estimateId }, 'recordConversionClose failed');
        }
      }
      // Declines carry no penalty (retired) — status sync only.
      updated++;
    }
    notifyLive(c, { type: 'estimates' });
    // A status flip to accepted/confirmed writes a +100 close into the
    // telecalling ledger (recordConversionClose above) — the Telecalling
    // dashboard subscribes narrowly to automation/telecalling events, so it
    // needs its own broadcast or an open tab never shows the win until a
    // manual refresh. Same dual-notify precedent as the lead-details route.
    notifyLive(c, { type: LiveEvent.Telecalling });
    if (updated > 0) {
      const { invalidateDerivedEstimateCaches } = require('../../shared/estimates-cache');
      await invalidateDerivedEstimateCaches();
    }
    return c.json({ ok: true, count: updated });
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
}