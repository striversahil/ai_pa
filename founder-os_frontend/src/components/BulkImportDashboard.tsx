"use client";

import React, { useMemo, useState } from "react";
import { useLiveQuery } from "@/hooks/useLiveData";

// Mirror: founder-os_backend/src/automations/bulk-import/types.ts
interface Batch { id: string; vendorId: string | null; sourceKind: string; sourceName: string; quotedAt: string; status: string; disabled: boolean; rowCount: number; readyCount: number; createdBy: string; createdAt: string; }
interface Row { id: string; batchId: string; rowNo: number; rawText: string; productId: string | null; productName: string | null; isNewProduct: boolean; newCategory: string | null; vendorId: string | null; vendorName: string | null; price: number | null; unit: string | null; discount: number | null; moq: string | null; deliveryDays: number | null; weightPerUnit: number | null; packageQty: string | null; packageDims: string | null; specs: Record<string, string>; missing: string[]; matchConfidence: number | null; duplicateOf: string | null; status: string; }

const panel = "bg-[var(--bg-card)] border border-[var(--border-card)] rounded-2xl";
const field = "w-full px-3 py-2 bg-[var(--bg-input)] border border-[var(--border-card)] rounded-xl outline-none focus:border-brand-indigo text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] transition-colors";
const label = "block text-[11px] font-bold uppercase tracking-wider text-[var(--text-tertiary)]";
const primaryBtn = "inline-flex items-center gap-1.5 px-3.5 py-2 bg-brand-indigo text-white font-bold text-xs rounded-xl hover:opacity-90 disabled:opacity-40 cursor-pointer border-0 transition-opacity";
const ghostBtn = "inline-flex items-center gap-1.5 px-3 py-1.5 border border-[var(--border-card)] hover:bg-[var(--bg-input)] font-bold text-xs rounded-xl cursor-pointer bg-transparent text-[var(--text-primary)] transition-colors";
const dangerBtn = "inline-flex items-center gap-1.5 px-3 py-1.5 font-bold text-xs rounded-xl cursor-pointer border border-[color-mix(in_srgb,var(--color-danger)_30%,transparent)] text-[var(--color-danger)] hover:bg-[var(--color-danger)] hover:text-white bg-transparent transition-colors";

async function postJson(path: string, method: string, body?: unknown): Promise<any> {
  const res = await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(String((data as any)?.error ?? `HTTP ${res.status}`));
  return data;
}

const STATUS_STYLE: Record<string, string> = {
  matched: "text-sky-600", unprocessed: "text-zinc-500", "needs-product": "text-amber-600", "needs-specs": "text-orange-600",
  ready: "text-emerald-600", duplicate: "text-zinc-500",
};

