"use client";

import { useMemo, useState } from "react";
import { inr } from "@/components/accounts/payment-calendar";

export interface CashEntry {
  id: string;
  day: string;
  direction: "in" | "out";
  kind: string;
  amount: number;
  party: string;
  purpose: string;
  mode: string;
  ref: string;
  note: string;
  enteredBy: string;
  runningBalance: number;
  createdAt: string;
}

export interface CashSummary {
  opening: number;
  totalIn: number;
  totalOut: number;
  closing: number;
  count: number;
}

function todayIST(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()).slice(0, 10);
}

export default function DispatchCash({
  entries, summary, canAdd, canEdit, onRefresh,
}: {
  entries: CashEntry[];
  summary?: CashSummary | null;
  canAdd: boolean;
  canEdit: boolean;
  onRefresh: () => void;
}) {
  const [dirFilter, setDirFilter] = useState<"all" | "in" | "out">("all");
  const [showAdd, setShowAdd] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const rows = useMemo(
    () => entries.filter((e) => dirFilter === "all" || e.direction === dirFilter),
    [entries, dirFilter],
  );

  const remove = async (id: string) => {
    if (!window.confirm("Void this cash entry? The running balance will recompute.")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/accounts/cash/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || `Delete failed (${res.status})`);
      onRefresh();
    } catch (e: any) {
      setErr(e?.message ?? "Delete failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      {summary && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { label: "Opening", value: summary.opening, tone: "text-zinc-700 dark:text-zinc-200" },
            { label: "In (credits)", value: summary.totalIn, tone: "text-emerald-600 dark:text-emerald-400" },
            { label: "Out (spends)", value: summary.totalOut, tone: "text-rose-600 dark:text-rose-400" },
            { label: "Closing", value: summary.closing, tone: summary.closing < 0 ? "text-rose-600 dark:text-rose-400" : "text-zinc-900 dark:text-white" },
          ].map((s) => (
            <div key={s.label} className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
              <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">{s.label}</div>
              <div className={`mt-0.5 text-lg font-extrabold ${s.tone}`}>{inr(s.value)}</div>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        {(["all", "in", "out"] as const).map((d) => (
          <button
            key={d}
            onClick={() => setDirFilter(d)}
            className={`rounded-full px-3 py-1 text-[11px] font-bold ${dirFilter === d ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900" : "border border-zinc-300 text-zinc-500 dark:border-zinc-700"}`}
          >
            {d === "all" ? `All (${entries.length})` : d === "in" ? `In (${entries.filter((e) => e.direction === "in").length})` : `Out (${entries.filter((e) => e.direction === "out").length})`}
          </button>
        ))}
        <div className="flex-1" />
        {canAdd && (
          <button onClick={() => { setErr(null); setShowAdd(true); }} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-500">
            + Add entry
          </button>
        )}
      </div>

      {err && <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-500">{err}</div>}

      <div className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-zinc-50 text-left text-[10px] uppercase tracking-wider text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
              <th className="px-2.5 py-2">Day</th>
              <th className="px-2.5 py-2">Flow</th>
              <th className="px-2.5 py-2 text-right">Amount</th>
              <th className="px-2.5 py-2 text-right">Balance</th>
              <th className="px-2.5 py-2">Party / Purpose</th>
              <th className="px-2.5 py-2">Ref</th>
              <th className="px-2.5 py-2">By</th>
              {canEdit && <th className="px-2.5 py-2" />}
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id} className="border-t border-zinc-100 dark:border-zinc-800/60 even:bg-zinc-50/50 dark:even:bg-zinc-900/20">
                <td className="whitespace-nowrap px-2.5 py-2 font-mono">{e.day}</td>
                <td className="whitespace-nowrap px-2.5 py-2">
                  <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${e.direction === "in" ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-rose-500/10 text-rose-600 dark:text-rose-400"}`}>
                    {e.direction === "in" ? "↑ In" : "↓ Out"}
                  </span>{" "}
                  <span className="text-[10px] text-zinc-500">{e.kind}</span>
                </td>
                <td className={`whitespace-nowrap px-2.5 py-2 text-right font-bold ${e.direction === "in" ? "text-emerald-600 dark:text-emerald-400" : "text-zinc-800 dark:text-zinc-200"}`}>
                  {e.direction === "in" ? "+" : "−"}{inr(e.amount)}
                </td>
                <td className="whitespace-nowrap px-2.5 py-2 text-right tabular-nums text-zinc-500">{inr(e.runningBalance)}</td>
                <td className="max-w-[260px] truncate px-2.5 py-2" title={[e.party, e.purpose, e.note].filter(Boolean).join(" · ")}>
                  {[e.party, e.purpose].filter(Boolean).join(" — ") || "—"}
                </td>
                <td className="max-w-[140px] truncate px-2.5 py-2 font-mono text-zinc-500">{e.ref || "—"}</td>
                <td className="whitespace-nowrap px-2.5 py-2 text-zinc-500">{e.enteredBy || "—"}</td>
                {canEdit && (
                  <td className="px-2.5 py-2 text-right">
                    <button onClick={() => remove(e.id)} disabled={busy} className="text-xs text-rose-500 hover:text-rose-400 disabled:opacity-50">Void</button>
                  </td>
                )}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={canEdit ? 8 : 7} className="px-2 py-10 text-center text-sm text-zinc-500">No cash entries yet — record the opening balance first (kind “opening”, direction “in”).</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {showAdd && (
        <AddCashDialog busy={busy} onClose={() => setShowAdd(false)} onSave={async (body) => {
          setBusy(true);
          try {
            const res = await fetch("/api/accounts/cash", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
            if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || `Save failed (${res.status})`);
            setShowAdd(false);
            onRefresh();
          } catch (e: any) {
            setErr(e?.message ?? "Save failed");
          } finally {
            setBusy(false);
          }
        }} />
      )}
    </div>
  );
}

function AddCashDialog({ busy, onClose, onSave }: { busy: boolean; onClose: () => void; onSave: (body: Record<string, unknown>) => Promise<void> }) {
  const [day, setDay] = useState(todayIST());
  const [direction, setDirection] = useState<"in" | "out">("out");
  const [kind, setKind] = useState("expense");
  const [amount, setAmount] = useState("");
  const [party, setParty] = useState("");
  const [purpose, setPurpose] = useState("");
  const [ref, setRef] = useState("");
  const [note, setNote] = useState("");
  const [localErr, setLocalErr] = useState<string | null>(null);
  const inputCls = "w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-2.5 py-1.5 text-xs outline-none focus:border-indigo-500";

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 px-3 py-8" onClick={onClose}>
      <div className="w-full max-w-lg space-y-3 rounded-2xl border border-zinc-200 bg-white p-5 shadow-xl dark:border-zinc-800 dark:bg-zinc-950" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <h3 className="text-sm font-bold text-zinc-900 dark:text-white">Add cash entry</h3>
          <button onClick={onClose} className="text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200">Close</button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-400">Day<input type="date" value={day} onChange={(e) => setDay(e.target.value)} className={inputCls} /></label>
          <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-400">Amount (₹)<input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" placeholder="e.g. 5000" className={inputCls} /></label>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-400">Flow
            <select value={direction} onChange={(e) => { setDirection(e.target.value as "in" | "out"); if (e.target.value === "out" && kind === "opening") setKind("expense"); }} className={inputCls}>
              <option value="out">↓ Out (spend)</option>
              <option value="in">↑ In (credit)</option>
            </select>
          </label>
          <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-400">Kind
            <select value={kind} onChange={(e) => setKind(e.target.value)} className={inputCls}>
              {direction === "in"
                ? [<option key="credit" value="credit">Credit / top-up</option>, <option key="opening" value="opening">Opening balance</option>, <option key="other" value="other">Other in</option>]
                : [<option key="expense" value="expense">Expense</option>, <option key="other" value="other">Other out</option>]}
            </select>
          </label>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-400">Party<input value={party} onChange={(e) => setParty(e.target.value)} placeholder="Who / where" className={inputCls} /></label>
          <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-400">Reference<input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Bill / txn ref" className={inputCls} /></label>
        </div>
        <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-400">Purpose<input value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="What was this for" className={inputCls} /></label>
        <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-400">Note (optional)<input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional note" className={inputCls} /></label>
        {localErr && <p className="text-xs text-rose-500">{localErr}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-semibold text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">Cancel</button>
          <button
            disabled={busy}
            onClick={() => {
              const n = Number(amount);
              if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) { setLocalErr("Pick a valid day"); return; }
              if (!Number.isFinite(n) || n <= 0) { setLocalErr("Enter an amount > 0"); return; }
              if (!party.trim() && !purpose.trim()) { setLocalErr("Party or purpose is required"); return; }
              onSave({ day, direction, kind, amount: Math.round(n * 100) / 100, party: party.trim(), purpose: purpose.trim(), ref: ref.trim(), note: note.trim() });
            }}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save entry"}
          </button>
        </div>
      </div>
    </div>
  );
}
