"use client";

import React, { useEffect, useState } from "react";

export interface ScopeRow { key: string; label: string; description: string | null; }
export interface RoleRow { key: string; label: string; description: string | null; scopeKeys: string[]; }
export interface UserRow { id: string; email: string; name: string; picture: string | null; isRoot: boolean; createdAt: string; scopes: string[]; roles: string[]; }
export interface DashboardRow { slug: string; name: string; scope: string | null; }

/** Slide-over shell for manage/edit flows (keeps tables mounted behind). */
export function Drawer({ title, subtitle, onClose, children, wide }: {
  title: string; subtitle?: string; onClose: () => void; children: React.ReactNode; wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className={`absolute right-0 top-0 h-full ${wide ? "w-full sm:w-[560px]" : "w-full sm:w-[440px]"} bg-white dark:bg-zinc-950 border-l border-zinc-200 dark:border-zinc-800 shadow-2xl flex flex-col animate-scale-up`}>
        <div className="flex items-start gap-3 border-b border-zinc-200 dark:border-zinc-800 px-5 py-4">
          <div className="min-w-0 flex-1">
            <h3 className="font-bold text-base truncate">{title}</h3>
            {subtitle && <p className="text-xs text-zinc-500 mt-0.5 truncate">{subtitle}</p>}
          </div>
          <button onClick={onClose} aria-label="Close"
            className="rounded-lg border border-zinc-300 dark:border-zinc-700 px-2.5 py-1 text-sm font-bold text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 cursor-pointer bg-transparent">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

/** Grouped scope checkbox grid (one checkbox per scope — dashboards sharing a
 *  scope never render as linked toggles). */
export function ScopeCheckGrid({ scopeGroups, checked, onToggle, disabled }: {
  scopeGroups: [string, DashboardRow[]][];
  checked: string[];
  onToggle: (key: string) => void;
  disabled?: boolean;
}) {
  if (scopeGroups.length === 0) return <span className="text-xs text-zinc-500">No dashboards available.</span>;
  return (
    <div className="grid gap-1.5 sm:grid-cols-2">
      {scopeGroups.map(([sKey, items]) => {
        const on = checked.includes(sKey);
        return (
          <label key={sKey}
            className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 text-xs ${disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer"} ${
              on ? "bg-indigo-600/15 border-indigo-500" : "border-zinc-300 dark:border-zinc-700"}`}>
            <input type="checkbox" checked={on} disabled={disabled} onChange={() => onToggle(sKey)} className="accent-indigo-500 shrink-0" />
            <span className="min-w-0 flex-1">
              <span className="block font-semibold truncate">{items.map((d) => d.name).join(" + ")}</span>
              <span className="block text-[10px] uppercase tracking-wide text-zinc-500">{sKey}</span>
            </span>
          </label>
        );
      })}
    </div>
  );
}

/** Manage-roles drawer for one user, with live effective-access preview. */
export function UserDrawer({ user, roles, scopeGroups, scopeLabel, draft, onToggleRole, onSave, busy, isRoot, locked }: {
  user: UserRow;
  roles: RoleRow[];
  scopeGroups: [string, DashboardRow[]][];
  scopeLabel: (key: string) => string;
  draft: string[];
  onToggleRole: (roleKey: string) => void;
  onSave: () => void;
  busy: boolean;
  isRoot: boolean;
  locked: boolean;
}) {
  const isAdminRole = (scopeKeys: string[]) => scopeKeys.map((s) => s.toLowerCase()).includes("admin");
  const granted = [...new Set(draft.flatMap((rk) => roles.find((r) => r.key === rk)?.scopeKeys || []))];
  const dirty = [...draft].sort().join(",") !== [...user.roles].sort().join(",");
  return (
    <>
      <div className="flex items-center gap-3 rounded-xl border border-zinc-200 dark:border-zinc-800 p-3">
        {user.picture
          ? <img src={user.picture} alt="" className="h-10 w-10 rounded-full" />
          : <div className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-600 text-sm font-bold text-white">{(user.name || user.email || "U").charAt(0).toUpperCase()}</div>}
        <div className="min-w-0">
          <div className="font-bold truncate">{user.name}
            {user.isRoot && <span className="ml-2 text-[10px] bg-amber-500/20 text-amber-500 px-2 py-0.5 rounded">ROOT</span>}
          </div>
          <div className="text-xs text-zinc-500 truncate">{user.email}</div>
        </div>
      </div>

      <h4 className="mt-5 mb-2 text-xs font-extrabold uppercase tracking-wider text-zinc-500">Roles ({draft.length})</h4>
      {locked
        ? <p className="text-xs text-zinc-500">🔒 Root user — manageable by root only (and never editable by managers).</p>
        : roles.length === 0
          ? <p className="text-xs text-zinc-500">No roles defined yet — root creates them in the Roles tab.</p>
          : (
            <div className="space-y-1.5">
              {roles.map((r) => {
                const on = draft.includes(r.key);
                const disabled = locked || (!isRoot && isAdminRole(r.scopeKeys));
                return (
                  <label key={r.key}
                    className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 text-sm ${disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer"} ${
                      on ? "bg-emerald-600/10 border-emerald-500" : "border-zinc-300 dark:border-zinc-700"}`}>
                    <input type="checkbox" checked={on} disabled={disabled} onChange={() => onToggleRole(r.key)} className="accent-emerald-500 shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">{r.label} <span className="font-mono text-[11px] text-zinc-500">{r.key}</span></span>
                      <span className="block text-[11px] text-zinc-500 truncate">{r.scopeKeys.length} dashboards</span>
                    </span>
                    {!isRoot && isAdminRole(r.scopeKeys) && <span className="text-[10px] font-bold text-amber-500">ROOT ONLY</span>}
                  </label>
                );
              })}
            </div>
          )}

      <h4 className="mt-5 mb-2 text-xs font-extrabold uppercase tracking-wider text-zinc-500">
        Effective access ({granted.length})
      </h4>
      {granted.length === 0
        ? <p className="text-xs text-zinc-500">No dashboards — this user sees the “Access pending” panel until a role is assigned.</p>
        : (
          <div className="flex flex-wrap gap-1.5">
            {granted.map((s) => <span key={s} className="rounded-full border border-indigo-500/30 bg-indigo-500/10 px-2 py-0.5 text-[11px] font-semibold text-indigo-400">{scopeLabel(s)}</span>)}
          </div>
        )}

      {!locked && (
        <button onClick={onSave} disabled={busy || !dirty}
          className="mt-6 w-full rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold px-4 py-2.5 disabled:opacity-40 cursor-pointer border-0">
          {busy ? "Saving…" : dirty ? "Save roles" : "No changes"}
        </button>
      )}
      <p className="mt-2 text-[11px] text-zinc-500">Direct scope assignment is intentionally unavailable — access flows through roles so it stays auditable at scale.</p>
    </>
  );
}

