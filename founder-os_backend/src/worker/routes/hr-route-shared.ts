// routes/hr-route-shared.ts — one auth/error guard for every HR route module.
import { ScopeKeys } from "../../modules/auth/types";
import { requireViewer } from "../viewer";
import { writeError } from "../http";

export function actorLabel(me: any): string | null {
  return me?.user?.name ?? me?.user?.email ?? null;
}

export async function access(c: any) {
  const me = await requireViewer(c).catch(() => null);
  if (!me) return { me: null, canManage: false, error: c.json({ error: "Authentication required" }, 401) };
  const scopes = (me.scopes ?? []) as string[];
  const root = !!me.isRoot;
  if (!root && !me.isAdmin && !scopes.includes(ScopeKeys.HumanResources)) {
    return { me, canManage: false, error: c.json({ error: "Requires 'human-resources' permission" }, 403) };
  }
  return {
    me,
    canManage: root || !!me.isAdmin || scopes.includes("human-resources"),
    error: null,
  };
}

export function errorResponse(c: any, e: unknown) {
  return writeError(c, e, "request failed");
}
