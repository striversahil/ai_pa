"use client";

// Extracted verbatim from SalesControllerPanel.tsx by scripts/refactor/split-module.mjs.
// SalesControllerPanel.tsx re-exports everything public here, so existing imports keep working.
import type { RosterRow } from "../TelecallingDashboard";
import { Trash2 } from "lucide-react";

export function RosterSection({
  rosterRows,
  busy,
  rosterError,
  readOnly = false,
  onAdd,
  onEditModal,
  onDelete,
  onRestore,
  deletedRows,
  showDeleted,
  onToggleShowDeleted,
}: {
  rosterRows: RosterRow[];
  busy: boolean;
  rosterError: string | null;
  /** Read-only hides Add/Edit/Delete/Restore. Closer status is display-only. */
  readOnly?: boolean;
  onAdd: () => void;
  onEditModal: (t: RosterRow) => void;
  onDelete: (t: RosterRow) => void;
  onRestore: (id: string) => void;
  deletedRows: RosterRow[];
  showDeleted: boolean;
  onToggleShowDeleted: (open: boolean) => void;
}) {
  return (
    <section className="bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-bold">Sales Roster</h3>
        {!readOnly && (
          <button onClick={onAdd} disabled={busy}
            className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold rounded-lg px-4 py-2 disabled:opacity-60">
            + Add staff
          </button>
        )}
      </div>
      {rosterError && (
        <div className="mb-3 text-xs font-semibold text-rose-500 dark:text-rose-400 bg-rose-500/10 rounded-lg px-3 py-2">
          {rosterError}
        </div>
      )}
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 mb-5">
        {rosterRows.map((t) => (
          <div key={t.id} className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-4">
            <div className="flex items-center justify-between">
              <div className="font-semibold text-zinc-900 dark:text-white">{t.name}</div>
              <div className="flex items-center gap-1 flex-wrap justify-end">
                <span className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold ${t.type === "field_staff" ? "border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-400" : t.type === "team_lead" ? "border-indigo-500/30 bg-indigo-500/10 text-indigo-600 dark:text-indigo-300" : "border-zinc-400/30 bg-zinc-500/10 text-zinc-600 dark:text-zinc-300"}`}>
                  {t.type === "field_staff" ? "Field Staff" : t.type === "team_lead" ? "Team Lead" : "Telecaller"}
                </span>
                <span className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold ${t.region ? "border-indigo-500/30 bg-indigo-500/10 text-indigo-500 dark:text-indigo-300" : "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400"}`}>
                  {t.region ? (t.region2 ? `${t.region}+${t.region2}` : t.region) : "Unmapped"}
                </span>
                {t.tlLevel && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 font-semibold">{t.tlLevel}</span>
                )}
                <span className={`text-[10px] px-2 py-0.5 rounded-full ${t.type === "field_staff" ? "bg-sky-500/10 text-sky-600 dark:text-sky-400" : t.type === "team_lead" ? "bg-indigo-500/10 text-indigo-600 dark:text-indigo-300" : t.assignEstimateFollowUps ? "bg-emerald-500/10 text-emerald-400" : "bg-zinc-200 dark:bg-zinc-800 text-zinc-500"}`}>
                  {t.type === "field_staff" ? "Leads only" : t.type === "team_lead" ? "Reseller target" : t.assignEstimateFollowUps ? "Closer" : "Generator"}
                </span>
              </div>
            </div>
            <div className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-1">
              {t.neodoveUserName ? `NeoDove: ${t.neodoveUserName}` : "NeoDove: not linked"}
            </div>
            <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
              {t.email && <>Email: {t.email}</>}
              {t.phone && <> · Phone: {t.phone}</>}
              {t.whatsapp && <> · WhatsApp: {t.whatsapp}</>}
              {!t.email && !t.phone && !t.whatsapp && "No contact details"}
            </div>
            {t.linkedUser && (
              <div className="text-[11px] text-emerald-500 dark:text-emerald-400 mt-0.5">
                ✓ Signed-up platform user: {t.linkedUser.name} ({t.linkedUser.email})
              </div>
            )}
            <div className="text-[11px] text-zinc-500 dark:text-zinc-400">Open in region: {t.activeAssigned} · lifetime assigned: {t.totalAssigned}</div>
            <div className="flex gap-2 mt-3 flex-wrap">
              {!readOnly && <button onClick={() => onEditModal(t)} className="flex-1 text-xs rounded-lg bg-zinc-100 dark:bg-zinc-800 py-1.5 font-semibold hover:bg-zinc-200 dark:hover:bg-zinc-700">Edit</button>}
              {t.type !== "field_staff" && t.type !== "team_lead" ? (
                <span className="flex-1 text-center text-[11px] rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-500 py-1.5 font-semibold">
                  {t.assignEstimateFollowUps ? "Closer" : "Generator"}
                </span>
              ) : t.type === "team_lead" ? (
                <span className="flex-1 text-center text-[11px] rounded-lg bg-indigo-500/5 text-indigo-600 dark:text-indigo-300 py-1.5 font-semibold" title="Team Leads own the reseller target across their two regions — they are never listed as telecallers">
                  Owns reseller target
                </span>
              ) : (
                <span className="flex-1 text-center text-[11px] rounded-lg bg-sky-500/5 text-sky-600 dark:text-sky-400 py-1.5 font-semibold" title="Field staff never operate the dashboard and never close — they only generate leads">
                  Never a closer
                </span>
              )}
              {!readOnly && (
                <button
                  onClick={() => onDelete(t)}
                  disabled={busy}
                  className="inline-flex items-center justify-center rounded-lg bg-rose-500/10 text-rose-500 dark:text-rose-400 p-2 hover:bg-rose-500/20 disabled:opacity-40"
                  title="Delete agent — hidden everywhere, restorable from Deleted Agents"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        ))}
        {rosterRows.length === 0 && <p className="text-sm text-zinc-500">No sales staff yet — add a telecaller or field staff below.</p>}
      </div>

      {/* Deleted agents — hidden from the roster/leaderboard, restorable */}
      <div className="border-t border-zinc-200 dark:border-zinc-800 pt-3 mt-3">
        <button
          onClick={() => onToggleShowDeleted(!showDeleted)}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold text-zinc-600 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-800 hover:border-rose-400 hover:text-rose-500 dark:hover:text-rose-400 transition-colors"
          title="Expand/collapse deleted agents (restorable)"
        >
          <span className={`transition-transform inline-block ${showDeleted ? "rotate-90" : ""}`}>▸</span>
          <Trash2 className="w-4 h-4" />
          Deleted agents ({deletedRows.length})
        </button>

        {showDeleted && (
          <div className="mt-3 grid gap-2 md:grid-cols-2 lg:grid-cols-3">
            {deletedRows.map((t) => (
              <div key={t.id} className="rounded-xl border border-rose-500/25 bg-rose-500/5 p-4">
                <div className="flex items-center justify-between">
                  <div className="font-semibold text-sm text-zinc-800 dark:text-zinc-200">{t.name}</div>
                  <span className="text-[10px] px-2 py-1 rounded-full bg-rose-500/10 text-rose-400 font-bold">Deleted</span>
                </div>
                <div className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-1.5 leading-relaxed">
                  {t.neodoveUserName ? `NeoDove: ${t.neodoveUserName}` : "NeoDove: not linked"}
                  <br />
                  Lifetime assigned: {t.totalAssigned}
                </div>
                {!readOnly && (
                  <button
                    onClick={() => onRestore(t.id)}
                    disabled={busy}
                    className="mt-3 w-full text-xs rounded-lg bg-emerald-500/10 text-emerald-500 dark:text-emerald-400 py-2 font-semibold hover:bg-emerald-500/20 disabled:opacity-40"
                    title="Restore as inactive — reactivate when ready"
                  >
                    ♻ Restore (inactive)
                  </button>
                )}
              </div>
            ))}
            {deletedRows.length === 0 && <p className="text-xs text-zinc-500 py-2">No deleted agents.</p>}
          </div>
        )}
      </div>
    </section>
  );
}
