"use client";

// SalesControllerPanel — MIS/sales-head control of the region model.
//
// Lifted verbatim from the leaderboard's old inner "Controller" tab: unmapped
// estimate linking, NeoDove campaign push, EST re-home, client segments, sales
// holidays, history reset, data export and the staff roster. The workspace top
// bar owns it now (agents never see this tab), so it fetches its own data: one
// period-free telecalling read (unmapped + epoch) plus the roster read.
import React, { useState, useCallback, useEffect } from "react";
import { Trash2 } from "lucide-react";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { useLiveQuery } from "@/hooks/useLiveData";
import { useAuth } from "@/auth/AuthContext";
import { REGIONS, type RegionId } from "@/telecalling/regions";
import NeoDoveCampaignSection from "@/components/telecalling/NeoDoveCampaignSection";
import RehomeEstimateSection from "@/components/telecalling/RehomeEstimateSection";
import SalesHolidaysSection from "@/components/telecalling/SalesHolidaysSection";
import ClientSegmentSection from "@/components/telecalling/ClientSegmentSection";
import { adaptDashData, fmtNum, type DailyRow, type DashData, type RosterRow } from "./TelecallingDashboard";

/** Live events that refresh controller data (same set as the leaderboard). */
const TELECALLING_EVENTS = ["automation", "telecalling", "estimates", "baseline"];

/** MIS/sales-head authority — same check the leaderboard inner tab used (scope or role). */
export function hasSalesManagerAccess(me: { isAdmin?: boolean; scopes?: string[]; roles?: string[] } | null): boolean {
  if (!me) return false;
  return !!(
    me.isAdmin ||
    me.scopes?.includes("mis") ||
    me.roles?.includes("mis") ||
    me.scopes?.includes("sales-head") ||
    me.roles?.includes("sales-head")
  );
}