export default function BulkImportDashboard() {
  const batchesQ = useLiveQuery<{ batches: Batch[] }>(
    () => fetch("/api/bulk-import/batches").then(async (r) => {
      if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}`), { status: r.status });
      return r.json();
    }),
    { events: [] },
  );
  const [openId, setOpenId] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const batches = batchesQ.data?.batches ?? [];
  // Background refreshes must never flash the full loading screen — only the
  // very first load shows it.
  if (batchesQ.loading && batches.length === 0) return <p className="p-6 text-sm text-[var(--text-tertiary)]">Loading bulk imports…</p>;
  const st = (batchesQ.error as any)?.status;
  if (st === 401) return <p className="p-6 text-sm text-[var(--text-tertiary)]">Please log in to view bulk imports.</p>;
  if (st === 403) return <p className="p-6 text-sm text-[var(--text-tertiary)]">Bulk import is root-only for now. Access pending.</p>;
  if (batchesQ.error && batches.length === 0) return <p className="p-6 text-sm text-[var(--text-tertiary)]">Couldn’t load batches. Retrying…</p>;
  return (
    <div className="space-y-4">
      <div className={`${panel} p-4 flex flex-wrap items-center gap-3`}>
        <div>
          <h2 className="text-base font-extrabold text-[var(--text-primary)]">Bulk price-list import</h2>
          <p className="text-xs text-[var(--text-tertiary)]">Paste rows or drop a file — AI stages them as matched rows, you commit as one block.</p>
        </div>
        <div className="ml-auto flex gap-2">
          <button type="button" className={ghostBtn} onClick={() => batchesQ.refresh()}>Refresh</button>
          <button type="button" className={primaryBtn} onClick={() => setShowNew((v) => !v)}>+ New import</button>
        </div>
      </div>
      {msg && <p className="text-xs font-bold text-[var(--text-tertiary)]">{msg}</p>}
      {showNew && <NewImport onDone={(m) => { setMsg(m); setShowNew(false); batchesQ.refresh(); }} />}
      {batches.length === 0 && <p className={`${panel} p-6 text-center text-sm text-[var(--text-tertiary)]`}>No imports yet — paste your first price list above.</p>}
      {batches.map((b) => (
        <BatchCard key={b.id} batch={b} open={openId === b.id} onOpen={() => setOpenId(openId === b.id ? null : b.id)} onMsg={setMsg} onChanged={() => batchesQ.refresh()} onOpenChat={(id) => window.dispatchEvent(new CustomEvent("open-bulk-chat", { detail: { batchId: id } }))} />
      ))}
    </div>
  );
}

function NewImport({ onDone }: { onDone: (m: string) => void }) {
  const [tab, setTab] = useState<"paste" | "file">("paste");
  const [text, setText] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [quotedAt, setQuotedAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const vendorsQ = useLiveQuery<{ vendors: { id: string; name: string }[] }>(
    () => fetch("/api/automations/product-line/data").then((r) => r.json()).then((d) => ({ vendors: d?.vendors ?? [] })),
    {},
  );
  const vendors = vendorsQ.data?.vendors ?? [];

  async function submit() {
    setBusy(true);
    try {
      if (tab === "paste") {
        if (!text.trim()) throw new Error("paste some rows first");
        const d = await postJson("/api/bulk-import/batches", "POST", {
          text, sourceName: `pasted list ${new Date().toLocaleString()}`,
          vendorId: vendorId || undefined, quotedAt: quotedAt || undefined,
        });
        onDone(`Staged ${d.inserted} rows (${d.resolved} auto-matched, ${d.duplicates} duplicates).`);
      } else {
        if (!file) throw new Error("choose a file first");
        const fd = new FormData();
        fd.append("file", file);
        if (vendorId) fd.append("vendorId", vendorId);
        if (quotedAt) fd.append("quotedAt", quotedAt);
        const res = await fetch("/api/bulk-import/upload", { method: "POST", body: fd });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(String(d?.error ?? `HTTP ${res.status}`));
        onDone(`File accepted — parse runner started (batch ${String(d.batchId).slice(0, 8)}…). Refreshes automatically.`);
      }
    } catch (e: any) {
      onDone(`Failed: ${String(e?.message ?? e).slice(0, 200)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`${panel} p-4 space-y-3`}>
      <div className="flex gap-2">
        {(["paste", "file"] as const).map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)}
            className={`px-3 py-1.5 text-xs font-bold rounded-xl cursor-pointer border ${tab === t ? "bg-brand-indigo text-white border-0" : "border-[var(--border-card)] bg-transparent text-[var(--text-primary)]"}`}>
            {t === "paste" ? "Paste rows" : "Drop file (.xlsx .csv .pdf photo)"}
          </button>
        ))}
      </div>
      {tab === "paste" ? (
        <textarea className={`${field} min-h-28 font-mono text-xs`} placeholder={"One row per line, e.g.\nV belt B-type 4inch Rs 450 per pcs\nDamru ball 4inch Rs 120 nos"} value={text} onChange={(e) => setText(e.target.value)} />
      ) : (
        <input type="file" accept=".xlsx,.xls,.csv,.pdf,.png,.jpg,.jpeg,.webp" className={field} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      )}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className={label}>Vendor (empty = AI detects per row)</label>
          <select className={field} value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
            <option value="">Detect per row</option>
            {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </div>
        <div>
          <label className={label}>Quote date (whole list)</label>
          <input type="date" className={field} value={quotedAt} onChange={(e) => setQuotedAt(e.target.value)} />
        </div>
        <div className="flex items-end">
          <button type="button" className={primaryBtn} disabled={busy} onClick={submit}>{busy ? "Working…" : tab === "paste" ? "Stage rows" : "Upload + parse"}</button>
        </div>
      </div>
    </div>
  );
}

