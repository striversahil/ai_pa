"use client";

import React, { useEffect, useMemo, useState, useCallback } from "react";
import { useAuth } from "@/auth/AuthContext";
import { USER_ADMIN_SCOPE } from "@/auth/permissions";
import AdminTable from "./admin/AdminTable";
import { Drawer, UserDrawer, RoleDrawer } from "./admin/AdminDrawers";
import type { ScopeRow, RoleRow, UserRow, DashboardRow } from "./admin/AdminDrawers";

type Tab = "users" | "roles" | "scopes";

function fmtDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  if (!m) return "—";
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

export default function UserAdmin() {
  const { me, refresh } = useAuth();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [scopes, setScopes] = useState<ScopeRow[]>([]);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [dashboards, setDashboards] = useState<DashboardRow[]>([]);
  const [userDrafts, setUserDrafts] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>("users");
  const [roleFilter, setRoleFilter] = useState("");
  const [managingId, setManagingId] = useState<string | null>(null);
  const [roleDrawer, setRoleDrawer] = useState<{ mode: "create" } | { mode: "edit"; role: RoleRow } | null>(null);

  const load = useCallback(async () => {
    const [u, s, r, d] = await Promise.all([
      fetch("/api/auth/users").then((res) => res.json()),
      fetch("/api/auth/scopes").then((res) => res.json()),
      fetch("/api/auth/roles").then((res) => res.json()),
      fetch("/api/automations").then((res) => res.json()),
    ]);
    const usersArr: UserRow[] = Array.isArray(u) ? u : [];
    setUsers(usersArr);
    setScopes(Array.isArray(s) ? s : []);
    setRoles(Array.isArray(r) ? r : []);
    setDashboards((Array.isArray(d) ? d : []).filter((x: any) => x.hasDashboard));
    const ud: Record<string, string[]> = {};
    for (const x of usersArr) ud[x.id] = x.roles;
    setUserDrafts(ud);
  }, []);

  useEffect(() => {
    if (me && (me.isRoot || me.scopes.includes(USER_ADMIN_SCOPE))) void load();
  }, [me, load]);
  const reload = useCallback(() => { void load(); void refresh(); }, [load, refresh]);

  const scopeLabel = useCallback((key: string) => scopes.find((s) => s.key === key)?.label || key, [scopes]);
  const isRoot = !!me?.isRoot;
  const canManage = isRoot || !!me?.scopes.includes(USER_ADMIN_SCOPE);
  const isAdminRole = (scopeKeys: string[]) => scopeKeys.map((s) => s.toLowerCase()).includes("admin");

  // One entry per distinct scope (from rule.json via /api/automations).
  const scopeGroups = useMemo(() => {
    const map = new Map<string, DashboardRow[]>();
    for (const d of dashboards) {
      const k = d.scope ?? d.slug;
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(d);
    }
    return [...map.entries()];
  }, [dashboards]);

  const roleUserCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const u of users) for (const rk of u.roles) m.set(rk, (m.get(rk) ?? 0) + 1);
    return m;
  }, [users]);

  const userScopes = useCallback((roleKeys: string[]) =>
    [...new Set(roleKeys.flatMap((rk) => roles.find((r) => r.key === rk)?.scopeKeys || []))],
    [roles]);

  const scopeStats = useMemo(() => {
    const rolesUsing = new Map<string, string[]>();
    for (const r of roles) for (const s of r.scopeKeys) {
      if (!rolesUsing.has(s)) rolesUsing.set(s, []);
      rolesUsing.get(s)!.push(r.key);
    }
    const usersCovered = new Map<string, number>();
    for (const u of users) for (const s of userScopes(u.roles)) usersCovered.set(s, (usersCovered.get(s) ?? 0) + 1);
    return { rolesUsing, usersCovered };
  }, [roles, users, userScopes]);

  const toggleDraft = (id: string, key: string) => {
    setUserDrafts((p) => {
      const cur = p[id] || [];
      return { ...p, [id]: cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key] };
    });
  };

  const saveUserRoles = async (userId: string) => {
    setBusy(true);
    try {
      await fetch(`/api/auth/users/${userId}/roles`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keys: userDrafts[userId] || [] }),
      });
      setManagingId(null);
    } finally {
      setBusy(false);
      reload();
    }
  };

  const saveRole = async (input: { key: string; label: string; description: string | null; scopeKeys: string[] }) => {
    setBusy(true);
    try {
      await fetch("/api/auth/roles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      setRoleDrawer(null);
    } finally {
      setBusy(false);
      reload();
    }
  };

  const delRole = async (key: string) => {
    if (!confirm(`Delete role "${key}"? Users with this role lose its dashboard access.`)) return;
    setBusy(true);
    try {
      await fetch(`/api/auth/roles/${key}`, { method: "DELETE" });
      setRoleDrawer(null);
    } finally {
      setBusy(false);
      reload();
    }
  };

  const managingUser = managingId ? users.find((u) => u.id === managingId) ?? null : null;
  const usersInRole = roleFilter ? users.filter((u) => (userDrafts[u.id] ?? u.roles).includes(roleFilter)) : users;

  if (!me || !canManage) return <div className="p-8 text-zinc-500">Admin access required.</div>;

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: "users", label: "Users", count: users.length },
    ...(isRoot ? [{ key: "roles" as Tab, label: "Roles", count: roles.length }] : []),
    { key: "scopes", label: "Scopes", count: scopes.length },
  ];

  return (
    <div className="space-y-5 text-zinc-900 dark:text-zinc-100 pb-12">
      <div>
        <h1 className="text-3xl font-bold font-heading">User & Permission Management</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {isRoot ? `Root: ${me.user.email}.` : `Signed in as ${me.user.email} (user manager).`} Assign roles to users; a role grants the automation dashboards you define for it.
          {!isRoot && " The root user and admin-level roles are root-only."}
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Users", value: users.length },
          { label: "Roles", value: roles.length },
          { label: "Scopes", value: scopes.length },
          { label: "Dashboards", value: dashboards.length },
        ].map((k) => (
          <div key={k.label} className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl p-3.5">
            <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">{k.label}</div>
            <div className="text-2xl font-extrabold mt-0.5">{k.value}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {tabs.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 rounded-xl text-sm font-bold cursor-pointer border-0 ${tab === t.key ? "bg-indigo-600 text-white" : "bg-zinc-100 dark:bg-zinc-900 text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-800"}`}>
            {t.label}
            <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[11px] ${tab === t.key ? "bg-white/25" : "bg-zinc-200 dark:bg-zinc-800"}`}>{t.count}</span>
          </button>
        ))}
      </div>

      {tab === "users" && (
        <section className="bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 sm:p-6">
          <AdminTable<UserRow>
            rows={usersInRole}
            rowKey={(u) => u.id}
            searchPlaceholder="Search name or email…"
            toSearchText={(u) => `${u.name} ${u.email}`}
            emptyText={users.length === 0 ? "No users yet — anyone with a Google account can sign up, then appears here." : "No users match."}
            onRowClick={(u) => setManagingId(u.id)}
            toolbarExtra={
              <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}
                title="Filter by role"
                className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-2.5 py-2 text-xs outline-none max-w-[160px]">
                <option value="">All roles</option>
                {roles.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
              </select>
            }
            columns={[
              {
                key: "user", header: "User",
                sortValue: (u) => u.name.toLowerCase(),
                render: (u) => (
                  <span className="flex items-center gap-2.5 min-w-0">
                    {u.picture
                      ? <img src={u.picture} alt="" className="h-8 w-8 rounded-full shrink-0" />
                      : <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-xs font-bold text-white">{(u.name || u.email || "U").charAt(0).toUpperCase()}</span>}
                    <span className="min-w-0">
                      <span className="block font-semibold truncate">{u.name}
                        {u.isRoot && <span className="ml-1.5 text-[10px] bg-amber-500/20 text-amber-500 px-1.5 py-0.5 rounded">ROOT</span>}
                      </span>
                      <span className="block text-[11px] text-zinc-500 truncate">{u.email}</span>
                    </span>
                  </span>
                ),
              },
              {
                key: "roles", header: "Roles",
                sortValue: (u) => (userDrafts[u.id] ?? u.roles).length,
                render: (u) => {
                  const rk = userDrafts[u.id] ?? u.roles;
                  if (rk.length === 0) return <span className="text-[11px] text-zinc-500">— no access</span>;
                  const show = rk.slice(0, 3);
                  return (
                    <span className="flex flex-wrap gap-1">
                      {show.map((k) => (
                        <span key={k} className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-500 dark:text-emerald-400">
                          {roles.find((r) => r.key === k)?.label ?? k}
                        </span>
                      ))}
                      {rk.length > 3 && <span className="text-[11px] text-zinc-500">+{rk.length - 3}</span>}
                    </span>
                  );
                },
              },
              {
                key: "access", header: "Access",
                sortValue: (u) => userScopes(userDrafts[u.id] ?? u.roles).length,
                render: (u) => {
                  const n = userScopes(userDrafts[u.id] ?? u.roles).length;
                  return <span className="text-xs font-bold" title={userScopes(userDrafts[u.id] ?? u.roles).map(scopeLabel).join(", ") || "No dashboards"}>{n} dashboard{n === 1 ? "" : "s"}</span>;
                },
              },
              {
                key: "joined", header: "Joined",
                sortValue: (u) => u.createdAt || "",
                render: (u) => <span className="text-xs text-zinc-500 whitespace-nowrap">{fmtDate(u.createdAt)}</span>,
              },
              {
                key: "action", header: "", className: "text-right",
                render: (u) => (
                  <button onClick={(e) => { e.stopPropagation(); setManagingId(u.id); }}
                    className="rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold px-3 py-1.5 cursor-pointer border-0 whitespace-nowrap">
                    Manage
                  </button>
                ),
              },
            ]}
          />
        </section>
      )}

      {tab === "roles" && isRoot && (
        <section className="bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 sm:p-6">
          <AdminTable<RoleRow>
            rows={roles}
            rowKey={(r) => r.key}
            searchPlaceholder="Search roles…"
            toSearchText={(r) => `${r.key} ${r.label} ${r.description ?? ""}`}
            emptyText="No roles yet — create the first one."
            toolbarExtra={
              <button onClick={() => setRoleDrawer({ mode: "create" })}
                className="rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold px-3 py-2 cursor-pointer border-0 whitespace-nowrap">
                ＋ New role
              </button>
            }
            columns={[
              {
                key: "role", header: "Role",
                sortValue: (r) => r.label.toLowerCase(),
                render: (r) => (
                  <span className="min-w-0">
                    <span className="block font-semibold">{r.label} <span className="font-mono text-[11px] text-zinc-500">{r.key}</span></span>
                    {r.description && <span className="block text-[11px] text-zinc-500 truncate max-w-[280px]">{r.description}</span>}
                  </span>
                ),
              },
              {
                key: "dashboards", header: "Dashboards",
                sortValue: (r) => r.scopeKeys.length,
                render: (r) => <span className="text-xs font-bold" title={r.scopeKeys.map(scopeLabel).join(", ") || "None"}>{r.scopeKeys.length}</span>,
              },
              {
                key: "users", header: "Users",
                sortValue: (r) => roleUserCount.get(r.key) ?? 0,
                render: (r) => <span className="text-xs font-bold">{roleUserCount.get(r.key) ?? 0}</span>,
              },
              {
                key: "action", header: "", className: "text-right",
                render: (r) => (
                  <span className="inline-flex gap-1.5 justify-end">
                    <button onClick={() => setRoleDrawer({ mode: "edit", role: r })}
                      className="rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-bold px-3 py-1.5 cursor-pointer bg-white dark:bg-zinc-950 whitespace-nowrap">
                      Edit
                    </button>
                    <button onClick={() => delRole(r.key)} disabled={busy}
                      className="rounded-lg border border-rose-500/40 text-rose-500 text-xs font-bold px-2.5 py-1.5 disabled:opacity-40 cursor-pointer bg-transparent">
                      ×
                    </button>
                  </span>
                ),
              },
            ]}
          />
        </section>
      )}

      {tab === "scopes" && (
        <section className="bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 sm:p-6">
          <p className="text-xs text-zinc-500 mb-4">
            Permission catalog — every scope the backend auto-seeds (automation <span className="font-mono">rule.json</span> values + built-ins), which dashboards it unlocks, and how many roles/users it reaches. Read-only: scopes appear here on their own when a new automation declares one.
          </p>
          <AdminTable<ScopeRow>
            rows={scopes}
            rowKey={(s) => s.key}
            searchPlaceholder="Search scopes…"
            toSearchText={(s) => `${s.key} ${s.label} ${s.description ?? ""}`}
            emptyText="No scopes."
            columns={[
              {
                key: "scope", header: "Scope",
                sortValue: (s) => s.key,
                render: (s) => (
                  <span className="min-w-0">
                    <span className="block font-mono text-xs font-bold">{s.key}</span>
                    <span className="block text-[11px] text-zinc-500">{s.label}</span>
                  </span>
                ),
              },
              {
                key: "dashboards", header: "Unlocks",
                sortValue: (s) => scopeGroups.find(([k]) => k === s.key)?.[1].length ?? 0,
                render: (s) => {
                  const items = scopeGroups.find(([k]) => k === s.key)?.[1] ?? [];
                  if (items.length === 0) return <span className="text-[11px] text-zinc-500">— platform scope</span>;
                  return (
                    <span className="flex flex-wrap gap-1">
                      {items.slice(0, 3).map((d) => (
                        <span key={d.slug} className="rounded-full border border-indigo-500/30 bg-indigo-500/10 px-2 py-0.5 text-[11px] font-semibold text-indigo-400">{d.name}</span>
                      ))}
                      {items.length > 3 && <span className="text-[11px] text-zinc-500">+{items.length - 3}</span>}
                    </span>
                  );
                },
              },
              {
                key: "roles", header: "Roles",
                sortValue: (s) => scopeStats.rolesUsing.get(s.key)?.length ?? 0,
                render: (s) => {
                  const list = scopeStats.rolesUsing.get(s.key) ?? [];
                  return <span className="text-xs font-bold" title={list.join(", ") || "No roles"}>{list.length}</span>;
                },
              },
              {
                key: "users", header: "Users",
                sortValue: (s) => scopeStats.usersCovered.get(s.key) ?? 0,
                render: (s) => <span className="text-xs font-bold">{scopeStats.usersCovered.get(s.key) ?? 0}</span>,
              },
            ]}
          />
        </section>
      )}

      {managingUser && (
        <Drawer title={`Manage ${managingUser.name}`} subtitle={managingUser.email} onClose={() => setManagingId(null)}>
          <UserDrawer
            user={managingUser}
            roles={roles}
            scopeGroups={scopeGroups}
            scopeLabel={scopeLabel}
            draft={userDrafts[managingUser.id] ?? managingUser.roles}
            onToggleRole={(rk) => toggleDraft(managingUser.id, rk)}
            onSave={() => saveUserRoles(managingUser.id)}
            busy={busy}
            isRoot={isRoot}
            locked={!isRoot && managingUser.isRoot}
          />
        </Drawer>
      )}

      {roleDrawer && isRoot && (
        <Drawer
          title={roleDrawer.mode === "create" ? "New role" : `Edit ${roleDrawer.role.label}`}
          subtitle={roleDrawer.mode === "create" ? "Bundles dashboards into one grantable unit" : roleDrawer.role.key}
          onClose={() => setRoleDrawer(null)}
          wide
        >
          <RoleDrawer
            key={roleDrawer.mode === "create" ? "new" : roleDrawer.role.key}
            initial={roleDrawer.mode === "create" ? null : roleDrawer.role}
            scopeGroups={scopeGroups}
            onSave={saveRole}
            onDelete={roleDrawer.mode === "create" ? undefined : delRole}
            busy={busy}
            isNew={roleDrawer.mode === "create"}
          />
        </Drawer>
      )}
    </div>
  );
}
