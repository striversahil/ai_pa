"use client";

import React, { useMemo, useState } from "react";
import { useLiveDashboard } from "@/hooks/useLiveData";
import { fetchAssets, listMembers, removeAsset, removePositionAsset, saveAsset } from "@/hr/api";
import type { HrAsset, HrAssetPosition, HrPositionAsset } from "@/hr/assets";
import type { HrMember } from "@/hr/types";
import { todayIST } from "@/hr/format";
import AssetModal from "./AssetModal";
import StandardModal from "./StandardModal";

const STATUS_STYLE: Record<HrAsset["status"], string> = {
  assigned: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  in_repair: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  returned: "bg-zinc-500/15 text-zinc-500",
  lost: "bg-rose-500/15 text-rose-500",
};
const STATUS_LABEL: Record<HrAsset["status"], string> = {
  assigned: "Assigned", in_repair: "In repair", returned: "Returned", lost: "Lost",
};

async function fetchMembers(): Promise<HrMember[]> {
  return listMembers();
}

export default function AssetsTab({ canManage }: { canManage: boolean }) {
  const dash = useLiveDashboard(async () => {
    const [data, members] = await Promise.all([fetchAssets(), fetchMembers()]);
    return { ...data, members };
  }, { events: ["human-resources"], pollMs: 60000 });
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [typeId, setTypeId] = useState("");
  const [editing, setEditing] = useState<HrAsset | null | undefined>(undefined);
  const [standardEdit, setStandardEdit] = useState<HrPositionAsset | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const assets = dash.data?.assets ?? [];
  const members = dash.data?.members ?? [];
  const types = dash.data?.assetTypes ?? [];
  const positions = dash.data?.positions ?? [];

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return assets.filter((a) => {
      if (status && a.status !== status) return false;
      if (typeId && a.assetTypeId !== typeId) return false;
      if (!q) return true;
      return [a.memberName, a.memberDesignation, a.assetTypeName, a.label, a.identifier, a.specs]
        .some((v) => String(v ?? "").toLowerCase().includes(q));
    });
  }, [assets, query, status, typeId]);

  const stats = useMemo(() => ({
    total: assets.length,
    assigned: assets.filter((a) => a.status === "assigned").length,
    repair: assets.filter((a) => a.status === "in_repair").length,
    standards: positions.reduce((n, p) => n + p.standards.length, 0),
  }), [assets, positions]);

  const quickReturn = async (asset: HrAsset) => {
    setBusy(true); setErr(null);
    try {
      await saveAsset({ status: "returned", returnedOn: todayIST() }, asset.id);
      dash.refresh();
    } catch (e) { setErr(e instanceof Error ? e.message : "Could not mark returned"); }
    finally { setBusy(false); }
  };

  const remove = async (asset: HrAsset) => {
    if (!confirm("Remove " + asset.assetTypeName + " from " + (asset.memberName || "this employee") + "?")) return;
    setBusy(true); setErr(null);
    try { await removeAsset(asset.id); dash.refresh(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Remove failed"); }
    finally { setBusy(false); }
  };

  const removeStandard = async (position: HrAssetPosition, id: string) => {
    if (!confirm("Remove this asset from " + position.title + "'s standard kit?")) return;
    setBusy(true); setErr(null);
    try { await removePositionAsset(id); dash.refresh(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Remove failed"); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold">Assets</h3>
          <p className="mt-1 max-w-2xl text-sm text-zinc-500">Who holds which laptop, phone or SIM, with configuration. Role standards show the expected kit for each chart position.</p>
        </div>
        {canManage && (
          <div className="flex gap-2">
            <button onClick={() => setStandardEdit(null)} className="rounded-lg bg-zinc-100 px-3 py-2 text-xs font-bold text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300">+ Role standard</button>
            <button onClick={() => setEditing(null)} className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-bold text-white hover:bg-indigo-500">+ Assign asset</button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ["Total assets", stats.total], ["Assigned", stats.assigned], ["In repair", stats.repair], ["Role standards", stats.standards],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
            <div className="text-[10px] font-extrabold uppercase tracking-wide text-zinc-400">{label}</div>
            <div className="mt-0.5 text-xl font-black">{value}</div>
          </div>
        ))}
      </div>

      {err && <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-3 text-sm text-rose-500">{err}</div>}
      {dash.loading && !dash.data && <div className="py-10 text-center text-sm text-zinc-500 animate-pulse">Loading assets…</div>}
      {Boolean(dash.error) && <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-3 text-sm text-rose-500">{String(dash.error)}</div>}

      {dash.data && (
        <div className="flex flex-wrap items-center gap-2">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search employee, asset or serial…"
            className="min-w-[220px] flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs outline-none focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-950" />
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-lg border border-zinc-300 bg-white px-2.5 py-2 text-xs dark:border-zinc-700 dark:bg-zinc-950">
            <option value="">All status</option>
            {Object.entries(STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <select value={typeId} onChange={(e) => setTypeId(e.target.value)} className="rounded-lg border border-zinc-300 bg-white px-2.5 py-2 text-xs dark:border-zinc-700 dark:bg-zinc-950">
            <option value="">All types</option>
            {types.filter((t) => t.active).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <button onClick={() => dash.refresh()} className="rounded-lg bg-zinc-100 px-3 py-2 text-xs font-bold text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300">Refresh</button>
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-zinc-50 text-[10px] uppercase tracking-wide text-zinc-500 dark:bg-zinc-900">
              <tr>
                <th className="px-3 py-2">Employee</th>
                <th className="px-3 py-2">Asset</th>
                <th className="px-3 py-2">Specs</th>
                <th className="px-3 py-2">Assigned</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={6} className="px-3 py-8 text-center text-zinc-400">No assets match this view.</td></tr>
              ) : filtered.map((asset) => (
                <tr key={asset.id} className="border-t border-zinc-100 align-top dark:border-zinc-800">
                  <td className="px-3 py-2">
                    <div className="font-bold">{asset.memberName}</div>
                    <div className="text-[10px] text-zinc-500">{asset.memberDesignation || "—"}</div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-semibold">{asset.assetTypeName}{asset.label ? " · " + asset.label : ""}</div>
                    {asset.identifier && <div className="text-[10px] text-zinc-500">{asset.identifier}</div>}
                  </td>
                  <td className="max-w-[240px] px-3 py-2 text-zinc-500">{asset.specs || "—"}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-zinc-500">{asset.assignedOn || "—"}{asset.returnedOn ? " → " + asset.returnedOn : ""}</td>
                  <td className="px-3 py-2"><span className={"rounded px-1.5 py-0.5 text-[10px] font-bold " + STATUS_STYLE[asset.status]}>{STATUS_LABEL[asset.status]}</span></td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {canManage && asset.status !== "returned" && <button disabled={busy} onClick={() => quickReturn(asset)} className="px-1.5 py-0.5 text-[10px] font-bold text-emerald-600 hover:underline">Return</button>}
                    {canManage && <button disabled={busy} onClick={() => setEditing(asset)} className="px-1.5 py-0.5 text-[10px] font-bold text-indigo-500 hover:underline">Edit</button>}
                    {canManage && <button disabled={busy} onClick={() => remove(asset)} className="px-1.5 py-0.5 text-[10px] font-bold text-rose-500 hover:underline">Remove</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <section className="space-y-2">
        <h4 className="text-sm font-bold">Position standards</h4>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {positions.map((position) => (
            <div key={position.id} className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-xs font-bold">{position.title}</div>
                  <div className="text-[10px] text-zinc-500">{position.department || "—"}</div>
                </div>
                <span className="rounded bg-indigo-500/10 px-1.5 py-0.5 text-[10px] font-bold text-indigo-500">{position.standards.length}</span>
              </div>
              <div className="mt-2 space-y-1">
                {position.standards.length === 0 ? <p className="text-[10px] text-zinc-400">No standard kit yet.</p> : position.standards.map((s) => (
                  <div key={s.id} className="flex items-center justify-between gap-2 rounded border border-zinc-100 px-2 py-1 dark:border-zinc-800">
                    <div className="min-w-0">
                      <span className="text-[11px] font-semibold">{s.assetTypeName} × {s.quantity}</span>
                      {s.specNote && <p className="truncate text-[10px] text-zinc-500">{s.specNote}</p>}
                    </div>
                    {canManage && (
                      <div className="flex shrink-0 gap-1">
                        <button onClick={() => setStandardEdit(s)} disabled={busy} className="text-[10px] font-bold text-indigo-500 hover:underline">Edit</button>
                        <button onClick={() => removeStandard(position, s.id)} disabled={busy} className="text-[10px] font-bold text-rose-500 hover:underline">×</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {editing !== undefined && (
        <AssetModal asset={editing} members={members} types={types} onClose={() => setEditing(undefined)} onSaved={() => dash.refresh()} />
      )}
      {standardEdit !== undefined && (
        <StandardModal key={standardEdit?.id ?? "new"} standard={standardEdit} positions={positions} types={types} onClose={() => setStandardEdit(undefined)} onSaved={() => dash.refresh()} />
      )}
    </div>
  );
}
