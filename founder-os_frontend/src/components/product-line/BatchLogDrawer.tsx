"use client";

// BatchLogDrawer.tsx — every bulk paste, newest first.
//
// A paste is a unit of work: it can be inspected ("what did it reject?") and
// undone ("delete every rate that paste added") without touching anything that
// was entered by hand. Deleting keeps the log row with status `deleted`, so the
// trace survives the undo (founder decision 2026-11-23 v3).
import React, { useState } from "react";
import { AlertTriangle, ChevronDown, ClipboardPaste, History, Trash2, Users } from "lucide-react";
import { ConfirmDialog, Drawer } from "@/components/ui";
import { ghostBtn, iconBtn, panel, shortDate } from "../product-line-dashboard/helpers";
import { productLineApi } from "@/product-line/api";
import { useBatches } from "@/product-line/hooks";
import { DrawerSkeleton } from "./Skeletons";

const errMsg = (e: unknown) => String((e as any)?.message ?? "request failed");

interface Props {
  canEdit: boolean;
  onClose: () => void;
  onChanged: () => void;
  /** Jump to the rates sheet filtered to this batch. */
  onViewRates: (batchId: string) => void;
}

export function BatchLogDrawer({ canEdit, onClose, onChanged, onViewRates }: Props) {
  const { batches, loading } = useBatches();
  const [openId, setOpenId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const target = batches.find((b) => b.id === confirmId) ?? null;

  const remove = async () => {
    if (!confirmId) return;
    setBusy(true);
    setErr(null);
    setNote(null);
    try {
      const out = await productLineApi.deleteBatch(confirmId);
      setNote(`Deleted ${out.deleted} rate${out.deleted === 1 ? "" : "s"} from that batch`);
      setConfirmId(null);
      onChanged();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      title="Batch log"
      subtitle={`${batches.length} bulk paste${batches.length === 1 ? "" : "s"} · newest first`}
      onClose={onClose}
      width="max-w-3xl"
    >
      <div className="space-y-3">
        {err ? <div className="text-xs font-semibold text-[var(--color-danger)] bg-[var(--bg-input)] rounded-xl px-3 py-2">{err}</div> : null}
        {note ? <div className="text-xs font-semibold text-emerald-600 bg-[var(--bg-input)] rounded-xl px-3 py-2">{note}</div> : null}

        {loading && !batches.length ? <DrawerSkeleton /> : null}

        {!loading && !batches.length ? (
          <div className="rounded-xl border border-dashed border-[var(--border-card)] p-8 text-center">
            <History size={20} className="mx-auto text-[var(--text-tertiary)]" />
            <p className="mt-2 text-xs font-semibold text-[var(--text-secondary)]">No bulk pastes yet</p>
            <p className="text-[10.5px] text-[var(--text-tertiary)]">
              Every “Paste AI rates” import lands here as one batch you can review or undo.
            </p>
          </div>
        ) : null}

        <div className="space-y-2">
          {batches.map((b) => {
            const open = openId === b.id;
            const deleted = b.status === "deleted";
            return (
              <div key={b.id} className={`${panel} ${deleted ? "opacity-70" : ""}`}>
                <div className="flex items-center gap-2 px-3 py-2">
                  <span className={`shrink-0 inline-flex items-center justify-center h-7 w-7 rounded-lg ${deleted ? "bg-[var(--bg-input)] text-[var(--text-tertiary)]" : "bg-brand-indigo/10 text-brand-indigo"}`}>
                    <ClipboardPaste size={13} />
                  </span>
                  <button type="button" className="flex-1 min-w-0 text-left" onClick={() => setOpenId(open ? null : b.id)}>
                    <span className="block text-[12.5px] font-extrabold text-[var(--text-primary)] truncate">
                      {b.label || (b.source === "manual" ? "Manual entry" : "AI paste")}
                      {deleted ? <span className="ml-1.5 text-[9px] font-bold uppercase text-[var(--color-danger)]">deleted</span> : null}
                    </span>
                    <span className="block text-[10px] text-[var(--text-tertiary)]">
                      {shortDate(b.createdAt)}
                      {b.actorName ? ` · ${b.actorName}` : ""}
                      {" · "}
                      <span className="text-emerald-600 font-semibold">{b.createdCount} created</span>
                      {b.failedCount ? <span className="text-[var(--color-danger)] font-semibold"> · {b.failedCount} rejected</span> : null}
                      {b.liveCount != null && !deleted ? ` · ${b.liveCount} live` : ""}
                    </span>
                  </button>
                  <span className="hidden md:flex items-center gap-1 text-[10px] text-[var(--text-tertiary)]">
                    <Users size={10} /> {b.vendorNames.length}
                  </span>
                  <button type="button" className={iconBtn} onClick={() => setOpenId(open ? null : b.id)} aria-label="Details">
                    <ChevronDown size={14} className={open ? "rotate-180 transition-transform" : "transition-transform"} />
                  </button>
                </div>

                {open ? (
                  <div className="px-3 pb-3 pt-1 border-t border-[var(--border-card)]/60 space-y-2">
                    <div className="flex flex-wrap gap-1">
                      {b.vendorNames.slice(0, 8).map((v) => (
                        <span key={v} className="px-1.5 py-0.5 rounded-md bg-[var(--bg-input)] text-[10px] font-semibold text-[var(--text-secondary)]">{v}</span>
                      ))}
                      {b.vendorNames.length > 8 ? (
                        <span className="text-[10px] text-[var(--text-tertiary)]">+{b.vendorNames.length - 8}</span>
                      ) : null}
                    </div>
                    <div className="text-[10px] font-mono text-[var(--text-tertiary)]">{b.id}</div>
                    {b.failures.length ? (
                      <div className="rounded-lg border border-[var(--border-card)] divide-y divide-[var(--border-card)]/60 max-h-40 overflow-y-auto">
                        {b.failures.map((f) => (
                          <div key={`${f.row}-${f.error}`} className="px-2 py-1">
                            <span className="text-[10px] font-bold text-[var(--text-primary)]">Row {f.row}</span>
                            {f.product ? <span className="ml-1 text-[9px] font-mono text-[var(--text-tertiary)]">{f.product}</span> : null}
                            <span className="block text-[10px] text-[var(--color-danger)]">{f.error}</span>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className={ghostBtn}
                        disabled={deleted || !(b.liveCount ?? b.createdCount)}
                        onClick={() => onViewRates(b.id)}
                      >
                        View rates
                      </button>
                      {canEdit ? (
                        <button
                          type="button"
                          className={`${ghostBtn} ml-auto text-[var(--color-danger)]`}
                          disabled={deleted || !(b.liveCount ?? b.createdCount) || busy}
                          onClick={() => { setErr(null); setConfirmId(b.id); }}
                        >
                          <Trash2 size={13} /> Delete batch
                        </button>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>

        <p className="text-[10px] text-[var(--text-tertiary)]">
          Deleting a batch removes only the rates it created — quotes entered by hand are untouched, and the log
          row stays as a record.
        </p>

        <div className="flex justify-end">
          <button type="button" className={ghostBtn} onClick={onClose}>Done</button>
        </div>

        <ConfirmDialog
          open={!!confirmId}
          title="Delete this batch?"
          message={
            <>
              This removes <b>{target?.liveCount ?? target?.createdCount ?? 0}</b> vendor rate
              {(target?.liveCount ?? target?.createdCount ?? 0) === 1 ? "" : "s"} created by
              “{target?.label || "AI paste"}” on {target ? shortDate(target.createdAt) : ""}.
              Rates entered by hand are not touched. The log entry stays as a record.
            </>
          }
          confirmLabel="Delete rates"
          busy={busy}
          onConfirm={() => void remove()}
          onCancel={() => setConfirmId(null)}
        />
      </div>
    </Drawer>
  );
}
