// ─────────────────────────────────────────────────────────────────────────────
// routes/autopilot.ts — whatsapp-autopilot runner endpoints (GH Actions heavy
// loop) + the human review API (dashboard, session-gated).
// ─────────────────────────────────────────────────────────────────────────────
import type { Hono } from 'hono';
import { deps, requireSecret, broadcastLive, LiveEvent, type Bindings } from '../context';

const AUTOPILOT_TASK_STATUSES = ['open', 'waiting', 'needs_clarification', 'needs_review', 'completed', 'cancelled'];
const AUTOPILOT_OPEN_STATUSES = ['open', 'waiting', 'needs_clarification', 'needs_review'];
// §4.10 create-dedupe window: an identical (chat, item) open task created this
// recently means two lanes raced on the same request — treat as Update instead.
const AUTOPILOT_CREATE_DEDUPE_MS = 120_000;

function autopilotTaskJson(t: any) {
  return {
    id: t.id, chatId: t.chatId, chatName: t.chatName, taskType: t.taskType,
    item: t.item, status: t.status, priority: t.priority, assignedTo: t.assignedTo,
    rootMessageId: t.rootMessageId, summary: t.summary, version: t.version,
    lastInboundAt: t.lastInboundAt, lastOutboundAt: t.lastOutboundAt,
    waitingSince: t.waitingSince, waitTimeoutAt: t.waitTimeoutAt,
    followUpDueAt: t.followUpDueAt, followUpCount: t.followUpCount,
    createdAt: t.createdAt, updatedAt: t.updatedAt,
  };
}