export default function SalesControllerPanel() {
  const { me } = useAuth();
  const canManage = hasSalesManagerAccess(me);
  const [busy, setBusy] = useState(false);
  const [rosterError, setRosterError] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState<RosterRow | null>(null);
  const [rosterModalOpen, setRosterModalOpen] = useState(false);

  // Period-free telecalling read: unmapped bucket + epoch (never the leaderboard).
  const tele = useLiveQuery<any>(
    async () => {
      const res = await fetch("/api/automations/telecalling/data");
      if (!res.ok) throw new Error("Controller load failed");
      return res.json();
    },
    { events: TELECALLING_EVENTS, clearOnError: true },
  );
  const unmapped = tele.data?.unmapped ?? null;
  const unmappedAccepted = tele.data?.unmappedAccepted ?? null;
  const epoch = tele.data?.epoch ?? null;

  const roster = useLiveQuery<{ telecallers: RosterRow[] }>(
    async () => {
      if (!canManage) return { telecallers: [] };
      const res = await fetch("/api/telecallers");
      if (!res.ok) throw new Error("load failed");
      return res.json();
    },
    { events: TELECALLING_EVENTS },
  );
  const rosterRows: RosterRow[] = roster.data?.telecallers ?? [];

  const refreshAll = useCallback(() => {
    tele.refresh();
    roster.refresh();
  }, [tele, roster]);

  // ── Deleted agents ───────────────────────────────────────────────────────
  const [showDeleted, setShowDeleted] = useState(false);
  const [deletedRows, setDeletedRows] = useState<RosterRow[]>([]);
  const loadDeleted = useCallback(async () => {
    if (!canManage) return;
    try {
      const res = await fetch("/api/telecallers?deleted=1");
      if (res.ok) setDeletedRows((await res.json()).telecallers ?? []);
    } catch { /* ignore */ }
  }, [canManage]);
  useEffect(() => {
    if (showDeleted) void loadDeleted();
  }, [showDeleted, loadDeleted]);
  const deleteTelecaller = async (id: string) => {
    setBusy(true);
    setRosterError(null);
    try {
      const res = await fetch(`/api/telecallers/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `Delete failed (${res.status})`);
      }
      refreshAll();
      void loadDeleted();
    } catch (e: any) {
      setRosterError(e?.message ?? "Delete failed");
    } finally {
      setBusy(false);
    }
  };
  // Pretty in-house confirm (replaces window.confirm) for roster deletion.
  const [confirmDelete, setConfirmDelete] = useState<RosterRow | null>(null);
  const restoreTelecaller = async (id: string) => {
    setBusy(true);
    setRosterError(null);
    try {
      const res = await fetch(`/api/telecallers/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deleted: false }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `Restore failed (${res.status})`);
      }
      refreshAll();
      void loadDeleted();
    } catch (e: any) {
      setRosterError(e?.message ?? "Restore failed");
    } finally {
      setBusy(false);
    }
  };

  // Add/edit agent from the modal — contact + role + NeoDove link (hand-picked
  // in the modal; auto-sync only fills empty link fields, never overwrites).
  // The closer/follow-up flag is intentionally not edited here: the backend
  // preserves the stored value on PUT and defaults new telecallers on POST.
  const saveRoster = async (updates: { name: string; email: string; phone: string; whatsapp: string; region: string; region2: string; tlLevel: string; type: string; neodove: { userId: string; userName: string } | null }) => {
    if (!updates.name.trim()) return;
    setBusy(true);
    setRosterError(null);
    try {
      const payload: Record<string, unknown> = {
        name: updates.name,
        email: updates.email || null,
        phone: updates.phone || null,
        whatsapp: updates.whatsapp || null,
        region: updates.region,
        region2: updates.region2,
        tlLevel: updates.tlLevel,
        type: updates.type,
        neodoveUserId: updates.neodove ? updates.neodove.userId : '',
        neodoveUserName: updates.neodove ? updates.neodove.userName : '',
      };
      const res = editTarget
        ? await fetch(`/api/telecallers/${editTarget.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch("/api/telecallers", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `Save failed (${res.status})`);
      }
      setEditTarget(null);
      setRosterModalOpen(false);
      refreshAll();
    } catch (e: any) {
      setRosterError(e?.message ?? "Save failed");
    } finally {
      setBusy(false);
    }
  };

  if (!canManage) {
    return (
      <p className="px-1 text-xs text-zinc-500 dark:text-zinc-600">
        🔒 Controller is restricted to MIS and Sales Head users.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <ConfirmDialog
        open={!!confirmDelete}
        title={`Delete ${confirmDelete?.name ?? "telecaller"}?`}
        message="They disappear from the roster, leaderboard and assignment engine. You can restore them anytime from Deleted Agents below."
        confirmLabel="Delete agent"
        busy={busy}
        onConfirm={() => { const id = confirmDelete?.id; setConfirmDelete(null); if (id) void deleteTelecaller(id); }}
        onCancel={() => setConfirmDelete(null)}
      />
      <section className="rounded-xl border border-zinc-200 bg-zinc-50 p-5 dark:border-zinc-800 dark:bg-zinc-900">
        <h3 className="mb-1 text-lg font-bold">🎛️ Controller</h3>
        <p className="mb-0 text-xs text-zinc-500 dark:text-zinc-400">
          MIS/sales-head control of the region model — unmapped estimate
          linking, history reset and the staff roster.
        </p>
      </section>
      {!!tele.error && !tele.loading && (
        <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs font-semibold text-rose-600 dark:text-rose-300">
          Controller failed to load — {String((tele.error as any)?.message ?? tele.error)}{" "}
          <button type="button" onClick={() => tele.refresh()} className="underline">retry</button>
        </p>
      )}
      <UnmappedSection
        unmapped={unmapped}
        unmappedAccepted={unmappedAccepted}
        busy={busy}
        setBusy={setBusy}
        setError={setRosterError}
        refreshAll={refreshAll}
      />
      <NeoDoveCampaignSection canManage={canManage} />
      <RehomeEstimateSection
        busy={busy}
        setBusy={setBusy}
        setError={setRosterError}
        refreshAll={refreshAll}
      />
      <ClientSegmentSection refreshAll={refreshAll} />
      <SalesHolidaysSection refreshAll={refreshAll} />
      <HistoryResetSection
        epoch={epoch}
        busy={busy}
        setBusy={setBusy}
        setError={setRosterError}
        refreshAll={refreshAll}
      />
      <ExportDataSection rosterRows={rosterRows} showRisk />
      <RosterSection
        rosterRows={rosterRows}
        busy={busy}
        rosterError={rosterError}
        onAdd={() => { setEditTarget(null); setRosterModalOpen(true); }}
        onEditModal={(t) => { setEditTarget(t); setRosterModalOpen(true); }}
        onDelete={(t) => setConfirmDelete(t)}
        onRestore={restoreTelecaller}
        deletedRows={deletedRows}
        showDeleted={showDeleted}
        onToggleShowDeleted={(o) => {
          setShowDeleted(o);
          if (o) void loadDeleted();
        }}
      />
      <RosterEditModal
        target={editTarget}
        open={rosterModalOpen}
        busy={busy}
        neodoveUsers={(tele.data?.meta?.unmappedNeodoveUsers ?? []) as Array<{ userId: string; userName: string }>}
        onSave={saveRoster}
        onClose={() => setRosterModalOpen(false)}
      />
    </div>
  );
}

function UnmappedSection({
  unmapped,
  unmappedAccepted,
  busy,
  setBusy,
  setError,
  refreshAll,
}: {
  unmapped: DashData["unmapped"];
  unmappedAccepted: DashData["unmappedAccepted"];
  busy: boolean;
  setBusy: (b: boolean) => void;
  setError: (e: string | null) => void;
  refreshAll: () => void;
}) {
  const [regionBy, setRegionBy] = useState<Record<string, RegionId | "">>({});
  const link = async (estimateId: string) => {
    const region = regionBy[estimateId];
    if (!region) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/estimates/${encodeURIComponent(estimateId)}/region`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ region }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || `Link failed (${res.status})`);
      setRegionBy((prev) => { const { [estimateId]: _omit, ...rest } = prev; return rest; });
      refreshAll();
    } catch (e: any) {
      setError(e?.message ?? "Link failed");
    } finally {
      setBusy(false);
    }
  };
  const items = unmapped?.items ?? [];
  return (
    <section className="bg-amber-500/5 border border-amber-500/30 rounded-xl p-5">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div>
          <h3 className="text-lg font-bold mb-1 text-amber-700 dark:text-amber-400">🧭 Unmapped estimates</h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {items.length > 0
              ? "Estimates with no region — sent, accepted or declined — link each one so its region owns the deal."
              : "Every estimate has a region."}
          </p>
        </div>
        <span className="text-xs text-zinc-600 dark:text-zinc-400">
          <span className="font-mono font-bold text-amber-600 dark:text-amber-400">{unmapped?.count ?? 0}</span> unmapped · ₹{fmtNum(unmapped?.value ?? 0)}
        </span>
      </div>
      {items.length > 0 && (
        <div className="space-y-1.5 max-h-80 overflow-y-auto pr-1">
          {items.map((it) => (
            <div key={it.estimateId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/20 bg-white dark:bg-zinc-950 px-3 py-2">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-zinc-900 dark:text-white truncate">{it.customerName ?? "—"}</div>
                <div className="text-[11px] text-zinc-500 dark:text-zinc-400 font-mono truncate">
                  {it.estimateNumber ?? it.estimateId} · ₹{fmtNum(Number(it.total ?? 0))}
                  {it.status ? ` · ${it.status}` : ""}
                  {it.generatedBy ? ` · by ${it.generatedBy}` : ""}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <select
                  value={regionBy[it.estimateId] ?? ""}
                  onChange={(e) => setRegionBy((prev) => ({ ...prev, [it.estimateId]: e.target.value as RegionId }))}
                  className="px-2 py-1.5 text-xs bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded-lg text-zinc-800 dark:text-zinc-200"
                >
                  <option value="">Region…</option>
                  {REGIONS.map((r) => <option key={r.id} value={r.id}>{r.id} · {r.name}</option>)}
                </select>
                <button
                  onClick={() => void link(it.estimateId)}
                  disabled={busy || !regionBy[it.estimateId]}
                  className="text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-500 text-white px-3 py-1.5 disabled:opacity-50"
                >
                  Link
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {unmappedAccepted && unmappedAccepted.count > 0 && (
        <div className="mt-4 pt-4 border-t border-amber-500/20">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <div>
              <h4 className="text-sm font-bold text-amber-700 dark:text-amber-400">Accepted, no lead region</h4>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                Accepted deals outside every region — they add no points or wins until linked.
                Rows without a lead creator stay uncredited even after a region is picked.
              </p>
            </div>
            <span className="text-[11px] text-zinc-600 dark:text-zinc-400 font-mono">
              {unmappedAccepted.count} · ₹{fmtNum(unmappedAccepted.value)} · {fmtNum(unmappedAccepted.points)} pts unlinked
            </span>
          </div>
          <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
            {(unmappedAccepted.items ?? []).map((it) => (
              <div key={it.estimateId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/20 bg-white dark:bg-zinc-950 px-3 py-2">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-zinc-900 dark:text-white truncate flex items-center gap-1.5">
                    {it.customerName ?? "—"}
                    {!it.hasCreator && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full border border-rose-500/30 bg-rose-500/10 text-rose-500 font-bold">No lead creator</span>
                    )}
                  </div>
                  <div className="text-[11px] text-zinc-500 dark:text-zinc-400 font-mono truncate">
                    {it.estimateNumber ?? it.estimateId} · ₹{fmtNum(Number(it.total ?? 0))} · {it.status ?? ""}
                    {it.date ? ` · ${it.date}` : ""}
                    {it.generatedBy ? ` · by ${it.generatedBy}` : ""}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <select
                    value={regionBy[it.estimateId] ?? ""}
                    onChange={(e) => setRegionBy((prev) => ({ ...prev, [it.estimateId]: e.target.value as RegionId }))}
                    className="px-2 py-1.5 text-xs bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded-lg text-zinc-800 dark:text-zinc-200"
                  >
                    <option value="">Region…</option>
                    {REGIONS.map((r) => <option key={r.id} value={r.id}>{r.id} · {r.name}</option>)}
                  </select>
                  <button
                    onClick={() => void link(it.estimateId)}
                    disabled={busy || !regionBy[it.estimateId]}
                    className="text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-500 text-white px-3 py-1.5 disabled:opacity-50"
                  >
                    Link
                  </button>
                </div>
              </div>
            ))}
          </div>
          {unmappedAccepted.count > (unmappedAccepted.items?.length ?? 0) && (
            <p className="text-[10px] text-zinc-500 dark:text-zinc-600 mt-1">
              Showing the first {unmappedAccepted.items?.length ?? 0} of {unmappedAccepted.count}.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

/** History reset — purge close credits + stamp the epoch. Two-step: preview
 *  the exact row count, then confirm. */
function HistoryResetSection({
  epoch,
  busy,
  setBusy,
  setError,
  refreshAll,
}: {
  epoch: string | null;
  busy: boolean;
  setBusy: (b: boolean) => void;
  setError: (e: string | null) => void;
  refreshAll: () => void;
}) {
  const [preview, setPreview] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const run = async (dry: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/telecalling/reset-history${dry ? "?dry=1" : ""}`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || `Reset failed (${res.status})`);
      if (dry) setPreview(Number(body?.deleted?.closeRows ?? 0));
      else {
        setPreview(null);
        setDone(String(body?.epoch ?? "done"));
        setConfirming(false);
        refreshAll();
      }
    } catch (e: any) {
      setError(e?.message ?? "Reset failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold mb-1">🧨 Reset history</h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 max-w-xl">
            Deletes every close-credit ledger row and stamps a new epoch — points and wins
            before the epoch stop counting. Estimates, calls and rosters are untouched.
            {epoch ? ` Current epoch: ${epoch}.` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {preview === null ? (
            <button
              onClick={() => void run(true)}
              disabled={busy}
              className="text-sm font-semibold rounded-lg bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 px-4 py-2 hover:bg-zinc-300 dark:hover:bg-zinc-700 disabled:opacity-50"
            >
              Preview purge
            </button>
          ) : confirming ? (
            <>
              <span className="text-xs font-semibold text-rose-500">Delete {preview} credit row{preview === 1 ? "" : "s"}?</span>
              <button
                onClick={() => { setConfirming(false); setPreview(null); }}
                disabled={busy}
                className="text-sm font-semibold rounded-lg bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 px-4 py-2 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => void run(false)}
                disabled={busy}
                className="text-sm font-bold rounded-lg bg-rose-600 hover:bg-rose-500 text-white px-4 py-2 disabled:opacity-50"
              >
                Reset NOW
              </button>
            </>
          ) : (
            <>
              <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">{preview} close-credit row{preview === 1 ? "" : "s"} would be purged</span>
              <button
                onClick={() => setConfirming(true)}
                className="text-sm font-bold rounded-lg bg-rose-600 hover:bg-rose-500 text-white px-4 py-2"
              >
                Continue
              </button>
            </>
          )}
        </div>
      </div>
      {done && <p className="text-[11px] text-emerald-500 dark:text-emerald-400 mt-2 font-semibold">History reset — new epoch {done}.</p>}
    </section>
  );
}

function RosterSection({
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

// ── Roster add/edit modal ────────────────────────────────────────────────────
// Opens from "Add agent" (create) or a roster card's Edit button. Edits contact
// + role fields, plus the NeoDove link: a dropdown of currently-unlinked
// NeoDove users (the roster phone is the human-verifiable key — compare it
// with the NeoDove User Call Report's Mobile Number column before linking).
// Auto-sync only fills empty link fields and never overwrites a hand link.
function RosterEditModal({
  target,
  open,
  busy,
  neodoveUsers,
  onSave,
  onClose,
}: {
  target: RosterRow | null; // null = creating a new agent
  open: boolean;
  busy: boolean;
  neodoveUsers: Array<{ userId: string; userName: string }>;
  onSave: (updates: { name: string; email: string; phone: string; whatsapp: string; region: string; region2: string; tlLevel: string; type: string; neodove: { userId: string; userName: string } | null }) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [region, setRegion] = useState("");
  const [region2, setRegion2] = useState("");
  const [tlLevel, setTlLevel] = useState("");
  const [staffType, setStaffType] = useState("telecaller");
  const [neoLink, setNeoLink] = useState("");

  const neoKeyOf = (userId: unknown, userName: unknown) =>
    `${String(userId ?? '').trim()}‖${String(userName ?? '').trim()}`;

  // Re-sync on open too: cancelling with dirty edits then re-opening the SAME
  // agent must not resurrect the abandoned values (target identity unchanged).
  useEffect(() => {
    if (!open) return;
    if (target) {
      setName(target.name);
      setEmail(target.email ?? "");
      setPhone(target.phone ?? "");
      setWhatsapp(target.whatsapp ?? "");
      setRegion(target.region ?? "");
      setRegion2(target.region2 ?? "");
      setTlLevel(target.tlLevel ?? "");
      setStaffType(target.type === "field_staff" ? "field_staff" : target.type === "team_lead" ? "team_lead" : "telecaller");
      setNeoLink((target as any)?.neodoveUserName ? neoKeyOf((target as any).neodoveUserId, (target as any).neodoveUserName) : "");
    } else {
      setName(""); setEmail(""); setPhone(""); setWhatsapp("");
      setRegion(""); setRegion2(""); setTlLevel(""); setStaffType("telecaller");
      setNeoLink("");
    }
  }, [target, open]);

  if (!open) return null;

  const isCreate = !target;
  const inputCls = "w-full bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded-lg px-3 py-2 text-sm";
  const field = (label: string, children: React.ReactNode) => (
    <label className="block space-y-1">
      <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">{label}</span>
      {children}
    </label>
  );

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 shadow-2xl p-5 space-y-4" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div>
          <h4 className="font-bold text-zinc-900 dark:text-white">{isCreate ? "Add sales staff" : "Edit sales staff"}</h4>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            {isCreate ? "Create a sales-roster entry — telecaller, field staff or team lead. Link their NeoDove user so calls attribute correctly." : "Update contact details, type, role and the NeoDove link (phone + linked user must belong to the same person)."}
          </p>
        </div>

        <div className="space-y-3">
          {field("Type", (
            <select
              value={staffType}
              onChange={(e) => { setStaffType(e.target.value); }}
              className={inputCls}
            >
              <option value="telecaller">Telecaller — uses the dashboard</option>
              <option value="field_staff">Field Staff — leads logged by sales agents</option>
              <option value="team_lead">Team Lead — owns the reseller target, never listed as a telecaller</option>
            </select>
          ))}
          {field("Name", <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="Full name" />)}
          {field("Email", <input value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} placeholder="Email" />)}
          {field("Phone — the mapping key (must match the NeoDove User Call Report's Mobile Number for this person)", <input value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} placeholder="Phone" />)}
          {field("WhatsApp", <input value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} className={inputCls} placeholder="WhatsApp" />)}

          <div className="grid grid-cols-2 gap-2">
            {field("Region", (
              <select value={region} onChange={(e) => setRegion(e.target.value)} className={inputCls}>
                <option value="">Unmapped</option>
                {REGIONS.map((r) => <option key={r.id} value={r.id}>{r.id} · {r.name}</option>)}
              </select>
            ))}
            {field("Hierarchy", (
              <select value={tlLevel} onChange={(e) => setTlLevel(e.target.value)} className={inputCls}>
                <option value="">—</option>
                <option value="TL1">TL1</option>
                <option value="TL2">TL2</option>
              </select>
            ))}
          </div>
          {staffType === "team_lead" && tlLevel === "TL1" && field("Second region (Team Lead covers two)", (
            <select value={region2} onChange={(e) => setRegion2(e.target.value)} className={inputCls}>
              <option value="">Pick second region…</option>
              {REGIONS.filter((r) => r.id !== region).map((r) => <option key={r.id} value={r.id}>{r.id} · {r.name}</option>)}
            </select>
          ))}
          {staffType === "team_lead" && tlLevel === "TL1" && region && region2 && region === region2 && (
            <p className="text-[11px] rounded-lg border border-rose-500/25 bg-rose-500/5 px-3 py-2 text-rose-600 dark:text-rose-400">
              A TL1 needs two DIFFERENT regions — pick a second region different from the first.
            </p>
          )}

          {staffType === "team_lead" && (
            <p className="text-[11px] rounded-lg border border-indigo-500/25 bg-indigo-500/5 px-3 py-2 text-indigo-700 dark:text-indigo-300">
              Team Leads are <b>not telecallers</b> — they never appear in the region staff rail. They own the ₹1L/day <b>reseller</b> target across their two regions (TL strip); every reseller sale by their telecallers counts into it.
            </p>
          )}

          {staffType === "field_staff" && (
            <p className="text-[11px] rounded-lg border border-sky-500/25 bg-sky-500/5 px-3 py-2 text-sky-700 dark:text-sky-400">
              Field staff never use the dashboard and never close. Sales agents log their enquiries with source <b>Field Staff</b>; the lead, region and 20% generator credit go to them. Set a region below so their estimates land in the right region.
            </p>
          )}

          {/* NeoDove link — hand-picked here; auto-sync never overwrites it.
              Compare the roster phone above with the NeoDove User Call Report's
              Mobile Number column before linking. */}
          {field("NeoDove user", (
            <select
              value={neoLink}
              onChange={(e) => setNeoLink(e.target.value)}
              className={inputCls}
            >
              <option value="">No link</option>
              {target && (target as any)?.neodoveUserName && !neodoveUsers.some((u) => neoKeyOf(u.userId, u.userName) === neoKeyOf((target as any).neodoveUserId, (target as any).neodoveUserName)) && (
                <option value={neoKeyOf((target as any).neodoveUserId, (target as any).neodoveUserName)}>
                  ✓ {(target as any).neodoveUserName} (currently linked)
                </option>
              )}
              {neodoveUsers.map((u) => (
                <option key={neoKeyOf(u.userId, u.userName)} value={neoKeyOf(u.userId, u.userName)}>
                  {u.userName || "(no name)"}{u.userId ? ` · ${String(u.userId).slice(0, 8)}…` : ""}
                </option>
              ))}
            </select>
          ))}
          {!isCreate && (target as any)?.neodoveUserName && (
            <p className="text-[11px] rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-3 py-2 text-zinc-500 dark:text-zinc-400">
              Currently linked to NeoDove user <b>{(target as any).neodoveUserName}</b>
              {(target as any)?.neodoveUserId ? ` (id: ${String((target as any).neodoveUserId).slice(0, 8)}…)` : ""}.
              Pick another user to re-link, or “No link” to unlink.
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} disabled={busy}
            className="px-4 py-2 text-sm rounded-lg bg-zinc-100 dark:bg-zinc-800 font-semibold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:opacity-50">
            Cancel
          </button>
          <button
            onClick={() => {
              const parts = neoLink ? String(neoLink).split('‖') : [];
              onSave({
                name, email, phone, whatsapp, region,
                region2: staffType === "team_lead" && tlLevel === "TL1" ? region2 : "",
                tlLevel, type: staffType,
                neodove: parts.length === 2 && (parts[0] || parts[1])
                  ? { userId: parts[0], userName: parts[1] }
                  : null,
              });
            }}
            disabled={busy || !name.trim() || (staffType === "team_lead" && tlLevel === "TL1" && !!region && !!region2 && region === region2)}
            className="px-4 py-2 text-sm rounded-lg font-semibold text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50">
            {busy ? "Saving…" : isCreate ? "Add" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
// Exports the FULL live telecalling payload as one CSV download — performance
// (leaderboard), assignments (conversion summary) and risk (open pipeline)
// stacked as sections. Filters: period + telecaller sub-set (all / follow-up
// specialists / lead-gen only / a specific agent). Generated in the browser
// from the same endpoint the dashboards use — no new backend needed.

function downloadCsv(filename: string, rows: (string | number | null | undefined)[][]) {
  const esc = (v: string | number | null | undefined) => {
    const s = v === null || v === undefined ? "" : String(v);
    // Formula-injection guard: a cell starting with = + - @ (after optional
    // whitespace/quote) executes on open in Excel/Sheets — prefix with a tab.
    const safe = /^[ \t]*[=+\-@]/.test(s) ? `\t${s}` : s;
    return /[",\n\t]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const csv = rows.map((r) => r.map(esc).join(",")).join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

const EXPORT_PERIODS: { key: string; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "week", label: "This Week" },
  { key: "lastweek", label: "Last Week" },
  { key: "month", label: "This Month" },
  { key: "lastmonth", label: "Last Month" },
  { key: "year", label: "This Year" },
  { key: "lastyear", label: "Last Year" },
];

function ExportDataSection({ rosterRows, showRisk }: { rosterRows: RosterRow[]; showRisk: boolean }) {
  const [period, setPeriod] = useState("week");
  const [subset, setSubset] = useState("all");
  const [days, setDays] = useState("30");
  const [loading, setLoading] = useState(false);
  const [loadingEst, setLoadingEst] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const subsetRows = () => {
    if (subset === "followups") return rosterRows.filter((r) => r.assignEstimateFollowUps);
    if (subset === "leadgen") return rosterRows.filter((r) => !r.assignEstimateFollowUps);
    if (subset !== "all" && subset !== "") return rosterRows.filter((r) => r.id === subset);
    return rosterRows;
  };

  const doExport = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/automations/telecalling/data?period=${period}&daily=1`);
      if (!res.ok) throw new Error(`Failed to load telecalling data (HTTP ${res.status})`);
      const data: DashData = adaptDashData(await res.json());
      const wanted = subsetRows();
      const wantedIds = new Set(wanted.map((r) => r.id));

      const stamp = new Date().toISOString().slice(0, 10);
      const periodLabel = data.meta?.periodLabel ?? period;
      const base = `founder-os_all_${periodLabel.replace(/\s+/g, "_").toLowerCase()}_${stamp}.csv`;
      const rows: (string | number | null | undefined)[][] = [];

      // Section 1 — Performance (per-telecaller leaderboard)
      rows.push(["═══ PERFORMANCE (LEADERBOARD) ═══"]);
      rows.push([
        "Rank", "Sales staff", "Type", "Follow-ups", "NeoDove user",
        "Open (region)", "Won", "Conv %", "Pipeline ₹", "Closed ₹",
        "Calls Attempted", "Calls Connected", "Calls %", "Talk (min)",
        "Leads Generated", "Leads %", "Score",
        ...(showRisk ? ["At Risk", "Zombie"] : []),
      ]);
      data.leaderboard
        .filter((r) => wantedIds.has(r.id))
        .forEach((r, i) => {
          rows.push([
            i + 1,
            r.name,
            r.type === "field_staff" ? "Field Staff" : r.type === "team_lead" ? "Team Lead" : "Telecaller",
            r.type === "field_staff" ? "n/a" : r.type === "team_lead" ? "reseller target" : r.assignEstimateFollowUps ? "yes" : "no",
            r.neodoveUserName,
            r.conversion.assigned,
            r.conversion.won,
            r.conversion.conversionRate,
            r.conversion.pipelineValue,
            r.conversion.acceptedValue ?? r.conversion.estimatedConversion?.value ?? 0,
            r.generation.callsAttempted,
            r.generation.callsConnected,
            r.generation.connectedPct,
            Math.round((r.generation.talkTimeSec ?? 0) / 60),
            r.generation.leadsGenerated,
            r.generation.leadsPct,
            r.score,
            ...(showRisk ? [r.risk?.atRisk ?? 0, r.risk?.zombie ?? 0] : []),
          ]);
        });
      rows.push([]);

      // Section 2 — Assignments (conversion summary)
      rows.push(["═══ ASSIGNMENTS (CONVERSION) ═══"]);
      rows.push(["Sales staff", "Type", "Open (region)", "Won", "Conv %", "Pipeline ₹", "Closed ₹"]);
      data.leaderboard
        .filter((r) => wantedIds.has(r.id))
        .forEach((r) => {
          rows.push([
            r.name,
            r.type === "field_staff" ? "Field Staff" : r.type === "team_lead" ? "Team Lead" : "Telecaller",
            r.conversion.assigned,
            r.conversion.won,
            r.conversion.conversionRate,
            r.conversion.pipelineValue,
            r.conversion.acceptedValue ?? r.conversion.estimatedConversion?.value ?? 0,
          ]);
        });
      rows.push([]);

      // Section 3 — Risk (open pipeline, informational only).
      if (showRisk) {
      rows.push(["═══ RISK (OPEN PIPELINE — INFORMATIONAL) ═══"]);
      rows.push([
        "Estimate", "Customer", "Lead owner", "Total ₹", "Risk",
        "Last Comment", "Stale (h)", "Reason",
      ]);
      (data.risk?.atRisk ?? [])
        .filter((r) => !wantedIds.size || (r.telecallerId && wantedIds.has(r.telecallerId)))
        .forEach((r) => {
          rows.push([
            r.estimateNumber ?? r.estimateId,
            r.customerName,
            r.telecallerName,
            r.total,
            r.risk,
            r.lastCommentDate,
            r.staleHours,
            r.snatchReason ?? r.reasoning,
          ]);
        });
      }

      // Section 4 — Daily (per-day × per-agent: every tag, call, lead)
      rows.push([]);
      rows.push(["═══ DAILY (DAY × AGENT — MIS DETAIL) ═══"]);
      rows.push(["NOTE: Won day = conversion day from the close ledger (20% generator / 80% closer)."]);
      if (data.dailyError) {
        rows.push([`Daily unavailable: ${data.dailyError}`]);
      } else {
        rows.push([
          "Date", "Day", "Telecaller", "Region",
          "Won", "Closed ₹", "Closed Estimates",
          "Calls Attempted", "Calls Connected", "Calls Not Conn.", "Talk (min)",
          "Leads Generated", "Leads Converted", "Score",
        ]);
        const daily = (data.daily ?? []).filter((d) => !wantedIds.size || wantedIds.has(d.telecallerId));
        const byDate = new Map<string, DailyRow[]>();
        for (const d of daily) {
          const arr = byDate.get(d.date) ?? [];
          arr.push(d);
          byDate.set(d.date, arr);
        }
        for (const [date, list] of [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
          const team = {
            won: 0, closedValue: 0, callsAttempted: 0, callsConnected: 0, callsNotConnected: 0,
            talkTimeMin: 0, leadsGenerated: 0, leadsConverted: 0, score: 0,
          };
          const closedTags: string[] = [];
          const regionTags = new Set<string>();
          for (const d of list) {
            team.won += d.won; team.closedValue += d.closedValue;
            team.callsAttempted += d.callsAttempted;
            team.callsConnected += d.callsConnected; team.callsNotConnected += d.callsNotConnected;
            team.talkTimeMin += d.talkTimeMin; team.leadsGenerated += d.leadsGenerated;
            team.leadsConverted += d.leadsConverted; team.score += d.score;
            if (d.closedEstimates) closedTags.push(`${d.telecallerName}: ${d.closedEstimates}`);
            rows.push([
              d.date, d.weekday, d.telecallerName,
              (d as any).region ?? "",
              d.won, d.closedValue, d.closedEstimates,
              d.callsAttempted, d.callsConnected, d.callsNotConnected, d.talkTimeMin,
              d.leadsGenerated, d.leadsConverted, d.score,
            ]);
          }
          rows.push([
            date, list[0]?.weekday ?? "", "— TEAM —", [...regionTags].join(" "),
            team.won, team.closedValue, closedTags.join(" ‖ "),
            team.callsAttempted, team.callsConnected, team.callsNotConnected, team.talkTimeMin,
            team.leadsGenerated, team.leadsConverted, team.score,
          ]);
        }
        if (daily.length === 0) rows.push(["No daily rows (empty range or single-day period)."]);
      }

      downloadCsv(base, rows);
    } catch (e: any) {
      setError(e?.message ?? "Export failed");
    } finally {
      setLoading(false);
    }
  };

  // Per-estimate MIS export — one row per estimate in the last N days (by
  // estimate/sent date), all statuses (sent/accepted/declined/confirmed), with
  // full lead detail. "Converted By" shows ONLY the lead generator's name
  // (from the +100 close ledger, which credits Estimate.createdBy) on
  // accepted/confirmed rows — blank on declined and still-open rows, by rule.
  const doExportEstimates = async () => {
    setLoadingEst(true);
    setError(null);
    try {
      const n = Math.min(365, Math.max(1, parseInt(days, 10) || 30));
      // IST day N days ago (matches the backend ledger's IST day strings).
      const istNow = new Date(Date.now() + 5.5 * 3600 * 1000);
      const since = new Date(Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate() - n))
        .toISOString().slice(0, 10);
      const dayOf = (d: any): string => {
        const s = String(d ?? "");
        const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
        if (m) return m[1];
        const t = Date.parse(s);
        return Number.isNaN(t) ? "" : new Date(t).toISOString().slice(0, 10);
      };
      const [estRes, convRes] = await Promise.all([
        fetch("/api/estimates"),
        fetch(`/api/automations/telecalling/data?converters=1&since=${since}`),
      ]);
      if (!estRes.ok) throw new Error(`Failed to load estimates (HTTP ${estRes.status})`);
      if (!convRes.ok) throw new Error(`Failed to load converters (HTTP ${convRes.status})`);
      const estPayload = await estRes.json();
      const convPayload = await convRes.json();
      const converters: Record<string, { name: string; day: string }> = convPayload?.converters ?? {};
      const wanted = new Set(["sent", "accepted", "declined", "confirmed"]);
      const list: any[] = (estPayload?.estimates ?? []).filter(
        (e: any) => wanted.has(String(e?.status ?? "").toLowerCase()) && dayOf(e?.date) >= since
      );
      list.sort((a, b) => dayOf(a?.date).localeCompare(dayOf(b?.date))
        || String(a?.estimateNumber ?? "").localeCompare(String(b?.estimateNumber ?? "")));

      const stamp = new Date().toISOString().slice(0, 10);
      const rows: (string | number | null | undefined)[][] = [];
      rows.push([`ESTIMATES — LAST ${n} DAYS (SINCE ${since}) — ${list.length} ROWS`]);
      rows.push([
        "Estimate", "Sent", "Enq", "Customer", "Contact", "Mobile",
        "Loc", "Source", "By", "Status", "Total ₹", "Converted By",
      ]);
      for (const e of list) {
        const status = String(e?.status ?? "").toLowerCase();
        const won = status === "accepted" || status === "confirmed";
        rows.push([
          e?.estimateNumber ?? e?.estimateId,
          dayOf(e?.date),
          e?.enquiryNumber ?? "",
          e?.customerName ?? "",
          e?.contactName ?? "",
          e?.contactPhone ?? "",
          e?.location ?? "",
          e?.sourceLead ?? "",
          e?.leadOf ?? "",
          status,
          e?.total ?? 0,
          won ? (converters[String(e?.estimateId ?? "")]?.name ?? "") : "",
        ]);
      }
      if (list.length === 0) rows.push(["No estimates in this window."]);
      downloadCsv(`founder-os_estimates_last_${n}days_${stamp}.csv`, rows);
    } catch (e: any) {
      setError(e?.message ?? "Estimates export failed");
    } finally {
      setLoadingEst(false);
    }
  };

  return (
    <section className="bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5">
      <h3 className="text-lg font-bold mb-1">📤 Export Data</h3>
      <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-4">
        Download the FULL telecalling payload as one CSV — performance (leaderboard), assignments (conversion),
        {showRisk ? " risk (open pipeline)," : ""} daily (day × agent: accepted/declined tags, calls, leads) sections.
        Generated client-side from the live dashboard endpoint. The estimates download below is the
        per-estimate MIS ledger for the last N days (by sent date) — contact, location, source, lead
        creator and Converted By (lead generator only; blank on declined/open rows).
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs font-semibold text-zinc-600 dark:text-zinc-400">
          Period
          <select value={period} onChange={(e) => setPeriod(e.target.value)}
            className="px-3 py-1.5 text-xs bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded-lg text-zinc-800 dark:text-zinc-200 cursor-pointer focus:outline-none">
            {EXPORT_PERIODS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-zinc-600 dark:text-zinc-400">
          Telecallers
          <select value={subset} onChange={(e) => setSubset(e.target.value)}
            className="px-3 py-1.5 text-xs bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded-lg text-zinc-800 dark:text-zinc-200 cursor-pointer focus:outline-none">
            <option value="all">All</option>
            <option value="followups">Follow-up specialists</option>
            <option value="leadgen">Lead-gen only</option>
            {rosterRows.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </label>
        <button onClick={() => void doExport()} disabled={loading}
          className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold rounded-lg px-4 py-2 disabled:opacity-60">
          {loading ? "Exporting…" : "⬇ Download CSV"}
        </button>
        {error && <span className="text-xs text-rose-500">{error}</span>}
      </div>
      <div className="flex flex-wrap items-end gap-3 mt-4 pt-4 border-t border-zinc-200 dark:border-zinc-800">
        <label className="flex flex-col gap-1 text-xs font-semibold text-zinc-600 dark:text-zinc-400">
          Last N days (by sent date)
          <input value={days} onChange={(e) => setDays(e.target.value)} inputMode="numeric" placeholder="30"
            className="w-24 px-3 py-1.5 text-xs bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded-lg text-zinc-800 dark:text-zinc-200 focus:outline-none" />
        </label>
        <button onClick={() => void doExportEstimates()} disabled={loadingEst}
          className="bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold rounded-lg px-4 py-2 disabled:opacity-60">
          {loadingEst ? "Exporting…" : "⬇ Download Estimates CSV"}
        </button>
        {error && <span className="text-xs text-rose-500">{error}</span>}
      </div>
      <p className="text-[11px] text-zinc-500 dark:text-zinc-600 mt-2">
        Exports use their own period picker above (independent of the Dashboard
        leaderboard filter) plus the telecaller filter. Deleted agents and unassigned estimates
        are excluded. The daily section covers up to 93 days (year periods export the other sections only).
      </p>
    </section>
  );
}
