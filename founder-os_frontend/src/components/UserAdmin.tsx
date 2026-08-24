"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/auth/AuthContext";

interface ScopeRow { key: string; label: string; description: string | null; }
interface UserRow { id: string; email: string; name: string; picture: string | null; isRoot: boolean; createdAt: string; scopes: string[]; }

export default function UserAdmin() {
  const { me, refresh } = useAuth();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [scopes, setScopes] = useState<ScopeRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string[]>>({});
  const [newKey, setNewKey] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [u, s] = await Promise.all([
      fetch("/api/auth/users").then((r) => r.json()),
      fetch("/api/auth/scopes").then((r) => r.json()),
    ]);
    setUsers(Array.isArray(u) ? u : []);
    setScopes(Array.isArray(s) ? s : []);
    if (Array.isArray(u)) {
      const d: Record<string, string[]> = {};
      for (const x of u) d[x.id] = x.scopes;
      setDrafts(d);
    }
  }, []);

  useEffect(() => {
    if (me?.isAdmin) void load();
  }, [me, load]);
  // re-load after our own mutations
  const reload = useCallback(() => { void load(); void refresh(); }, [load, refresh]);

  const toggle = (userId: string, key: string) => {
    setDrafts((prev) => {
      const cur = prev[userId] || [];
      const next = cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key];
      return { ...prev, [userId]: next };
    });
  };

  const save = async (userId: string) => {
    setBusy(true);
    await fetch(`/api/auth/users/${userId}/scopes`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keys: drafts[userId] || [] }),
    });
    setBusy(false);
    reload();
  };

  const addScope = async () => {
    if (!newKey || !newLabel) return;
    setBusy(true);
    await fetch("/api/auth/scopes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: newKey, label: newLabel, description: null }),
    });
    setNewKey(""); setNewLabel("");
    setBusy(false);
    reload();
  };

  const delScope = async (key: string) => {
    if (!confirm(`Delete category "${key}"? Users lose this access.`)) return;
    setBusy(true);
    await fetch(`/api/auth/scopes/${key}`, { method: "DELETE" });
    setBusy(false);
    reload();
  };

  if (!me?.isRoot) return <div className="p-8 text-zinc-500">Admin access required.</div>;

  return (
    <div className="space-y-6 text-zinc-900 dark:text-zinc-100 pb-12">
      <div>
        <h1 className="text-3xl font-bold font-heading">User & Permission Management</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Root: {me.user.email}. Create categories and grant them per user. Each view requires a category.
        </p>
      </div>

      <section className="bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6">
        <h3 className="text-lg font-bold mb-3">Categories</h3>
        <div className="flex flex-wrap gap-2 mb-4">
          {scopes.map((s) => (
            <span key={s.key} className="inline-flex items-center gap-2 text-xs bg-zinc-200 dark:bg-zinc-800 px-2.5 py-1 rounded-full">
              <span className="font-mono">{s.key}</span>
              <span className="text-zinc-500 dark:text-zinc-400">{s.label}</span>
              {s.key !== "admin" && (
                <button onClick={() => delScope(s.key)} className="text-rose-500 hover:text-rose-400 font-bold">×</button>
              )}
            </span>
          ))}
        </div>
        <div className="flex gap-2 flex-wrap">
          <input value={newKey} onChange={(e) => setNewKey(e.target.value)} placeholder="key (a-z0-9-)"
            className="bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded-lg px-3 py-2 text-sm" />
          <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="Label"
            className="bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded-lg px-3 py-2 text-sm" />
          <button onClick={addScope} disabled={busy}
            className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold rounded-lg px-4 py-2 disabled:opacity-60">
            Add category
          </button>
        </div>
      </section>

      <section className="bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6">
        <h3 className="text-lg font-bold mb-3">Users</h3>
        <div className="space-y-4">
          {users.map((u) => (
            <div key={u.id} className="border border-zinc-200 dark:border-zinc-800 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <div className="font-semibold">{u.name} {u.isRoot && <span className="text-[10px] bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded">ROOT</span>}</div>
                  <div className="text-xs text-zinc-500">{u.email}</div>
                </div>
                <button onClick={() => save(u.id)} disabled={busy}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold rounded-lg px-3 py-1.5 disabled:opacity-60">
                  Save
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {scopes.map((s) => {
                  const checked = (drafts[u.id] || []).includes(s.key);
                  return (
                    <label key={s.key}
                      className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border cursor-pointer ${
                        checked ? "bg-indigo-600/20 border-indigo-500 text-indigo-300" : "bg-zinc-100 dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300"}`}>
                      <input type="checkbox" checked={checked} onChange={() => toggle(u.id, s.key)} className="accent-indigo-500" />
                      {s.label}
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
