"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/auth/AuthContext";
import { DASHBOARD_SCOPES } from "@/auth/permissions";

interface ScopeRow { key: string; label: string; description: string | null; }
interface RoleRow { key: string; label: string; description: string | null; scopeKeys: string[]; }
interface UserRow { id: string; email: string; name: string; picture: string | null; isRoot: boolean; createdAt: string; scopes: string[]; roles: string[]; }

export default function UserAdmin() {
  const { me, refresh } = useAuth();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [scopes, setScopes] = useState<ScopeRow[]>([]);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [userDrafts, setUserDrafts] = useState<Record<string, string[]>>({});
  const [roleDrafts, setRoleDrafts] = useState<Record<string, string[]>>({});
  const [newKey, setNewKey] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [newScopes, setNewScopes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [u, s, r] = await Promise.all([
      fetch("/api/auth/users").then((res) => res.json()),
      fetch("/api/auth/scopes").then((res) => res.json()),
      fetch("/api/auth/roles").then((res) => res.json()),
    ]);
    const usersArr: UserRow[] = Array.isArray(u) ? u : [];
    const rolesArr: RoleRow[] = Array.isArray(r) ? r : [];
    setUsers(usersArr);
    setScopes(Array.isArray(s) ? s : []);
    setRoles(rolesArr);
    const ud: Record<string, string[]> = {};
    for (const x of usersArr) ud[x.id] = x.roles;
    setUserDrafts(ud);
    const rd: Record<string, string[]> = {};
    for (const x of rolesArr) rd[x.key] = x.scopeKeys;
    setRoleDrafts(rd);
  }, []);

  useEffect(() => {
    if (me?.isAdmin) void load();
  }, [me, load]);
  const reload = useCallback(() => { void load(); void refresh(); }, [load, refresh]);

  const toggle = (drafts: Record<string, string[]>, id: string, key: string) => {
    const cur = drafts[id] || [];
    return { ...drafts, [id]: cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key] };
  };

  const saveUserRoles = async (userId: string) => {
    setBusy(true);
    await fetch(`/api/auth/users/${userId}/roles`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keys: userDrafts[userId] || [] }),
    });
    setBusy(false);
    reload();
  };

  const saveRole = async (role: RoleRow) => {
    setBusy(true);
    await fetch("/api/auth/roles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: role.key, label: role.label, description: role.description, scopeKeys: roleDrafts[role.key] || [] }),
    });
    setBusy(false);
    reload();
  };

  const addRole = async () => {
    if (!newKey || !newLabel) return;
    setBusy(true);
    await fetch("/api/auth/roles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: newKey, label: newLabel, description: null, scopeKeys: newScopes }),
    });
    setNewKey(""); setNewLabel(""); setNewScopes([]);
    setBusy(false);
    reload();
  };

  const delRole = async (key: string) => {
    if (!confirm(`Delete role "${key}"? Users with this role lose its dashboard access.`)) return;
    setBusy(true);
    await fetch(`/api/auth/roles/${key}`, { method: "DELETE" });
    setBusy(false);
    reload();
  };

  const scopeLabel = (key: string) => scopes.find((s) => s.key === key)?.label || key;
  const dashboardScopes = scopes.filter((s) => DASHBOARD_SCOPES.includes(s.key));

  if (!me?.isRoot) return <div className="p-8 text-zinc-500">Admin access required.</div>;

  return (
    <div className="space-y-6 text-zinc-900 dark:text-zinc-100 pb-12">
      <div>
        <h1 className="text-3xl font-bold font-heading">User & Permission Management</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Root: {me.user.email}. Assign roles to users; a role grants the automation dashboards you define for it.
        </p>
      </div>

      <section className="bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6">
        <h3 className="text-lg font-bold mb-1">Roles</h3>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-4">
          Each role bundles automation dashboard views. Users get every dashboard their role includes.
        </p>
        <div className="space-y-4">
          {roles.map((role) => (
            <div key={role.key} className="border border-zinc-200 dark:border-zinc-800 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <div className="font-semibold"><span className="font-mono">{role.key}</span> — {role.label}</div>
                  <div className="text-xs text-zinc-500">{role.description}</div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => saveRole(role)} disabled={busy}
                    className="bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold rounded-lg px-3 py-1.5 disabled:opacity-60">
                    Save
                  </button>
                  <button onClick={() => delRole(role.key)} disabled={busy}
                    className="text-rose-500 hover:text-rose-400 font-bold text-sm px-2 py-1.5 disabled:opacity-60">
                    ×
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {dashboardScopes.map((s) => {
                  const checked = (roleDrafts[role.key] || []).includes(s.key);
                  return (
                    <label key={s.key}
                      className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border cursor-pointer ${
                        checked ? "bg-indigo-600/20 border-indigo-500 text-indigo-300" : "bg-zinc-100 dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300"}`}>
                      <input type="checkbox" checked={checked} onChange={() => setRoleDrafts((p) => toggle(p, role.key, s.key))} className="accent-indigo-500" />
                      {s.label}
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 border-t border-zinc-200 dark:border-zinc-800 pt-4">
          <h4 className="text-sm font-bold mb-2">New role</h4>
          <div className="flex flex-wrap items-center gap-2">
            <input value={newKey} onChange={(e) => setNewKey(e.target.value)} placeholder="key (a-z0-9-)"
              className="bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded-lg px-3 py-2 text-sm" />
            <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="Label (e.g. MIS)"
              className="bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded-lg px-3 py-2 text-sm" />
            <button onClick={addRole} disabled={busy}
              className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold rounded-lg px-4 py-2 disabled:opacity-60">
              Add role
            </button>
          </div>
          <div className="flex flex-wrap gap-2 mt-3">
            {dashboardScopes.map((s) => {
              const checked = newScopes.includes(s.key);
              return (
                <label key={s.key}
                  className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border cursor-pointer ${
                    checked ? "bg-indigo-600/20 border-indigo-500 text-indigo-300" : "bg-zinc-100 dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300"}`}>
                  <input type="checkbox" checked={checked} onChange={() => setNewScopes((p) => p.includes(s.key) ? p.filter((k) => k !== s.key) : [...p, s.key])} className="accent-indigo-500" />
                  {s.label}
                </label>
              );
            })}
          </div>
        </div>
      </section>

      <section className="bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6">
        <h3 className="text-lg font-bold mb-3">Users</h3>
        <div className="space-y-4">
          {users.map((u) => {
            const granted = (userDrafts[u.id] || []).flatMap((rk) => roles.find((r) => r.key === rk)?.scopeKeys || []);
            const grantedLabels = [...new Set(granted)].map(scopeLabel);
            return (
              <div key={u.id} className="border border-zinc-200 dark:border-zinc-800 rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <div className="font-semibold">{u.name} {u.isRoot && <span className="text-[10px] bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded">ROOT</span>}</div>
                    <div className="text-xs text-zinc-500">{u.email}</div>
                  </div>
                  <button onClick={() => saveUserRoles(u.id)} disabled={busy}
                    className="bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold rounded-lg px-3 py-1.5 disabled:opacity-60">
                    Save
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {roles.map((r) => {
                    const checked = (userDrafts[u.id] || []).includes(r.key);
                    return (
                      <label key={r.key}
                        className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border cursor-pointer ${
                          checked ? "bg-emerald-600/20 border-emerald-500 text-emerald-300" : "bg-zinc-100 dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300"}`}>
                        <input type="checkbox" checked={checked} onChange={() => setUserDrafts((p) => toggle(p, u.id, r.key))} className="accent-emerald-500" />
                        {r.label}
                      </label>
                    );
                  })}
                  {roles.length === 0 && <span className="text-xs text-zinc-500">No roles defined yet.</span>}
                </div>
                {grantedLabels.length > 0 && (
                  <div className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                    Grants: {grantedLabels.join(", ")}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}