function BatchCard({ batch, open, onOpen, onMsg, onChanged, onOpenChat }: { batch: Batch; open: boolean; onOpen: () => void; onMsg: (m: string) => void; onChanged: () => void; onOpenChat: (id: string) => void }) {
  const [busy, setBusy] = useState("");
  // While a file batch is parsing, poll the summary so the card progresses
  // live. Everything else is chat-driven (no auto-processing anywhere).
  const working = batch.status === "parsing";
  React.useEffect(() => {
    if (!working) return;
    const id = setInterval(() => onChanged(), 10000);
    return () => clearInterval(id);
  }, [working, batch.id, onChanged]);
  async function act(kind: string) {
    setBusy(kind);
    try {
      if (kind === "commit") {
        const d = await postJson(`/api/bulk-import/batches/${batch.id}/commit`, "POST", {});
        onMsg(`Committed ${d.committed} rates (${d.skippedDuplicates} duplicates, ${d.skippedIncomplete.length} incomplete skipped).`);
      } else if (kind === "disable" || kind === "enable") {
        const d = await postJson(`/api/bulk-import/batches/${batch.id}/block`, "POST", { disabled: kind === "disable" });
        onMsg(kind === "disable" ? `Block hidden (${d.rates} rates off).` : `Block restored (${d.rates} rates on).`);
      } else if (kind === "delete") {
        if (!window.confirm(`Delete all ${batch.rowCount} staged/live rates of this block? The batch record stays as audit trail.`)) return;
        const d = await fetch(`/api/bulk-import/batches/${batch.id}`, { method: "DELETE" }).then((r) => r.json());
        onMsg(`Block wiped (${d.rates} rates deleted).`);
      }
      onChanged();
    } catch (e: any) {
      onMsg(`Failed: ${String(e?.message ?? e).slice(0, 200)}`);
    } finally {
      setBusy("");
    }
  }
  const pct = batch.rowCount ? Math.round((100 * batch.readyCount) / batch.rowCount) : 0;
  return (
    <div className={`${panel} p-4`}>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={onOpen} className="bg-transparent border-0 cursor-pointer text-left">
          <p className="text-sm font-extrabold text-[var(--text-primary)]">{batch.sourceName || "Price list"}</p>
          <p className="text-[11px] text-[var(--text-tertiary)]">
            {batch.sourceKind} · {batch.status}{batch.disabled ? " · disabled" : ""} · {batch.readyCount}/{batch.rowCount} ready · {new Date(batch.createdAt).toLocaleString()}
          </p>
        </button>
        <div className="ml-auto flex flex-wrap gap-2">
          {batch.status !== "committed" && <button type="button" className={primaryBtn} disabled={!!busy} onClick={() => onOpenChat(batch.id)}>Open in AI chat</button>}
          {batch.status !== "committed" && batch.readyCount > 0 && <button type="button" className={primaryBtn} disabled={!!busy} onClick={() => act("commit")}>Commit {batch.readyCount}</button>}
          {batch.status === "committed" && !batch.disabled && <button type="button" className={ghostBtn} disabled={!!busy} onClick={() => act("disable")}>Disable block</button>}
          {batch.status === "committed" && batch.disabled && <button type="button" className={primaryBtn} disabled={!!busy} onClick={() => act("enable")}>Enable block</button>}
          <button type="button" className={dangerBtn} disabled={!!busy} onClick={() => act("delete")}>Delete</button>
        </div>
      </div>
      <div className={`mt-2 h-1.5 rounded-full bg-[var(--bg-input)] overflow-hidden ${working ? "animate-pulse" : ""}`}>
        <div className="h-full bg-emerald-500 transition-all duration-500" style={{ width: `${pct}%` }} />
      </div>
      {working && (
        <p className="mt-1.5 text-[11px] font-bold text-brand-indigo">
          Parsing file… {batch.rowCount} rows so far — open it in AI chat when status is review.
        </p>
      )}
      {open && <BatchRows batch={batch} live={working} onChanged={onChanged} />}
    </div>
  );
}

