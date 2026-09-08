// ─────────────────────────────────────────────────────────────────────────────
// routes/runner.ts — instant D1 data-read + result-write endpoints for the GH
// Actions runner scripts (scripts/*.js). Heavy AI / cron / Zoho crawling runs on
// the runner; this worker only fetches raw rows and persists results. All
// endpoints are SHARED_SECRET gated and stay well under the 30s CPU limit.
// ─────────────────────────────────────────────────────────────────────────────
import type { Hono } from 'hono';
import { deps, requireSecret, notifyLive, broadcastLive, LiveEvent, kolkataDateStr, type Bindings } from '../context';
import { recordAssignment, invalidateRiskCache } from '../../automations/telecalling/service';

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
      if (u.status === 'declined' || u.status === 'cancelled' || u.status === 'void') {
        try {
          const { recordDeclinePenalty } = require('../../automations/telecalling/service');
          await recordDeclinePenalty(u.estimateId);
        } catch (e: any) {
          console.warn({ err: e?.message, estimateId: u.estimateId }, 'recordDeclinePenalty failed');
        }
      }
      updated++;
    }
    notifyLive(c, { type: 'estimates' });
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
  // One-time assign: sets Estimate.assignedTelecallerId + ledger rows, NO locks,
  // NO score events/penalties (redistribution itself is never a snatch). Only
  // `sent` estimates move; anything else is reported as skipped. Temp-cover
  // provenance is explicitly cleared (these are real assignments, not covers).
  app.post('/api/runner/estimates/bulk-assign', async (c) => {
    if (!requireSecret(c)) return c.text('Unauthorized', 401);
    const { prisma } = deps();
    const body = await c.req.json().catch(() => ({}));
    const moves = Array.isArray(body.moves) ? body.moves : [];
    const followUpAgents = Array.isArray(body.followUpAgents) ? body.followUpAgents : [];
    const reason = typeof body.reason === 'string' && body.reason ? body.reason : 'MIS bulk mapping enforcement';
    if (moves.length === 0 && followUpAgents.length === 0) {
      return c.json({ error: 'moves[] or followUpAgents[] required' }, 400);
    }
    if (moves.length > 500) return c.json({ error: 'max 500 moves per call' }, 400);

    const moved: Array<Record<string, unknown>> = [];
    const skipped: Array<Record<string, unknown>> = [];
    const errors: Array<Record<string, unknown>> = [];

    // Resolve + validate everything BEFORE writing (all-or-checked, fail fast per item).
    const plan: Array<{ estimateId: string; estimateNumber: string; from: string | null; to: string }> = [];
    for (const m of moves) {
      const ident = m.estimateNumber ?? m.estimateId;
      if (!ident || !m.telecallerId) { errors.push({ ident, error: 'estimateNumber/estimateId + telecallerId required' }); continue; }
      const est = m.estimateNumber
        ? await prisma.estimate.findFirst({ where: { estimateNumber: String(m.estimateNumber) }, select: { estimateId: true, estimateNumber: true, status: true, assignedTelecallerId: true } })
        : await prisma.estimate.findUnique({ where: { estimateId: String(m.estimateId) }, select: { estimateId: true, estimateNumber: true, status: true, assignedTelecallerId: true } });
      if (!est) { errors.push({ ident, error: 'estimate not found' }); continue; }
      if (est.status !== 'sent') { skipped.push({ estimateNumber: est.estimateNumber, status: est.status, reason: 'not sent — left untouched' }); continue; }
      const tc = await prisma.telecaller.findUnique({ where: { id: String(m.telecallerId) }, select: { id: true, name: true, deleted: true } });
      if (!tc || tc.deleted) { errors.push({ estimateNumber: est.estimateNumber, error: 'target telecaller not found/deleted' }); continue; }
      if (est.assignedTelecallerId === tc.id) { skipped.push({ estimateNumber: est.estimateNumber, reason: `already with ${tc.name}` }); continue; }
      plan.push({ estimateId: est.estimateId, estimateNumber: est.estimateNumber, from: est.assignedTelecallerId, to: tc.id });
    }

    // Phase 1: resolve open ledger rows for everything being moved (history chain).
    const openByEstimate = new Map<string, string>();
    if (plan.length > 0) {
      const ids = plan.map((p) => p.estimateId);
      for (let i = 0; i < ids.length; i += 400) {
        const rows = await prisma.estimateAssignment.findMany({
          where: { estimateId: { in: ids.slice(i, i + 400) }, status: 'assigned' },
          select: { id: true, estimateId: true },
        });
        for (const r of rows) openByEstimate.set(r.estimateId, r.id);
      }
    }

    // Phase 2: batched writes (same chunked pattern as the absentee-cover engine).
    const nowIso = new Date().toISOString();
    const day = kolkataDateStr();
    const stmts: { sql: string; params: any[] }[] = [];
    for (const p of plan) {
      const priorOpenId = openByEstimate.get(p.estimateId) ?? null;
      stmts.push({ sql: 'UPDATE Estimate SET assignedTelecallerId = ? WHERE estimateId = ?', params: [p.to, p.estimateId] });
      if (priorOpenId) stmts.push({ sql: `UPDATE EstimateAssignment SET status = ? WHERE id = ?`, params: ['resolved', priorOpenId] });
      stmts.push({
        sql: 'INSERT INTO EstimateAssignment (id, estimateId, telecallerId, assignedAt, day, reassignedFromId, status, snatchReason, tempForTelecallerId) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        params: [crypto.randomUUID(), p.estimateId, p.to, nowIso, day, priorOpenId, 'assigned', reason, null],
      });
    }
    try {
      for (let i = 0; i < stmts.length; i += 25) {
        await (prisma as any).batch(stmts.slice(i, i + 25));
      }
      for (const p of plan) moved.push({ estimateNumber: p.estimateNumber, from: p.from, to: p.to });
    } catch (e: any) {
      // Fallback: sequential writes via the prisma API so the batch still lands.
      for (const p of plan) {
        try {
          await prisma.estimate.update({ where: { estimateId: p.estimateId }, data: { assignedTelecallerId: p.to } });
          await recordAssignment(p.estimateId, p.to, reason, null);
          moved.push({ estimateNumber: p.estimateNumber, from: p.from, to: p.to, via: 'sequential-fallback' });
        } catch (e2: any) {
          errors.push({ estimateNumber: p.estimateNumber, error: e2?.message || String(e2) });
        }
      }
    }

    // Phase 3: follow-up specialist flags (e.g. Samarjeet back to conversion).
    const flagsUpdated: string[] = [];
    for (const id of followUpAgents) {
      try {
        await prisma.telecaller.update({ where: { id: String(id) }, data: { assignEstimateFollowUps: true } });
        flagsUpdated.push(String(id));
      } catch (e: any) {
        errors.push({ telecallerId: id, error: e?.message || String(e) });
      }
    }

    try { await invalidateRiskCache(); } catch { /* non-fatal */ }
    if (moved.length > 0 || flagsUpdated.length > 0) notifyLive(c, { type: 'telecalling' });
    return c.json({ ok: errors.length === 0, moved, movedCount: moved.length, skipped, flagsUpdated, errors });
  });
}