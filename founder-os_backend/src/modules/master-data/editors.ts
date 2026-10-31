// editors.ts — "who may edit the customer master", appointed by the sales-head.
//
// The founder's rule: master edits belong to specific people the sales-head
// appoints — not to every dashboard viewer. The appointment is a DIRECT user
// scope (`master-data-edit`) rather than a role, so granting it can never leak
// another dashboard, the admin panel, or role management. Sales-head / MIS /
// root always hold the capability implicitly (they run sales).
import type { AuthStore } from '../auth/store';
import type { MeResponse } from '../auth/types';
import { ensureScopesSeeded, invalidateAllSessionCaches } from '../auth/service';
import { AuthError } from '../auth/types';
import { masterDb, insertAudit } from './store';

export const MASTER_EDIT_SCOPE = 'master-data-edit';

export interface EditorEntry {
  userId: string;
  name: string;
  email: string;
  picture: string | null;
  isRoot: boolean;
  /** Holds the direct edit scope (appointed). */
  canEdit: boolean;
  /** Holds it implicitly (sales-head / MIS / root) — not revocable here. */
  implicit: boolean;
  appointedBy: string;
  appointedAt: string;
}

function heldScopes(me: MeResponse | null): Set<string> {
  return new Set(((me?.scopes ?? []) as string[]).map((s) => String(s).toLowerCase()));
}

/** Sales-head / MIS / root — the people who appoint editors and may edit
 *  region ownership themselves. */
export function isMasterManager(me: MeResponse | null): boolean {
  if (!me) return false;
  if (me.isAdmin) return true;
  const held = heldScopes(me);
  return held.has('sales-head') || held.has('mis');
}

/** Appointed editor: the direct scope, or implicit manager authority. */
export function canEditMaster(me: MeResponse | null): boolean {
  if (!me) return false;
  return isMasterManager(me) || heldScopes(me).has(MASTER_EDIT_SCOPE);
}

/** Can this viewer open the master at all? (Dashboard grant, the sales board it
 *  is embedded in, or sales leadership.) */
export function canViewMaster(me: MeResponse | null): boolean {
  if (!me) return false;
  if (isMasterManager(me)) return true;
  const held = heldScopes(me);
  return held.has('master-data') || held.has('enquiry-tracker');
}

/** Latest grant/revoke per user, for the panel's "appointed by" line. */
async function appointmentTrail(): Promise<Map<string, { actor: string; at: string; action: string }>> {
  const db = masterDb();
  const out = new Map<string, { actor: string; at: string; action: string }>();
  if (!db) return out;
  try {
    const res = await db
      .prepare(
        `SELECT entityId, actorName, action, createdAt FROM MasterDataAudit
          WHERE action IN ('editor-grant', 'editor-revoke')
          ORDER BY createdAt DESC LIMIT 500`,
      )
      .all();
    for (const row of (res?.results ?? []) as any[]) {
      const id = String(row.entityId ?? '');
      if (id && !out.has(id)) out.set(id, { actor: String(row.actorName ?? ''), at: String(row.createdAt ?? ''), action: String(row.action ?? '') });
    }
  } catch {
    // Audit table missing (fresh DB) — the panel simply shows no trail.
  }
  return out;
}

/** Approved users + whether they may edit. No role keys or scope catalogue is
 *  exposed — only what the appointment panel needs. */
export async function listEditors(store: AuthStore): Promise<EditorEntry[]> {
  await ensureScopesSeeded(store);
  const [users, trail] = await Promise.all([store.listUsers(), appointmentTrail()]);
  return users
    .filter((u: any) => !!u && !(u as any).deleted)
    .filter((u: any) => (u.scopes ?? []).length > 0 || (u.roles ?? []).length > 0 || u.isRoot)
    .map((u: any) => {
      const scopes = new Set(((u.scopes ?? []) as string[]).map((s) => String(s).toLowerCase()));
      const roles = new Set(((u.roles ?? []) as string[]).map((s) => String(s).toLowerCase()));
      const implicit = !!u.isRoot || roles.has('sales-head') || roles.has('mis') || scopes.has('admin');
      const last = trail.get(String(u.id));
      return {
        userId: String(u.id),
        name: String(u.name ?? ''),
        email: String(u.email ?? ''),
        picture: u.picture ?? null,
        isRoot: !!u.isRoot,
        canEdit: scopes.has(MASTER_EDIT_SCOPE) || implicit,
        implicit,
        appointedBy: last?.action === 'editor-grant' ? last.actor : '',
        appointedAt: last?.action === 'editor-grant' ? last.at : '',
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Grant or revoke the direct edit scope for ONE user. Never touches roles,
 *  never grants anything else, refuses the root account. */
export async function setEditor(
  store: AuthStore,
  userId: string,
  canEdit: boolean,
  actor: { id: string; name: string },
): Promise<EditorEntry> {
  await ensureScopesSeeded(store);
  const users = await store.listUsers();
  const target: any = users.find((u: any) => String(u.id) === String(userId));
  if (!target) throw new AuthError('FORBIDDEN', 'user not found', 404);
  if (target.isRoot) throw new AuthError('FORBIDDEN', 'the root account always has edit access', 400);
  const current = new Set(((target.scopes ?? []) as string[]).map((s) => String(s).toLowerCase()));
  const roles = new Set(((target.roles ?? []) as string[]).map((s) => String(s).toLowerCase()));
  if (roles.has('sales-head') || roles.has('mis')) {
    throw new AuthError('FORBIDDEN', 'this user already edits through the sales-head / MIS role', 400);
  }
  if (canEdit) current.add(MASTER_EDIT_SCOPE);
  else current.delete(MASTER_EDIT_SCOPE);
  await store.setUserScopes(String(target.id), [...current]);
  invalidateAllSessionCaches();
  await insertAudit({
    actorId: actor.id,
    actorName: actor.name,
    action: canEdit ? 'editor-grant' : 'editor-revoke',
    entityId: String(target.id),
    detail: { name: target.name, email: target.email },
  });
  return {
    userId: String(target.id),
    name: String(target.name ?? ''),
    email: String(target.email ?? ''),
    picture: target.picture ?? null,
    isRoot: !!target.isRoot,
    canEdit,
    implicit: false,
    appointedBy: canEdit ? actor.name : '',
    appointedAt: canEdit ? new Date().toISOString() : '',
  };
}