export function registerAutopilotRoutes(app: Hono<{ Bindings: Bindings }>): void {
  app.get('/api/runner/autopilot/inbox', async (c) => {
    if (!requireSecret(c)) return c.text('Unauthorized', 401);
    const { prisma } = deps();
    const contextMessages = Math.min(Number(c.req.query('context')) || 15, 50);
    const sinceRaw = c.req.query('since');
    const since = sinceRaw ? new Date(sinceRaw) : null;
    const [messages, tasks] = await Promise.all([
      prisma.message.findMany({
        where: since && !isNaN(since.getTime()) ? { timestamp: { gt: since } } : {},
        orderBy: { timestamp: 'asc' },
        take: 200,
      }),
      prisma.waTask.findMany({
        where: { status: { in: AUTOPILOT_OPEN_STATUSES } },
        orderBy: { updatedAt: 'desc' },
        take: 500,
      }),
    ]);
    const chatIdSet = new Set<string>();
    for (const m of messages as any[]) chatIdSet.add(String(m.chatId));
    const chatIds = [...chatIdSet];
    const recentByChat: Record<string, any[]> = {};
    await Promise.all(chatIds.map(async (chatId) => {
      const rows = await prisma.message.findMany({
        where: { chatId },
        orderBy: { timestamp: 'desc' },
        take: contextMessages,
      });
      recentByChat[chatId] = rows.reverse().map((m: any) => ({
        sender: m.sender, body: m.body, timestamp: m.timestamp,
      }));
    }));
    return c.json({
      messages: messages.map((m: any) => ({
        id: m.id, chatId: m.chatId, sender: m.sender, body: m.body,
        timestamp: m.timestamp instanceof Date ? m.timestamp.toISOString() : m.timestamp,
        wahaMessageId: m.wahaMessageId, quotedMessageId: m.quotedMessageId,
        quotedBody: m.quotedBody, classification: m.classification,
      })),
      tasks: tasks.map(autopilotTaskJson),
      recentByChat,
    });
  });

  app.get('/api/runner/autopilot/lineage-lookup', async (c) => {
    if (!requireSecret(c)) return c.text('Unauthorized', 401);
    const { prisma } = deps();
    const ids = (c.req.query('ids') || '').split(',').map((s: string) => s.trim()).filter(Boolean).slice(0, 100);
    if (!ids.length) return c.json({ byId: {} });
    const rows = await prisma.messageLineage.findMany({ where: { waMessageId: { in: ids } } });
    const byId: Record<string, unknown> = {};
    for (const r of rows) {
      byId[r.waMessageId] = { taskId: r.taskId, rootWaMessageId: r.rootWaMessageId, resolutionStatus: r.resolutionStatus };
    }
    return c.json({ byId });
  });

  app.post('/api/runner/autopilot/lineage', async (c) => {
    if (!requireSecret(c)) return c.text('Unauthorized', 401);
    const { prisma } = deps();
    const body = await c.req.json().catch(() => ({}));
    const rows = Array.isArray(body.rows) ? body.rows : [];
    let upserted = 0;
    for (const r of rows) {
      if (!r.waMessageId) continue;
      await prisma.messageLineage.upsert({
        where: { waMessageId: String(r.waMessageId) },
        update: {
          parentWaMessageId: r.parentWaMessageId ?? null,
          rootWaMessageId: r.rootWaMessageId ?? null,
          taskId: r.taskId ?? null,
          associationMethod: r.associationMethod || 'llm',
          confidence: typeof r.confidence === 'number' ? r.confidence : null,
          resolutionStatus: r.resolutionStatus || 'resolved',
        },
        create: {
          waMessageId: String(r.waMessageId),
          parentWaMessageId: r.parentWaMessageId ?? null,
          rootWaMessageId: r.rootWaMessageId ?? null,
          taskId: r.taskId ?? null,
          associationMethod: r.associationMethod || 'llm',
          confidence: typeof r.confidence === 'number' ? r.confidence : null,
          resolutionStatus: r.resolutionStatus || 'resolved',
        },
      });
      upserted++;
    }
    return c.json({ ok: true, count: upserted });
  });

  app.get('/api/runner/autopilot/watermark', async (c) => {
    if (!requireSecret(c)) return c.text('Unauthorized', 401);
    const { prisma } = deps();
    const row = await prisma.setting.findUnique({ where: { key: 'autopilot:message_watermark' } });
    return c.json({ watermark: row?.value || null });
  });

  app.post('/api/runner/autopilot/watermark', async (c) => {
    if (!requireSecret(c)) return c.text('Unauthorized', 401);
    const { prisma } = deps();
    const body = await c.req.json().catch(() => ({}));
    if (!body.watermark) return c.json({ error: 'watermark required' }, 400);
    await prisma.setting.upsert({
      where: { key: 'autopilot:message_watermark' },
      update: { value: String(body.watermark) },
      create: { key: 'autopilot:message_watermark', value: String(body.watermark) },
    });
    return c.json({ ok: true });
  });

  app.post('/api/runner/autopilot/tasks/create', async (c) => {
    if (!requireSecret(c)) return c.text('Unauthorized', 401);
    const { prisma } = deps();
    const body = await c.req.json().catch(() => ({}));
    if (!body.chatId) return c.json({ error: 'chatId required' }, 400);
    const item = body.item ? String(body.item) : null;
    if (item) {
      const cutoff = new Date(Date.now() - AUTOPILOT_CREATE_DEDUPE_MS);
      const dupe = await prisma.waTask.findFirst({
        where: { chatId: body.chatId, item, status: { in: ['open', 'waiting'] }, createdAt: { gte: cutoff } },
        orderBy: { createdAt: 'desc' },
      });
      if (dupe) return c.json({ ok: true, deduped: true, task: autopilotTaskJson(dupe) });
    }
    const now = new Date();
    const task = await prisma.waTask.create({
      data: {
        chatId: String(body.chatId),
        chatName: body.chatName ? String(body.chatName) : String(body.chatId),
        taskType: body.taskType ? String(body.taskType) : 'general',
        item,
        status: 'open',
        priority: body.priority ? String(body.priority) : null,
        summary: body.summary ? String(body.summary) : null,
        rootMessageId: body.rootWaMessageId ? String(body.rootWaMessageId) : null,
        version: 1,
        lastInboundAt: now,
      },
    });
    await prisma.waTaskHistory.create({
      data: {
        taskId: task.id,
        transition: 'create',
        triggeredBy: body.triggeredBy || 'llm',
        messageId: body.wahaMessageId ? String(body.wahaMessageId) : null,
        notes: body.notes ? String(body.notes) : null,
        confidence: typeof body.confidence === 'number' ? body.confidence : null,
        occurredAt: new Date(),
      },
    });
    broadcastLive(c, LiveEvent.Autopilot, { chatId: task.chatId });
    return c.json({ ok: true, task: autopilotTaskJson(task) });
  });

  app.post('/api/runner/autopilot/tasks/transition', async (c) => {
    if (!requireSecret(c)) return c.text('Unauthorized', 401);
    const { prisma } = deps();
    const body = await c.req.json().catch(() => ({}));
    const { taskId, expectedVersion, transition } = body;
    if (!taskId || !transition || typeof expectedVersion !== 'number') {
      return c.json({ error: 'taskId + expectedVersion + transition required' }, 400);
    }
    if (!AUTOPILOT_TASK_STATUSES.includes(String(body.status || '')) && !['update', 'action'].includes(String(transition))) {
      return c.json({ error: `invalid status '${body.status}'` }, 400);
    }
    const data: Record<string, unknown> = { version: expectedVersion + 1 };
    if (body.status) data.status = String(body.status);
    if (body.item !== undefined) data.item = body.item ? String(body.item) : null;
    if (body.summary !== undefined) data.summary = body.summary ? String(body.summary) : null;
    if (body.priority !== undefined) data.priority = body.priority ? String(body.priority) : null;
    if (body.waitingSince !== undefined) data.waitingSince = body.waitingSince ? new Date(body.waitingSince) : null;
    if (body.waitTimeoutAt !== undefined) data.waitTimeoutAt = body.waitTimeoutAt ? new Date(body.waitTimeoutAt) : null;
    if (body.followUpDueAt !== undefined) data.followUpDueAt = body.followUpDueAt ? new Date(body.followUpDueAt) : null;
    if (body.clearFollowUp) { data.followUpDueAt = null; }
    if (body.inboundAt) data.lastInboundAt = new Date(body.inboundAt);
    if (body.outboundAt) data.lastOutboundAt = new Date(body.outboundAt);
    const res = await prisma.waTask.updateMany({
      where: { id: String(taskId), version: expectedVersion },
      data,
    });
    if (res.count === 0) {
      const fresh = await prisma.waTask.findUnique({ where: { id: String(taskId) } });
      return c.json(
        { error: 'version_conflict', message: 'task changed underneath — re-run against fresh state', task: fresh ? autopilotTaskJson(fresh) : null },
        409,
      );
    }
    await prisma.waTaskHistory.create({
      data: {
        taskId: String(taskId),
        transition: String(transition),
        triggeredBy: body.triggeredBy || 'llm',
        messageId: body.wahaMessageId ? String(body.wahaMessageId) : null,
        notes: body.notes ? String(body.notes) : null,
        confidence: typeof body.confidence === 'number' ? body.confidence : null,
        occurredAt: new Date(),
      },
    });
    const updated = await prisma.waTask.findUnique({ where: { id: String(taskId) } });
    broadcastLive(c, LiveEvent.Autopilot, { taskId: String(taskId), transition: String(transition) });
    return c.json({ ok: true, task: updated ? autopilotTaskJson(updated) : null });
  });

  app.post('/api/runner/autopilot/actions', async (c) => {
    if (!requireSecret(c)) return c.text('Unauthorized', 401);
    const { prisma } = deps();
    const body = await c.req.json().catch(() => ({}));
    const actions = Array.isArray(body.actions) ? body.actions : [];
    let created = 0;
    for (const a of actions) {
      if (!a.toolName) continue;
      await prisma.waAction.create({
        data: {
          taskId: a.taskId ? String(a.taskId) : null,
          toolName: String(a.toolName),
          inputJson: a.input !== undefined ? JSON.stringify(a.input) : (typeof a.inputJson === 'string' ? a.inputJson : null),
          status: 'pending',
          requestedBy: a.requestedBy || 'llm',
          reason: a.reason ? String(a.reason) : null,
        },
      });
      created++;
    }
    if (created > 0) broadcastLive(c, LiveEvent.Autopilot, { actions: created });
    return c.json({ ok: true, count: created });
  });

  app.get('/api/runner/autopilot/followups', async (c) => {
    if (!requireSecret(c)) return c.text('Unauthorized', 401);
    const { prisma } = deps();
    const now = new Date();
    const silenceDays = Math.min(Number(c.req.query('autoCloseDays')) || 7, 30);
    const autoCloseCutoff = new Date(now.getTime() - silenceDays * 24 * 60 * 60 * 1000);
    const [dueFollowUps, waitTimeouts, staleOpen] = await Promise.all([
      prisma.waTask.findMany({
        where: { status: { in: ['open', 'waiting'] }, followUpDueAt: { lte: now } },
        orderBy: { followUpDueAt: 'asc' }, take: 100,
      }),
      prisma.waTask.findMany({
        where: { status: 'waiting', waitTimeoutAt: { lte: now } },
        orderBy: { waitTimeoutAt: 'asc' }, take: 100,
      }),
      prisma.waTask.findMany({
        where: { status: { in: AUTOPILOT_OPEN_STATUSES }, lastInboundAt: { lt: autoCloseCutoff }, createdAt: { lt: autoCloseCutoff } },
        orderBy: { createdAt: 'asc' }, take: 100,
      }),
    ]);
    return c.json({
      dueFollowUps: dueFollowUps.map(autopilotTaskJson),
      waitTimeouts: waitTimeouts.map(autopilotTaskJson),
      autoCloses: staleOpen.map(autopilotTaskJson),
    });
  });

  app.post('/api/runner/autopilot/sync-contacts', async (c) => {
    if (!requireSecret(c)) return c.text('Unauthorized', 401);
    const { prisma } = deps();
    const env = c.env as { WA_ENGINE_API_KEY?: string };
    if (!env.WA_ENGINE_API_KEY) return c.json({ error: 'WA_ENGINE_API_KEY not configured' }, 500);
    const placeholders = new Set(['', 'Client']);
    let scanned = 0;
    let updated = 0;
    for (let page = 1; page <= 20; page++) {
      let convs: any[];
      try {
        const res = await fetch(`https://waengine.pro/api/v1/conversations?page=${page}&limit=100`, {
          headers: { 'X-API-Key': env.WA_ENGINE_API_KEY },
          signal: AbortSignal.timeout(15000),
        });
        if (!res.ok) break;
        const json: any = await res.json();
        convs = Array.isArray(json?.data) ? json.data : [];
      } catch {
        break;
      }
      if (!convs.length) break;
      for (const conv of convs) {
        const phone = String(conv?.contact?.phone || '').replace(/\D/g, '');
        const name = String(conv?.contact?.name || '').trim();
        if (!phone || !name || placeholders.has(name)) continue;
        scanned++;
        try {
          const r = await (prisma as any).contact.updateMany({
            where: { chatId: `${phone}@c.us`, name: { in: ['Client', ''] } },
            data: { name },
          });
          updated += Number(r?.count) || 0;
        } catch { /* skip bad row */ }
      }
      if (convs.length < 100) break;
    }
    return c.json({ ok: true, scanned, updated });
  });

  // ── whatsapp-autopilot human review API (dashboard, session-gated) ───────────
  app.post('/api/autopilot/tasks/:id/review', async (c) => {
    const { prisma } = deps();
    const taskId = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));
    const resolution = String(body.resolution || '');
    const VALID = ['open', 'waiting', 'needs_clarification', 'completed', 'cancelled'];
    if (!VALID.includes(resolution)) return c.json({ error: `resolution must be one of ${VALID.join('|')}` }, 400);
    const task = await prisma.waTask.findUnique({ where: { id: taskId } });
    if (!task) return c.json({ error: 'task not found' }, 404);
    const reviewer = body.reviewer || 'founder';
    const res = await prisma.waTask.updateMany({
      where: { id: taskId, version: task.version },
      data: { version: task.version + 1, status: resolution },
    });
    if (res.count === 0) return c.json({ error: 'version_conflict' }, 409);
    const wasAuto = task.status === 'needs_review';
    await prisma.waTaskHistory.create({
      data: {
        taskId,
        transition: resolution === 'completed' ? 'complete' : 'update',
        triggeredBy: 'human',
        notes: `[review:${resolution}] ${body.notes || ''}`.trim(),
        occurredAt: new Date(),
      },
    });
    if (wasAuto) {
      await prisma.overrideLog.create({
        data: {
          taskId,
          decisionType: 'transition',
          systemDecision: `review:${task.status}`,
          systemConfidence: null,
          humanDecision: resolution,
          reviewer,
        },
      });
    }
    broadcastLive(c, LiveEvent.Autopilot, { taskId, review: resolution });
    return c.json({ ok: true });
  });

  app.post('/api/autopilot/actions/:id/decide', async (c) => {
    const { prisma } = deps();
    const actionId = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));
    const decision = String(body.decision || '');
    const VALID = ['approve', 'reject', 'execute_manual'];
    if (!VALID.includes(decision)) return c.json({ error: `decision must be one of ${VALID.join('|')}` }, 400);
    const action = await prisma.waAction.findUnique({ where: { id: actionId } });
    if (!action) return c.json({ error: 'action not found' }, 404);
    const statusMap: Record<string, string> = { approve: 'approved', reject: 'rejected', execute_manual: 'executed_manual' };
    await prisma.waAction.update({
      where: { id: actionId },
      data: {
        status: statusMap[decision],
        executedAt: decision === 'execute_manual' ? new Date() : null,
        outputJson: body.notes ? JSON.stringify({ notes: body.notes }) : action.outputJson,
      },
    });
    if (action.taskId) {
      await prisma.waTaskHistory.create({
        data: {
          taskId: action.taskId,
          transition: 'action',
          triggeredBy: 'human',
          notes: `[${decision}] ${action.toolName}${body.notes ? `: ${body.notes}` : ''}`.trim(),
          occurredAt: new Date(),
        },
      });
    }
    broadcastLive(c, LiveEvent.Autopilot, { actionId, decision });
    return c.json({ ok: true });
  });
}