function BatchRows({ batch, live, onChanged }: { batch: Batch; live: boolean; onChanged: () => void }) {
  const [filter, setFilter] = useState("");
  const rowsQ = useLiveQuery<{ rows: Row[] }>(
    () => fetch(`/api/bulk-import/batches/${batch.id}${filter ? `?status=${filter}` : ""}`).then((r) => r.json()).then((d) => ({ rows: d?.rows ?? [] })),
    { events: [], deps: [batch.id, filter], pollMs: live ? 10000 : undefined },
  );
  const rows = useMemo(() => rowsQ.data?.rows ?? [], [rowsQ.data]);
  const [editing, setEditing] = useState<Row | null>(null);
  // Background polls must never blank the table — spinner only on first load.
  if (rowsQ.loading && rows.length === 0) return <p className="pt-3 text-xs text-[var(--text-tertiary)]">Loading rows…</p>;
  return (
    <div className="pt-3">
      <div className="mb-2 flex gap-2 flex-wrap">
        {(["", "unprocessed", "needs-product", "needs-specs", "ready", "duplicate"] as const).map((s) => (
          <button key={s} type="button" onClick={() => { setFilter(s); }}
            className={`px-2.5 py-1 text-[11px] font-bold rounded-lg cursor-pointer border ${filter === s ? "bg-brand-indigo text-white border-0" : "border-[var(--border-card)] bg-transparent text-[var(--text-primary)]"}`}>
            {s || "all"}
          </button>
        ))}
        <button type="button" className={ghostBtn} onClick={() => rowsQ.refresh()}>Refresh</button>
        <span className="ml-auto text-[11px] text-[var(--text-tertiary)]">
          {live && <span className="mr-2 inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 animate-ping" />}
          {rows.length} rows{live ? " · live" : ""}
        </span>
      </div>
      <div className="overflow-x-auto rounded-xl border border-[var(--border-card)]">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[var(--text-tertiary)]">
              <th className="px-2 py-1.5">#</th><th className="px-2 py-1.5">Row</th><th className="px-2 py-1.5">Product</th>
              <th className="px-2 py-1.5">Price</th><th className="px-2 py-1.5">Missing</th><th className="px-2 py-1.5">Status</th><th className="px-2 py-1.5"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-[var(--border-card)] align-top">
                <td className="px-2 py-1.5 tabular-nums text-[var(--text-tertiary)]">{r.rowNo}</td>
                <td className="px-2 py-1.5 text-[var(--text-primary)] max-w-56">{r.rawText}</td>
                <td className="px-2 py-1.5 text-[var(--text-primary)]">
                  {r.productName ?? (r.isNewProduct ? `NEW: ${r.newCategory ?? "?"}` : "—")}
                  {r.matchConfidence != null && !r.isNewProduct && <span className="text-[var(--text-tertiary)]"> ({Math.round(r.matchConfidence * 100)}%)</span>}
                </td>
                <td className="px-2 py-1.5 tabular-nums text-[var(--text-primary)]">{r.price != null ? `₹${r.price}${r.unit ? `/${r.unit}` : ""}` : "—"}</td>
                <td className="px-2 py-1.5 text-[var(--text-tertiary)] max-w-52">{(r.missing ?? []).slice(0, 3).join("; ") || "—"}</td>
                <td className={`px-2 py-1.5 font-bold ${STATUS_STYLE[r.status] ?? ""}`}>{r.status}</td>
                <td className="px-2 py-1.5"><button type="button" className={ghostBtn} onClick={() => setEditing(r)}>Fix</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && <RowEditor row={editing} batchId={batch.id} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); onChanged(); rowsQ.refresh(); }} />}
    </div>
  );
}

