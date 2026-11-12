// modules/core/notify.ts — Phase 6a: work-queue → in-app notifications.
// Pull model: producers insert core_domain_event + core_notification rows
// (status QUEUED); the app reads them via GET /api/notifications and marks
// READ. No push in 6a, so quiet hours don't gate anything (the user pulls
// when awake; WhatsApp/push gating lands with those channels in 6b).
// Producers (all edge-triggered, never per-read spam):
//   - action opened → notify assignee
//   - action reassigned → notify the new assignee
//   - action overdue at sweep → notify assignee (alongside WOULD_ESCALATE)
//   - action completed by someone else → notify assignee
// This module NEVER throws. Dual-runtime safe (D1-null no-op off-Worker).
import { getD1Database } from '../../shared/prisma-d1';
import { logger } from '../../shared/logger';

export interface NotifyItem {
  employeeId: string;
  title: string;
  body?: string;
  entityType?: string;
  entityId?: string;
  actionId?: string;
}

function newId(): string {
  const g: any = globalThis as any;
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

export async function notifyUsers(items: NotifyItem[], actorId?: string | null): Promise<number> {
  try {
    const db = getD1Database();
    const clean = (items ?? []).filter((i) => i && String(i.employeeId ?? '').trim() && String(i.title ?? '').trim());
    if (!db || !clean.length) return 0;
    const now = new Date().toISOString();
    let n = 0;
    for (const i of clean) {
      const emp = String(i.employeeId).trim();
      const title = String(i.title).trim().slice(0, 200);
      const body = String(i.body ?? '').slice(0, 1000);
      const nid = newId();
      await db.prepare(
        `INSERT INTO "core_domain_event" ("eventType", "entityType", "entityId", "payload", "actorType", "actorId", "occurredAt") VALUES ('notification.queued', 'core_notification', ?, ?, 'EMPLOYEE', ?, ?)`,
      ).bind(nid, JSON.stringify({ employeeId: emp, title, channel: 'IN_APP' }), actorId ?? null, now).run();
      await db.prepare(
        `INSERT INTO "core_notification" ("id", "employeeId", "channel", "title", "body", "entityType", "entityId", "actionId", "status", "createdAt") VALUES (?, ?, 'IN_APP', ?, ?, ?, ?, ?, 'QUEUED', ?)`,
      ).bind(nid, emp, title, body, i.entityType ? String(i.entityType) : null,
        i.entityId ? String(i.entityId) : null, i.actionId ? String(i.actionId) : null, now).run();
      n++;
    }
    return n;
  } catch (e: any) {
    try {
      logger.warn({ err: e?.message }, 'notifyUsers failed (non-blocking)');
    } catch { /* never throw */ }
    return 0;
  }
}

/** Mark one notification READ (owner-only — callers check employeeId first). */
export async function markNotificationRead(id: string): Promise<boolean> {  try {
    const db = getD1Database();
    if (!db || !id) return false;
    const res = await db.prepare(
      `UPDATE "core_notification" SET "status" = 'READ', "sentAt" = ? WHERE "id" = ? AND "status" = 'QUEUED'`,
    ).bind(new Date().toISOString(), String(id)).run();
    return (Number((res as any)?.meta?.changes ?? 0) || 0) > 0;
  } catch {
    return false;
  }
}

/**
 * Shadow heartbeat: one row per shadow per IST day proving the compare RAN
 * (quiet runs otherwise leave no trace, making "zero DIFFs" indistinguishable
 * from "never ran"). Flip gates read these: N days of heartbeats + zero DIFFs
 * = a quiet week. Idempotent (INSERT OR IGNORE on a deterministic id).
 */
export async function shadowHeartbeat(key: string): Promise<void> {
  try {
    const db = getD1Database();
    if (!db || !key) return;
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    const now = new Date().toISOString();
    await db.prepare(
      `INSERT OR IGNORE INTO "core_system_job" ("id", "key", "status", "startedAt", "finishedAt", "detail") VALUES (?, 'shadow-heartbeat', 'OK', ?, ?, ?)`,
    ).bind(`hb:${key}:${day}`, now, now, JSON.stringify({ shadow: key, day })).run();
  } catch { /* never throw */ }
}
