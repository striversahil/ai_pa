"use client";

import React, { useMemo, useState } from "react";
import Modal from "../Modal";
import {
  createChartPosition, updateChartPosition, type OrgChartPosition, type OrgWing,
} from "@/org/api";
import { LOGIN_POSITION_OPTIONS } from "@/hr/organization";

const WINGS: OrgWing[] = ["Sales", "Marketing", "Operations"];

export default function ChartPositionModal({
  position, positions, onClose, onSaved,
}: {
  position?: OrgChartPosition | null;
  positions: OrgChartPosition[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = !!position;
  const top = positions.find((p) => p.isTop) ?? null;
  const [title, setTitle] = useState(position?.title ?? "");
  const [department, setDepartment] = useState(position?.department ?? "");
  const [wing, setWing] = useState<OrgWing>(position?.wing ?? "Operations");
  const [reportsToId, setReportsToId] = useState(position?.reportsToId ?? top?.id ?? "");
  const [isHead, setIsHead] = useState(!!position?.isHead);
  const [loginPosition, setLoginPosition] = useState(position?.loginPosition ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const descendants = useMemo(() => {
    const blocked = new Set<string>();
    if (!position) return blocked;
    const walk = (id: string) => {
      for (const p of positions) {
        if (p.reportsToId !== id || blocked.has(p.id)) continue;
        blocked.add(p.id);
        walk(p.id);
      }
    };
    walk(position.id);
    return blocked;
  }, [positions, position]);

  const parentOptions = useMemo(
    () => positions.filter((p) => p.id !== position?.id && !descendants.has(p.id)).sort((a, b) => a.order - b.order),
    [positions, position?.id, descendants],
  );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (title.trim().length < 2) { setErr("Position title needs at least 2 characters."); return; }
    if (!editing && !reportsToId) { setErr("Pick who this position reports to."); return; }
    if (isHead && top && reportsToId !== top.id) { setErr("A department head must report to the top position."); return; }
    setBusy(true); setErr(null);
    try {
      const body = {
        title: title.trim(),
        department: department.trim() || null,
        wing,
        reportsToId: position?.isTop ? null : (reportsToId || null),
        isHead: position?.isTop ? false : isHead,
        loginPosition: loginPosition || null,
      };
      if (editing) await updateChartPosition(position!.id, body);
      else await createChartPosition(body);
      onSaved(); onClose();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Save failed");
    } finally { setBusy(false); }
  };

  const field = "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-950";
  const label = "mb-1 block text-[11px] font-bold uppercase tracking-wide text-zinc-500";

  return (
    <Modal
      title={editing ? "Edit chart position" : "Add chart position"}
      subtitle={position?.isTop ? "The top position cannot be renamed, moved or deleted." : "Reporting lines and head flags update the live chart immediately."}
      onClose={onClose}
    >
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className={label}>Position title</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} autoFocus
            disabled={position?.isTop} placeholder="e.g. Sales Executive" className={field} />
          {position?.isTop && <p className="mt-1 text-[10px] text-amber-600">Top position titles are fixed.</p>}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={label}>Department</label>
            <input value={department} onChange={(e) => setDepartment(e.target.value)} maxLength={80}
              placeholder="e.g. Sales, Accounts, Operations & Support" className={field} />
          </div>
          <div>
            <label className={label}>Wing</label>
            <select value={wing} onChange={(e) => setWing(e.target.value as OrgWing)} className={field}>
              {WINGS.map((w) => <option key={w} value={w}>{w}</option>)}
            </select>
          </div>
        </div>
        {!position?.isTop && (
          <>
            <div>
              <label className={label}>Reports to</label>
              <select value={reportsToId} onChange={(e) => setReportsToId(e.target.value)} className={field}>
                <option value="">Pick parent position…</option>
                {parentOptions.map((p) => <option key={p.id} value={p.id}>{p.title}{p.department ? " · " + p.department : ""}</option>)}
              </select>
            </div>
            <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
              <input type="checkbox" checked={isHead} onChange={(e) => {
                setIsHead(e.target.checked);
                if (e.target.checked && top) setReportsToId(top.id);
              }} />
              Department head (must report to the top position)
            </label>
          </>
        )}
        <div>
          <label className={label}>Dashboard login position (optional)</label>
          <select value={loginPosition} onChange={(e) => setLoginPosition(e.target.value)} className={field}>
            <option value="">No dashboard login — org label only</option>
            {LOGIN_POSITION_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.key} · {o.label}</option>)}
          </select>
          <p className="mt-1 text-[10px] text-zinc-500">This only suggests a position when a role is mapped. It never grants access.</p>
        </div>
        {err && <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs font-semibold text-rose-500">{err}</div>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} disabled={busy}
            className="rounded-lg bg-zinc-100 px-4 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-200 disabled:opacity-50 dark:bg-zinc-800 dark:text-zinc-300">Cancel</button>
          <button type="submit" disabled={busy}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-500 disabled:opacity-50">
            {busy ? "Saving…" : editing ? "Save position" : "Add position"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