function RowEditor({ row, batchId, onClose, onSaved }: { row: Row; batchId: string; onClose: () => void; onSaved: () => void }) {
  const [price, setPrice] = useState(row.price != null ? String(row.price) : "");
  const [unit, setUnit] = useState(row.unit ?? "");
  const [specText, setSpecText] = useState(Object.entries(row.specs ?? {}).map(([k, v]) => `${k} = ${v}`).join("\n"));
  const [isNew, setIsNew] = useState(row.isNewProduct);
  const [newCat, setNewCat] = useState(row.newCategory ?? "");
  const [productName, setProductName] = useState(row.productName ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [cats, setCats] = useState<string[]>([]);
  React.useEffect(() => {
    fetch("/api/automations/product-line/data").then((r) => r.json()).then((d) => {
      const c = [...new Set(((d?.products ?? []) as { category: string }[]).map((p) => String(p.category ?? "").trim()).filter(Boolean))].sort();
      setCats(c);
    }).catch(() => {});
  }, []);

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const specs: Record<string, string> = {};
      for (const line of specText.split("\n")) {
        const i = line.indexOf("=");
        if (i > 0) {
          const k = line.slice(0, i).trim().slice(0, 120);
          const v = line.slice(i + 1).trim().slice(0, 500);
          if (k && v) specs[k] = v;
        }
      }
      await postJson(`/api/bulk-import/rows/${row.id}`, "PATCH", {
        price: price === "" ? null : Number(price),
        unit: unit || null,
        specs,
        isNewProduct: isNew,
        newCategory: isNew ? (newCat || null) : null,
        productName: productName || null,
        ...(isNew ? { productId: null } : {}),
      });
      onSaved();
    } catch (e: any) {
      setErr(String(e?.message ?? e).slice(0, 200));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className={`${panel} w-full max-w-lg p-4 space-y-3`} onClick={(e) => e.stopPropagation()}>
        <p className="text-sm font-extrabold text-[var(--text-primary)]">Row {row.rowNo}: {row.rawText.slice(0, 80)}</p>
        <div className="grid grid-cols-2 gap-3">
          <div><label className={label}>Price (₹)</label><input className={field} value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" /></div>
          <div><label className={label}>Unit</label><input className={field} value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="pcs / kg / …" /></div>
        </div>
        <div><label className={label}>Specs (key = value per line, keys must match the product checklist)</label>
          <textarea className={`${field} min-h-20 font-mono text-xs`} value={specText} onChange={(e) => setSpecText(e.target.value)} /></div>
        <div className="flex items-center gap-2">
          <input id={`newp-${row.id}`} type="checkbox" checked={isNew} onChange={(e) => setIsNew(e.target.checked)} />
          <label htmlFor={`newp-${row.id}`} className="text-xs font-bold text-[var(--text-primary)]">Stage as NEW product</label>
        </div>
        {isNew && (
          <div className="grid grid-cols-2 gap-3">
            <div><label className={label}>Product name</label><input className={field} value={productName} onChange={(e) => setProductName(e.target.value)} /></div>
            <div><label className={label}>Category (live list)</label>
              <select className={field} value={newCat} onChange={(e) => setNewCat(e.target.value)}>
                <option value="">Pick…</option>
                {cats.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
        )}
        {err && <p className="text-xs font-bold text-[var(--color-danger)]">{err}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className={ghostBtn} onClick={onClose}>Cancel</button>
          <button type="button" className={primaryBtn} disabled={busy} onClick={save}>{busy ? "Saving…" : "Save row"}</button>
        </div>
      </div>
    </div>
  );
}
