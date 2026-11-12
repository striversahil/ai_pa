"use client";

// SalesObjectionsPanel — Sales → Objections tab.
//
// Agents file objections they face in the field against an estimate number
// and/or a client name (free text, at least one required). Every agent on
// the sales surface sees every objection; managers (sales-head) reply
// with coaching and resolve/reopen. Writes broadcast live; the board
// refetches via useLiveDashboard.
import React, { useCallback, useMemo, useState } from "react";
import { useAuth } from "@/auth/AuthContext";
import { useLiveDashboard } from "@/hooks/useLiveData";
import { hasSalesManagerAccess } from "./SalesControllerPanel";
import {
  fetchObjections,
  fileObjection,
  replyObjection,
  setObjectionStatus,
} from "@/sales-objections/api";
import {
  OBJECTION_CATEGORIES,
  OBJECTION_CATEGORY_LABEL,
  type SalesObjection,
} from "@/sales-objections/types";

const inputCls =
  "w-full px-2.5 py-1.5 bg-[var(--bg-input)] border border-[var(--border-card)] rounded-lg outline-none focus:border-brand-indigo text-xs text-[var(--text-primary)]";

function categoryTone(cat: string): string {
  switch (cat) {
    case "price": return "bg-red-500/10 text-red-600 ring-red-500/30 dark:text-red-400";
    case "delivery": return "bg-amber-500/10 text-amber-600 ring-amber-500/30 dark:text-amber-400";
    case "quality": return "bg-violet-500/10 text-violet-600 ring-violet-500/30 dark:text-violet-400";
    case "competition": return "bg-sky-500/10 text-sky-600 ring-sky-500/30 dark:text-sky-400";
    case "payment_terms": return "bg-emerald-500/10 text-emerald-600 ring-emerald-500/30 dark:text-emerald-400";
    default: return "bg-black/5 text-[var(--text-secondary)] ring-[var(--border-card)] dark:bg-white/5";
  }
}

export default function SalesObjectionsPanel() {
  const { me } = useAuth();
  const canManage = hasSalesManagerAccess(me as any);

  const [status, setStatus] = useState("open");
  const [category, setCategory] = useState("all");
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState("");

  const query = useLiveDashboard(
    useCallback(() => fetchObjections({ status, category, q: q || undefined }), [status, category, q]),
    { events: ["sales-objections"], deps: [status, category, q] },
  );
  const rows: SalesObjection[] = useMemo(() => query.data?.objections ?? [], [query.data]);
  const openCount = useMemo(() => rows.filter((r) => r.status === "open").length, [rows]);

  return (
    <div className="space-y-3">
      <FileObjectionForm
        onDone={(m) => { setMsg(m); query.refresh(); }}
      />
      {msg && <p className="text-[11px] text-[var(--text-secondary)]">{msg}</p>}

      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-[var(--border-card)] bg-[var(--bg-card)] p-3">
        <div className="flex gap-1 rounded-full bg-black/5 p-1 dark:bg-white/5">
          {["open", "resolved", "all"].map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={`rounded-full px-3 py-1.5 text-[11px] font-bold capitalize transition ${status === s ? "bg-indigo-600 text-white shadow" : "text-[var(--text-secondary)] hover:bg-white/70 dark:hover:bg-white/10"}`}
            >
              {s === "open" ? `Open · ${s === "open" ? openCount : rows.filter((r) => r.status === "open").length}` : s}
            </button>
          ))}
        </div>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="rounded-lg border border-[var(--border-card)] bg-[var(--bg-input)] px-2 py-1.5 text-[11px] font-bold text-[var(--text-primary)]"
        >
          <option value="all">All categories</option>
          {OBJECTION_CATEGORIES.map((c) => (
            <option key={c} value={c}>{OBJECTION_CATEGORY_LABEL[c]}</option>
          ))}
        </select>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search estimate / client / detail…"
          className="min-w-[200px] flex-1 rounded-lg border border-[var(--border-card)] bg-[var(--bg-input)] px-2 py-1.5 text-[11px] text-[var(--text-primary)]"
        />
      </div>

      {query.error ? (
        <p className="text-xs text-red-600">Load failed: {String(query.error)} — <button className="underline" onClick={() => query.refresh()}>retry</button></p>
      ) : null}

      {rows.length === 0 && !query.loading ? (
        <p className="rounded-xl border border-dashed border-[var(--border-card)] p-6 text-center text-[11px] text-[var(--text-tertiary)]">
          {status === "open" ? "No open objections. File one above when a customer pushes back." : "Nothing here for this filter."}
        </p>
      ) : null}

      <div className="grid gap-2 lg:grid-cols-2">
        {rows.map((o) => (
          <ObjectionCard key={o.id} o={o} canManage={canManage} onChanged={() => query.refresh()} />
        ))}
      </div>
    </div>
  );
}

