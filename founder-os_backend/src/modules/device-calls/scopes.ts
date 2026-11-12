// ── Device + manager auth guards for the call-log routes ────────────────────
import { getMe, isApproved, readSessionCookie, requireAdminScope, authStore } from '../../worker/context';
import { hashToken } from './tokens';
import type { DeviceRow } from './types';

interface DeviceAuth {
  device: DeviceRow;
  telecallerId: string;
}

/** Bearer device token → active registration. Fail-closed. */
export async function requireDevice(c: any): Promise<DeviceAuth | null> {
  const header = c.req.header('Authorization') || '';
  const token = header.replace(/^Bearer\s+/i, '').trim();
  if (!token.startsWith('fc_')) return null;
  const hash = await hashToken(token);
  const row: any = await c.env.DB.prepare(
    `SELECT * FROM DeviceRegistration WHERE tokenHash = ? AND status = 'active' LIMIT 1`,
  ).bind(hash).first();
  if (!row) return null;
  return { device: row as DeviceRow, telecallerId: String(row.telecallerId) };
}

export interface CallViewer {
  isManager: boolean;
  telecallerId: string | null;
  name: string;
}

/** Session viewer for the dashboard. Agents are resolved to their roster row. */
export async function callViewer(c: any): Promise<CallViewer | null> {
  const me: any = await getMe(authStore(c), readSessionCookie(c.req.header('cookie') ?? null)).catch(() => null);
  if (!me || !isApproved(me)) return null;
  const scopes: string[] = (me.scopes ?? []).map((s: string) => String(s).toLowerCase());
  const roles: string[] = (me.roles ?? []).map((s: string) => String(s).toLowerCase());
  const isManager =
    !!me.isAdmin ||
    !!me.isRoot ||
    scopes.includes('sales-head') ||
    roles.includes('sales-head');

  if (isManager) {
    return { isManager: true, telecallerId: null, name: String(me.user?.name ?? me.user?.email ?? '') };
  }
  if (!scopes.includes('telecalling') && !scopes.includes('sales')) return null;

  const { resolveSelfTelecaller } = await import('../../worker/routes/automations');
  const selfId = await resolveSelfTelecaller(c).catch(() => null);
  if (!selfId) return null;
  return { isManager: false, telecallerId: selfId, name: String(me.user?.name ?? '') };
}

/** Manager-only guard (sales-head / root). */
export async function requireCallManager(c: any): Promise<boolean> {
  try {
    await requireAdminScope(c);
    return true;
  } catch {
    /* fall through to the role check */
  }
  const viewer = await callViewer(c).catch(() => null);
  return !!viewer?.isManager;
}
