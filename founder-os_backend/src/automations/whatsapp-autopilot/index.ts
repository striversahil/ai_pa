/**
 * WhatsApp Business Autopilot — read side.
 *
 * The core loop (association → state transition → proposed actions) runs on
 * the GH Actions runner scripts/whatsapp-autopilot-runner.js, which uses the
 * /api/runner/autopilot/* endpoints in worker.ts. This module only serves the
 * dashboard: stats, review queue, proposed actions, recent history.
 *
 *   handler(): no-op — heavy work lives on the runner (shadow mode: nothing
 *              is ever sent; every action row stays pending).
 *   data():    GET /api/automations/whatsapp-autopilot/data
 */
import { prisma } from '../../shared/prisma';
import type { AutomationContext } from '../../modules/automation/types';

export async function handler(ctx: AutomationContext): Promise<void> {
  ctx.log('info', 'whatsapp-autopilot: loop is driven by GH Actions runner; nothing to execute here');
}

const OPEN_STATUSES = ['open', 'waiting', 'needs_clarification', 'needs_review'];

function parseJsonSafe(value: string | null | undefined): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export async function data(ctx: AutomationContext): Promise<any> {
  const q = ctx.subject ?? {};
  const reviewLimit = Math.min(Number(q.reviewLimit) || 50, 200);
  const historyLimit = Math.min(Number(q.historyLimit) || 40, 200);

  const [statusGroups, typeGroups, reviewTasks, proposedActions, recentHistory, overrideCount, lastRun] =
    await Promise.all([
      prisma.waTask.groupBy({ by: ['status'], _count: { status: true } }),
      prisma.waTask.groupBy({ by: ['taskType'], where: { status: { in: OPEN_STATUSES } }, _count: { taskType: true } }),
      prisma.waTask.findMany({
        where: { status: 'needs_review' },
        orderBy: { updatedAt: 'desc' },
        take: reviewLimit,
        include: {
          history: { orderBy: { occurredAt: 'desc' }, take: 3 },
          actions: { orderBy: { createdAt: 'desc' } },
        },
      }),
      prisma.waAction.findMany({
        where: { status: 'pending' },
        orderBy: { createdAt: 'desc' },
        take: reviewLimit,
        include: { task: { select: { id: true, chatId: true, chatName: true, item: true, status: true, taskType: true } } },
      }),
      prisma.waTaskHistory.findMany({
        orderBy: { occurredAt: 'desc' },
        take: historyLimit,
        include: { task: { select: { id: true, chatName: true, item: true, status: true, taskType: true } } },
      }),
      prisma.overrideLog.count(),
      lastEngineActivity(),
    ]);

  const stats: Record<string, number> = {};
  for (const g of statusGroups) stats[g.status] = g._count.status;
  const totalOpen = OPEN_STATUSES.reduce((sum, s) => sum + (stats[s] || 0), 0);

  return {
    meta: {
      analysis: 'whatsapp-autopilot',
      title: 'WhatsApp Business Autopilot',
      phase: '0 — shadow mode',
      generatedAt: new Date().toISOString(),
      lastEngineActivity: lastRun?.occurredAt ?? null,
    },
    stats: {
      ...stats,
      openTotal: totalOpen,
      completed: stats.completed || 0,
      cancelled: stats.cancelled || 0,
    },
    byType: typeGroups.map((g) => ({ taskType: g.taskType, count: g._count.taskType })),
    reviewQueue: reviewTasks.map((t: any) => ({
      id: t.id,
      chatId: t.chatId,
      chatName: t.chatName,
      taskType: t.taskType,
      item: t.item,
      status: t.status,
      summary: t.summary,
      version: t.version,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      latestReason: t.history?.[0]?.notes ?? null,
      latestTransition: t.history?.[0]?.transition ?? null,
      latestConfidence: t.history?.[0]?.confidence ?? null,
      actions: (t.actions ?? []).map((a: any) => ({
        id: a.id,
        toolName: a.toolName,
        input: parseJsonSafe(a.inputJson),
        status: a.status,
        reason: a.reason,
        createdAt: a.createdAt,
      })),
    })),
    proposedActions: proposedActions.map((a: any) => ({
      id: a.id,
      toolName: a.toolName,
      input: parseJsonSafe(a.inputJson),
      status: a.status,
      reason: a.reason,
      requestedBy: a.requestedBy,
      createdAt: a.createdAt,
      taskId: a.taskId,
      task: a.task,
    })),
    recentHistory: recentHistory.map((h: any) => ({
      id: h.id,
      transition: h.transition,
      triggeredBy: h.triggeredBy,
      notes: h.notes,
      confidence: h.confidence,
      messageId: h.messageId,
      occurredAt: h.occurredAt,
      task: h.task,
    })),
    overrides: overrideCount,
  };
}

async function lastEngineActivity(): Promise<{ occurredAt: Date } | null> {
  return prisma.waTaskHistory.findFirst({ orderBy: { occurredAt: 'desc' }, select: { occurredAt: true } });
}
