"use client";

// BulkChatContext — batch picker + paste box + file drop for the AI agent's
// Bulk tab. Row text NEVER goes through chat (2000-char truncation); paste /
// files create real batches via the root API, then chat tools operate on the
// open batch id. Mirror: bulk-import worker routes + store.ts.
import React, { useEffect, useState } from "react";

interface Batch { id: string; sourceName: string; sourceKind: string; status: string; readyCount: number; rowCount: number; }

async function getJson(path: string): Promise<any> {
  const res = await fetch(path);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(String((data as any)?.error ?? `HTTP ${res.status}`));
  return data;
}

export default function BulkChatContext({ openBatchId, onOpenBatch }: {
  openBatchId: string;
  onOpenBatch: (id: string) => void;
}) {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [showPaste, setShowPaste] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  async function reload(pickNewest = false) {
    try {
      const d = await getJson("/api/bulk-import/batches");
      const list = (d?.batches ?? []) as Batch[];
      setBatches(list);
      if (pickNewest && list.length && !openBatchId) onOpenBatch(list[0].id);
    } catch { /* root-only; chat shows the gate */ }
  }
  useEffect(() => { void reload(); }, []);

  async function paste() {
    if (!text.trim()) return;
    setBusy("paste");
    setMsg(null);
    try {
      const res = await fetch("/api/bulk-import/batches", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, sourceName: `chat paste ${new Date().toLocaleString()}` }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(d?.error ?? `HTTP ${res.status}`));
      setText("");
      setShowPaste(false);
      await reload();
      onOpenBatch(String(d.batchId));
      setMsg(`Staged ${d.inserted} rows (${d.resolved} auto-matched). Talk to me — e.g. "is this ready?"`);
    } catch (e: any) {
      setMsg(`Failed: ${String(e?.message ?? e).slice(0, 160)}`);
    } finally {
      setBusy("");
    }
  }

  async function upload(f: File) {
    setBusy("file");
    setMsg(null);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const res = await fetch("/api/bulk-import/upload", { method: "POST", body: fd });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(d?.error ?? `HTTP ${res.status}`));
      await reload();
      onOpenBatch(String(d.batchId));
      setMsg("File accepted — parse runner started. I'll see the rows once status is review.");
    } catch (e: any) {
      setMsg(`Failed: ${String(e?.message ?? e).slice(0, 160)}`);
    } finally {
      setBusy("");
    }
  }

  const open = batches.find((b) => b.id === openBatchId);
  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2.5 space-y-2">
      <div className="flex items-center gap-2">
        <select
          value={openBatchId} onChange={(e) => onOpenBatch(e.target.value)}
          className="flex-1 bg-transparent text-[12px] font-bold text-[var(--text-primary)] outline-none cursor-pointer [&>option]:text-black"
        >
          <option value="">Pick a batch…</option>
          {batches.map((b) => (
            <option key={b.id} value={b.id}>
              {(b.sourceName || "Price list").slice(0, 40)} · {b.status} · {b.readyCount}/{b.rowCount}
            </option>
          ))}
        </select>
        <button type="button" onClick={() => void reload()} title="Reload batches"
          className="px-2 py-1 text-[11px] font-bold rounded-full border border-white/[0.08] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer bg-transparent">
          ↻
        </button>
        <button type="button" onClick={() => setShowPaste((v) => !v)}
          className="px-2.5 py-1 text-[11px] font-bold rounded-full bg-violet-600 text-white hover:bg-violet-500 cursor-pointer border-0">
          Paste
        </button>
        <label className="px-2.5 py-1 text-[11px] font-bold rounded-full border border-white/[0.08] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer">
          File
          <input type="file" className="hidden" accept=".xlsx,.xls,.csv,.pdf,.png,.jpg,.jpeg,.webp"
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void upload(f); }} />
        </label>
      </div>
      {open && <p className="text-[11px] text-[var(--text-tertiary)]">Talking about: <span className="font-bold text-[var(--text-secondary)]">{open.sourceName}</span> · {open.readyCount}/{open.rowCount} ready</p>}
      {showPaste && (
        <div className="space-y-2">
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} placeholder={"One row per line, e.g.\nV belt B-type 4inch Rs 450 per pcs"}
            className="w-full bg-[var(--bg-input)] border border-white/[0.08] rounded-xl px-3 py-2 text-[12px] font-mono text-[var(--text-primary)] outline-none focus:border-violet-500/50" />
          <div className="flex justify-end">
            <button type="button" disabled={busy === "paste" || !text.trim()} onClick={() => void paste()}
              className="px-3.5 py-1.5 text-[12px] font-bold rounded-full bg-violet-600 text-white hover:bg-violet-500 disabled:opacity-40 cursor-pointer border-0">
              {busy === "paste" ? "Staging…" : "Stage rows →"}
            </button>
          </div>
        </div>
      )}
      {(busy === "file" || msg) && <p className="text-[11px] font-medium text-[var(--text-secondary)]">{busy === "file" ? "Uploading…" : msg}</p>}
    </div>
  );
}
