"use client";

import { useState, useCallback, useEffect } from "react";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { useLiveQuery } from "@/hooks/useLiveData";
import { useAuth } from "@/auth/AuthContext";
import NeoDoveCampaignSection from "@/components/telecalling/NeoDoveCampaignSection";
import RehomeEstimateSection from "@/components/telecalling/RehomeEstimateSection";
import SalesHolidaysSection from "@/components/telecalling/SalesHolidaysSection";
import ClientSegmentSection from "@/components/telecalling/ClientSegmentSection";
import { type RosterRow } from "./TelecallingDashboard";
import { workspaceDataUrl } from "@/workspaces/api";
import { hasSalesManagerAccess, TELECALLING_EVENTS } from "./sales-controller-panel/helpers";
import { UnmappedSection } from "./sales-controller-panel/UnmappedSection";
import { HistoryResetSection } from "./sales-controller-panel/HistoryResetSection";
import { ExportDataSection } from "./sales-controller-panel/ExportDataSection";
import { RosterSection } from "./sales-controller-panel/RosterSection";
import { RosterEditModal } from "./sales-controller-panel/RosterEditModal";

// Pieces split into ./sales-controller-panel/ (importable on their own); re-exported for compat.
export { hasSalesManagerAccess } from "./sales-controller-panel/helpers";

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
      const res = await fetch(workspaceDataUrl("telecalling"));
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