/** Create/edit drawer for a role (root only). */
export function RoleDrawer({ initial, scopeGroups, onSave, onDelete, busy, isNew }: {
  initial: RoleRow | null;
  scopeGroups: [string, DashboardRow[]][];
  onSave: (input: { key: string; label: string; description: string | null; scopeKeys: string[] }) => void;
  onDelete?: (key: string) => void;
  busy: boolean;
  isNew: boolean;
}) {
  const [key, setKey] = useState(initial?.key ?? "");
  const [label, setLabel] = useState(initial?.label ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [checked, setChecked] = useState<string[]>(initial?.scopeKeys ?? []);
  const toggle = (s: string) => setChecked((p) => (p.includes(s) ? p.filter((k) => k !== s) : [...p, s]));
  const valid = key.trim() !== "" && label.trim() !== "";

  return (
    <>
      <div className="grid gap-2.5">
        <label className="block">
          <span className="mb-1 block text-xs font-bold text-zinc-500">KEY</span>
          <input value={key} disabled={!isNew} onChange={(e) => setKey(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
            placeholder="key (a-z0-9-)"
            className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-indigo-500 disabled:opacity-60 font-mono" />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-bold text-zinc-500">LABEL</span>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label (e.g. MIS)"
            className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-indigo-500" />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-bold text-zinc-500">DESCRIPTION</span>
          <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Who is this role for?"
            className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-indigo-500" />
        </label>
      </div>

      <h4 className="mt-5 mb-2 text-xs font-extrabold uppercase tracking-wider text-zinc-500">
        Dashboards ({checked.length})
      </h4>
      <ScopeCheckGrid scopeGroups={scopeGroups} checked={checked} onToggle={toggle} />

      <button onClick={() => onSave({ key: key.trim(), label: label.trim(), description: description.trim() || null, scopeKeys: checked })}
        disabled={busy || !valid}
        className="mt-6 w-full rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold px-4 py-2.5 disabled:opacity-40 cursor-pointer border-0">
        {busy ? "Saving…" : isNew ? "Create role" : "Save role"}
      </button>
      {!isNew && onDelete && (
        <button onClick={() => onDelete(initial!.key)} disabled={busy}
          className="mt-2 w-full rounded-xl border border-rose-500/40 text-rose-500 hover:bg-rose-500/10 text-sm font-bold px-4 py-2 disabled:opacity-40 cursor-pointer bg-transparent">
          Delete role
        </button>
      )}
    </>
  );
}
