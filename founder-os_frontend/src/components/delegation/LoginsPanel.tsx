"use client";

// HR panel: which roster member is linked to which platform login. Without a
// link an employee cannot see their own tasks, so this is the one setup step.
import React, { useState } from "react";
import { setMemberLoginEmail } from "@/hr/api";
import type { HrDelegationMember } from "@/hr/types";

export default function LoginsPanel({
  logins, onChanged,
}: {
  logins: HrDelegationMember[];
  onChanged: () => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const valueFor = (row: HrDelegationMember) =>
    drafts[row.id] ?? (row.loginEmail ?? "");

  const save = async (row: HrDelegationMember) => {
    const raw = valueFor(row).trim();
    setBusyId(row.id);
    setErr(null);
    try {
      await setMemberLoginEmail(row.id, raw || null);
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[row.id];
        return next;
      });
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-zinc-500">
        Only linked logins can open their own task list. Leave empty to unlink. The
        contact email is used as a fallback when no login email is set.
      </p>
      {err && <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 px-2.5 py-1.5 text-[11px] text-rose-500">{err}</div>}
      {!logins.length && (
        <div className="rounded-xl border border-dashed border-zinc-300 dark:border-zinc-800 px-3 py-4 text-center text-xs text-zinc-500">
          No roster members yet.
        </div>
      )}
      <div className="space-y-1.5">
        {logins.map((row) => {
          const dirty = drafts[row.id] !== undefined && (drafts[row.id] ?? "") !== (row.loginEmail ?? "");
          return (
            <div key={row.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-xs font-bold text-zinc-800 dark:text-zinc-100">{row.name}</span>
                  {row.linked ? (
                    <span className="rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-bold text-emerald-600 dark:text-emerald-400">
                      linked{row.matchedBy === "loginEmail" ? " · login" : row.matchedBy === "email" ? " · email" : ""}
                    </span>
                  ) : (
                    <span className="rounded-full bg-zinc-500/10 px-1.5 py-0.5 text-[9px] font-bold text-zinc-500">not linked</span>
                  )}
                </div>
                {row.email && <div className="truncate text-[10px] text-zinc-400">contact: {row.email}</div>}
              </div>
              <input
                value={valueFor(row)}
                onChange={(e) => setDrafts((prev) => ({ ...prev, [row.id]: e.target.value }))}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void save(row); } }}
                placeholder="login email (e.g. name@company.com)"
                className="w-full min-w-0 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-2 py-1.5 text-[11px] outline-none focus:border-indigo-500 sm:w-64"
              />
              <button
                onClick={() => save(row)}
                disabled={busyId === row.id || !dirty}
                className="rounded-lg bg-zinc-900 dark:bg-zinc-100 px-2.5 py-1.5 text-[11px] font-bold text-white dark:text-zinc-900 disabled:opacity-30"
              >
                {busyId === row.id ? "Saving…" : "Save"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