function FileObjectionForm({ onDone }: { onDone: (m: string) => void }) {
  const [estNumber, setEstNumber] = useState("");
  const [clientName, setClientName] = useState("");
  const [cat, setCat] = useState<string>("price");
  const [detail, setDetail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    if (!estNumber.trim() && !clientName.trim()) return setError("Estimate number or client name required.");
    if (!detail.trim()) return setError("Describe the objection.");
    setBusy(true); setError("");
    try {
      await fileObjection({ estNumber: estNumber.trim(), clientName: clientName.trim(), category: cat, detail: detail.trim() });
      setEstNumber(""); setClientName(""); setDetail(""); setCat("price");
      onDone("Objection filed — the whole sales floor can see it.");
    } catch (e: any) {
      setError(e?.message ?? "file failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl border border-[var(--border-card)] bg-[var(--bg-card)] p-3">
      <p className="text-[11px] font-extrabold uppercase tracking-wider text-[var(--text-tertiary)]">File an objection</p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-[180px_minmax(0,1fr)_160px]">
        <input value={estNumber} onChange={(e) => setEstNumber(e.target.value)} placeholder="Estimate no. (e.g. EST-024100)" className={inputCls} />
        <input value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="Client name" className={inputCls} />
        <select value={cat} onChange={(e) => setCat(e.target.value)} className={inputCls}>
          {OBJECTION_CATEGORIES.map((c) => (
            <option key={c} value={c}>{OBJECTION_CATEGORY_LABEL[c]}</option>
          ))}
        </select>
      </div>
      <textarea
        value={detail}
        onChange={(e) => setDetail(e.target.value)}
        placeholder="What objection did the customer raise? (price too high vs competitor, delivery timeline, quality doubt…)"
        rows={2}
        className={`${inputCls} mt-2 resize-y`}
      />
      <div className="mt-2 flex items-center gap-2">
        <button
          onClick={submit}
          disabled={busy}
          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {busy ? "Filing…" : "File objection"}
        </button>
        {error && <span className="text-[11px] text-red-600">{error}</span>}
      </div>
    </div>
  );
}

function ObjectionCard({ o, canManage, onChanged }: { o: SalesObjection; canManage: boolean; onChanged: () => void }) {
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(o.status === "open");

  const act = async (fn: () => Promise<unknown>, okMsg?: string) => {
    setBusy(true); setError("");
    try {
      await fn();
      if (okMsg) setReply("");
      onChanged();
    } catch (e: any) {
      setError(e?.message ?? "failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`rounded-2xl border p-3 ${o.status === "open" ? "border-[var(--border-card)] bg-[var(--bg-card)]" : "border-[var(--border-card)] bg-[var(--bg-card)] opacity-75"}`}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ${categoryTone(o.category)}`}>
          {OBJECTION_CATEGORY_LABEL[o.category as keyof typeof OBJECTION_CATEGORY_LABEL] ?? o.category}
        </span>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ${o.status === "open" ? "bg-amber-500/10 text-amber-600 ring-amber-500/30 dark:text-amber-400" : "bg-emerald-500/10 text-emerald-600 ring-emerald-500/30 dark:text-emerald-400"}`}>
          {o.status === "open" ? "Open" : "Resolved"}
        </span>
        {o.estNumber && <span className="text-[11px] font-extrabold text-[var(--text-primary)]">{o.estNumber}</span>}
        {o.clientName && <span className="truncate text-[11px] font-semibold text-[var(--text-secondary)]">{o.clientName}</span>}
        <button onClick={() => setExpanded(!expanded)} className="ml-auto text-[10px] font-bold text-[var(--text-tertiary)] hover:text-[var(--text-primary)]">
          {expanded ? "collapse" : "expand"}
        </button>
      </div>

      {expanded && (
        <>
          <p className="mt-1.5 whitespace-pre-wrap text-xs text-[var(--text-primary)]">{o.detail}</p>
          <p className="mt-1 text-[10px] text-[var(--text-tertiary)]">
            filed by {o.createdByName || "—"}{o.createdAt ? ` · ${o.createdAt.slice(0, 10)}` : ""}
          </p>

          {(o.replies ?? []).length > 0 && (
            <div className="mt-2 space-y-1.5 border-l-2 border-indigo-300/60 pl-2">
              {(o.replies ?? []).map((r) => (
                <div key={r.id} className="rounded-lg bg-indigo-500/[0.06] px-2 py-1.5">
                  <p className="whitespace-pre-wrap text-[11px] text-[var(--text-primary)]">{r.text}</p>
                  <p className="mt-0.5 text-[10px] text-[var(--text-tertiary)]">
                    {r.createdByName || "—"}{r.createdAt ? ` · ${r.createdAt.slice(0, 10)}` : ""}
                  </p>
                </div>
              ))}
            </div>
          )}

          {canManage && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <input
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                placeholder={o.status === "open" ? "Coach / reply…" : "Follow-up reply…"}
                className="min-w-[180px] flex-1 rounded-lg border border-[var(--border-card)] bg-[var(--bg-input)] px-2 py-1.5 text-[11px] text-[var(--text-primary)]"
              />
              <button
                disabled={busy || !reply.trim()}
                onClick={() => void act(() => replyObjection(o.id, reply.trim()))}
                className="rounded-lg bg-indigo-600 px-2.5 py-1.5 text-[11px] font-bold text-white disabled:opacity-50"
              >
                Reply
              </button>
              {o.status === "open" ? (
                <button
                  disabled={busy}
                  onClick={() => void act(() => setObjectionStatus(o.id, "resolved"))}
                  className="rounded-lg px-2.5 py-1.5 text-[11px] font-bold text-emerald-600 ring-1 ring-emerald-500/40 hover:bg-emerald-500/10 disabled:opacity-50"
                >
                  Resolve
                </button>
              ) : (
                <button
                  disabled={busy}
                  onClick={() => void act(() => setObjectionStatus(o.id, "open"))}
                  className="rounded-lg px-2.5 py-1.5 text-[11px] font-bold text-amber-600 ring-1 ring-amber-500/40 hover:bg-amber-500/10 disabled:opacity-50"
                >
                  Reopen
                </button>
              )}
            </div>
          )}
          {error && <p className="mt-1 text-[11px] text-red-600">{error}</p>}
        </>
      )}
    </div>
  );
}
