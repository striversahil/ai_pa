"use client";

// PaymentDues — the Payment dues tab: recurring bills (credit cards, mobile
// recharges, EMIs…) with per-cycle paid/unpaid state.
//
// Data rides the accounts dashboard payload (`payments`); writes go to the
// Worker-only payment endpoints (/api/accounts/payments*) plus the shared
// log route for reopen. Any accountant manages dues (founder rule) — the tab
// renders for every dashboard viewer, and the server gates each write.
import React, { useMemo, useState } from "react";

export interface PaymentDueRow {
  templateId: string;
  title: string;
  biller: string;
  category: string;
  amount: number | null;
  frequency: string;
  ownerRole: string;
  dueDay: number | null;
  dueMonth: number | null;
  remindDays: number[];
  logId: string | null;
  dueDate: string;
  status: string;
  paidAmount: number | null;
  paidRef: string | null;
  remark: string | null;
  doneBy: string | null;
  updatedAt: string | null;
  bucket: "overdue" | "week" | "upcoming" | "paid";
  daysOverdue: number;
  daysUntil: number;
  remind: boolean;
}

export const PAYMENT_CATEGORIES = [
  "Credit Card", "Mobile Recharge", "Utilities", "Loan / EMI", "Insurance",
  "Rent", "Software / Subscription", "Tax / Compliance", "Other",
];

type Bucket = "all" | PaymentDueRow["bucket"];
type SortKey = "dueAsc" | "dueDesc" | "amountDesc" | "amountAsc" | "biller" | "overdue";

const BUCKETS: { key: Bucket; label: string; icon: string }[] = [
  { key: "all", label: "All", icon: "🧾" },
  { key: "overdue", label: "Overdue", icon: "🔴" },
  { key: "week", label: "Due this week", icon: "🟡" },
  { key: "upcoming", label: "Upcoming", icon: "⚪" },
  { key: "paid", label: "Paid", icon: "🟢" },
];

const SORTS: { key: SortKey; label: string }[] = [
  { key: "dueAsc", label: "Due date ↑" },
  { key: "dueDesc", label: "Due date ↓" },
  { key: "amountDesc", label: "Amount ↓" },
  { key: "amountAsc", label: "Amount ↑" },
  { key: "biller", label: "Biller A–Z" },
  { key: "overdue", label: "Most overdue" },
];

const inr = (n: number | null | undefined) =>
  n === null || n === undefined || !Number.isFinite(n) ? "—" : `₹${Number(n).toLocaleString("en-IN")}`;

function fmtDue(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}`;
}

const inputCls =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-800 outline-none focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200";

function Countdown({ r }: { r: PaymentDueRow }) {
  if (r.bucket === "paid") return null;
  if (r.bucket === "overdue") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-rose-500/40 bg-rose-500/10 px-2 py-0.5 text-[11px] font-bold text-rose-600 dark:text-rose-400">
        ⚠ Overdue {r.daysOverdue}d
      </span>
    );
  }
  if (r.bucket === "week") {
    const label = r.daysUntil <= 0 ? "Due today" : r.daysUntil === 1 ? "Due tomorrow" : `Due in ${r.daysUntil}d`;
    return (
      <span className="inline-flex items-center gap-1">
        <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[11px] font-bold text-amber-700 dark:text-amber-300">
          {label}
        </span>
        {r.remind && (
          <span className="inline-flex items-center gap-1 rounded-full border border-indigo-500/40 bg-indigo-500/10 px-2 py-0.5 text-[11px] font-bold text-indigo-600 dark:text-indigo-300" title="Reminder day for this bill">
            🔔 Reminder
          </span>
        )}
      </span>
    );
  }
  return <span className="text-[11px] font-semibold text-zinc-500">Due {fmtDue(r.dueDate)}</span>;
}

export default function PaymentDues({ dues, onRefresh }: { dues: PaymentDueRow[]; onRefresh: () => void }) {
  const [bucket, setBucket] = useState<Bucket>("all");
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [sort, setSort] = useState<SortKey>("dueAsc");
  const [minAmt, setMinAmt] = useState("");
  const [maxAmt, setMaxAmt] = useState("");
  const [payRow, setPayRow] = useState<PaymentDueRow | null>(null);
  const [editRow, setEditRow] = useState<PaymentDueRow | "new" | null>(null);
  const [confirmDel, setConfirmDel] = useState<PaymentDueRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const counts = useMemo(() => {
    const c: Record<Bucket, number> = { all: dues.length, overdue: 0, week: 0, upcoming: 0, paid: 0 };
    for (const d of dues) c[d.bucket]++;
    return c;
  }, [dues]);

  const cats = useMemo(() => [...new Set(dues.map((d) => d.category).filter(Boolean))].sort(), [dues]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const min = minAmt === "" ? null : Number(minAmt);
    const max = maxAmt === "" ? null : Number(maxAmt);
    const list = dues.filter((r) => {
      if (bucket !== "all" && r.bucket !== bucket) return false;
      if (cat && r.category !== cat) return false;
      if (needle && !`${r.title} ${r.biller} ${r.paidRef ?? ""} ${r.remark ?? ""}`.toLowerCase().includes(needle)) return false;
      const amt = r.paidAmount ?? r.amount;
      if (min !== null && Number.isFinite(min) && (amt === null || amt < min)) return false;
      if (max !== null && Number.isFinite(max) && (amt === null || amt > max)) return false;
      return true;
    });
    const by = {
      dueAsc: (a: PaymentDueRow, b: PaymentDueRow) => a.dueDate.localeCompare(b.dueDate),
      dueDesc: (a: PaymentDueRow, b: PaymentDueRow) => b.dueDate.localeCompare(a.dueDate),
      amountDesc: (a: PaymentDueRow, b: PaymentDueRow) => (b.paidAmount ?? b.amount ?? -1) - (a.paidAmount ?? a.amount ?? -1),
      amountAsc: (a: PaymentDueRow, b: PaymentDueRow) => (a.paidAmount ?? a.amount ?? Infinity) - (b.paidAmount ?? b.amount ?? Infinity),
      biller: (a: PaymentDueRow, b: PaymentDueRow) => (a.biller || a.title).localeCompare(b.biller || b.title),
      overdue: (a: PaymentDueRow, b: PaymentDueRow) => b.daysOverdue - a.daysOverdue || a.dueDate.localeCompare(b.dueDate),
    }[sort];
    return [...list].sort(by);
  }, [dues, bucket, q, cat, sort, minAmt, maxAmt]);

  const grouped = useMemo(() => {
    const order: PaymentDueRow["bucket"][] = ["overdue", "week", "upcoming", "paid"];
    const groups: { bucket: PaymentDueRow["bucket"]; rows: PaymentDueRow[] }[] = [];
    for (const b of order) {
      const rows = filtered.filter((r) => r.bucket === b);
      if (rows.length) groups.push({ bucket: b, rows });
    }
    return groups;
  }, [filtered]);

  const totalUnpaid = useMemo(
    () => dues.filter((d) => d.bucket !== "paid").reduce((t, d) => t + (d.amount ?? 0), 0),
    [dues],
  );

  async function postJson(url: string, method: string, body: unknown) {
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error((await res.text().catch(() => "")) || `HTTP ${res.status}`);
    return res.json().catch(() => ({}));
  }

  return (
    <div className="space-y-3">
      {/* Summary */}
      <div className="grid gap-2 sm:grid-cols-4">
        {([
          ["Unpaid now", inr(totalUnpaid), counts.overdue + counts.week + counts.upcoming],
          ["Overdue", counts.overdue, null],
          ["Due this week", counts.week, null],
          ["Paid (90d)", counts.paid, null],
        ] as const).map(([label, value]) => (
          <div key={label} className="rounded-xl border border-zinc-200/80 bg-white px-4 py-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/40">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">{label}</p>
            <p className="mt-0.5 font-mono text-xl font-bold text-zinc-900 dark:text-white">{value}</p>
          </div>
        ))}
      </div>

      {/* Bucket tabs + add */}
      <div className="flex flex-wrap items-center gap-2">
        {BUCKETS.map((b) => (
          <button
            key={b.key}
            onClick={() => setBucket(b.key)}
            className={`rounded-full border px-3 py-1.5 text-xs font-bold transition-colors cursor-pointer ${
              bucket === b.key
                ? "border-indigo-500 bg-indigo-500/15 text-indigo-700 dark:text-indigo-300"
                : "border-zinc-300 text-zinc-600 hover:border-indigo-400 dark:border-zinc-700 dark:text-zinc-400"
            }`}
          >
            {b.icon} {b.label} ({counts[b.key]})
          </button>
        ))}
        <div className="flex-1" />
        <button
          onClick={() => { setErr(null); setEditRow("new"); }}
          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-500 cursor-pointer"
        >
          + Add due
        </button>
      </div>

      {/* Filters */}
      <div className="grid gap-2 rounded-xl border border-zinc-200/80 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900/40 sm:grid-cols-2 lg:grid-cols-5">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title, biller, ref…" className={inputCls} />
        <select value={cat} onChange={(e) => setCat(e.target.value)} className={inputCls}>
          <option value="">All categories</option>
          {cats.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className={inputCls} title="Sort">
          {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <input value={minAmt} onChange={(e) => setMinAmt(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="Min ₹" inputMode="decimal" className={inputCls} />
        <input value={maxAmt} onChange={(e) => setMaxAmt(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="Max ₹" inputMode="decimal" className={inputCls} />
      </div>

      {filtered.length === 0 && (
        <div className="rounded-xl border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500 dark:border-zinc-700">
          {dues.length === 0
            ? "No payment dues yet — add the first bill (credit card, recharge, EMI…) with + Add due."
            : "Nothing matches these filters."}
        </div>
      )}

      {grouped.map(({ bucket: b, rows }) => (
        <div key={b} className="space-y-1.5">
          <p className="text-[11px] font-extrabold uppercase tracking-wider text-zinc-500">
            {BUCKETS.find((x) => x.key === b)?.icon} {BUCKETS.find((x) => x.key === b)?.label} · {rows.length}
          </p>
          {rows.map((r) => (
            <div
              key={`${r.templateId}-${r.dueDate}`}
              className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border bg-white px-3 py-2 shadow-sm dark:bg-zinc-900/40 ${
                r.bucket === "overdue" ? "border-rose-500/40" : r.remind ? "border-indigo-500/40" : "border-zinc-200/80 dark:border-zinc-800"
              }`}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-zinc-900 dark:text-white">
                  {r.title}
                  {r.biller && r.biller !== r.title && <span className="ml-2 font-semibold text-zinc-500">· {r.biller}</span>}
                </p>
                <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-500">
                  <span className="rounded bg-zinc-100 px-1.5 py-px font-semibold dark:bg-zinc-800">{r.category}</span>
                  <span className="capitalize">{r.frequency}</span>
                  <span>Due {fmtDue(r.dueDate)}</span>
                  <Countdown r={r} />
                </p>
                {r.bucket === "paid" && (
                  <p className="mt-0.5 text-[11px] text-emerald-600 dark:text-emerald-400">
                    ✓ Paid {inr(r.paidAmount)}{r.paidRef ? ` · ${r.paidRef}` : ""}{r.doneBy ? ` · by ${r.doneBy}` : ""}
                  </p>
                )}
              </div>
              <span className="font-mono text-sm font-bold text-zinc-900 dark:text-white">{inr(r.paidAmount ?? r.amount)}</span>
              <div className="flex items-center gap-1.5">
                {r.bucket !== "paid" ? (
                  <button
                    onClick={() => { setErr(null); setPayRow(r); }}
                    className="rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-emerald-500 cursor-pointer"
                  >
                    Mark paid
                  </button>
                ) : (
                  r.logId && (
                    <button
                      onClick={() => void (async () => {
                        setBusy(true); setErr(null);
                        try {
                          await postJson(`/api/accounts/logs/${r.logId}`, "PATCH", { status: "pending", remark: "Reopened — marked unpaid" });
                          onRefresh();
                        } catch (e: any) { setErr(e?.message || "Reopen failed"); }
                        finally { setBusy(false); }
                      })()}
                      disabled={busy}
                      className="rounded-lg border border-zinc-300 px-2.5 py-1.5 text-xs font-semibold text-zinc-600 hover:border-amber-400 dark:border-zinc-700 dark:text-zinc-400 cursor-pointer disabled:opacity-50"
                    >
                      Reopen
                    </button>
                  )
                )}
                <button
                  onClick={() => { setErr(null); setEditRow(r); }}
                  className="rounded-lg border border-zinc-300 px-2.5 py-1.5 text-xs font-semibold text-zinc-600 hover:border-indigo-400 dark:border-zinc-700 dark:text-zinc-400 cursor-pointer"
                >
                  Edit
                </button>
              </div>
            </div>
          ))}
        </div>
      ))}

      {err && <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-600 dark:text-rose-400">{err}</p>}

      {payRow && (
        <PayDialog
          row={payRow}
          busy={busy}
          onClose={() => setPayRow(null)}
          onPay={async (paidAmount, paidRef) => {
            setBusy(true); setErr(null);
            try {
              await postJson("/api/accounts/payments/pay", "POST", {
                templateId: payRow.templateId, dueDate: payRow.dueDate, paidAmount, paidRef,
              });
              setPayRow(null);
              onRefresh();
            } catch (e: any) { setErr(e?.message || "Mark paid failed"); }
            finally { setBusy(false); }
          }}
        />
      )}

      {editRow && (
        <DueFormDialog
          row={editRow === "new" ? null : editRow}
          busy={busy}
          onClose={() => setEditRow(null)}
          onSave={async (body, id) => {
            setBusy(true); setErr(null);
            try {
              await postJson(id ? `/api/accounts/payments/${id}` : "/api/accounts/payments", id ? "PUT" : "POST", body);
              setEditRow(null);
              onRefresh();
            } catch (e: any) { setErr(e?.message || "Save failed"); }
            finally { setBusy(false); }
          }}
          onDelete={async (id) => {
            setBusy(true); setErr(null);
            try {
              await postJson(`/api/accounts/payments/${id}`, "DELETE", {});
              setEditRow(null); setConfirmDel(null);
              onRefresh();
            } catch (e: any) { setErr(e?.message || "Delete failed"); }
            finally { setBusy(false); }
          }}
          confirmDel={confirmDel}
          setConfirmDel={setConfirmDel}
        />
      )}
    </div>
  );
}

function PayDialog({ row, busy, onClose, onPay }: {
  row: PaymentDueRow;
  busy: boolean;
  onClose: () => void;
  onPay: (amount: number, ref: string) => void;
}) {
  const [amount, setAmount] = useState(row.paidAmount ?? row.amount ?? "" as number | "");
  const [ref, setRef] = useState(row.paidRef ?? "");
  const [localErr, setLocalErr] = useState<string | null>(null);
  return (
    <Modal title={`Mark paid — ${row.title}`} onClose={onClose}>
      <p className="text-xs text-zinc-500">Due {fmtDue(row.dueDate)} · expected {inr(row.amount)}</p>
      <label className="mt-3 block text-xs font-semibold text-zinc-600 dark:text-zinc-400">
        Amount paid (₹)
        <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, "") as any)} inputMode="decimal" className={`${inputCls} mt-1`} placeholder="e.g. 12500" />
      </label>
      <label className="mt-2 block text-xs font-semibold text-zinc-600 dark:text-zinc-400">
        UTR / transaction reference
        <input value={ref} onChange={(e) => setRef(e.target.value)} className={`${inputCls} mt-1`} placeholder="e.g. UTR / UPI ref no." maxLength={200} />
      </label>
      {localErr && <p className="mt-2 text-xs text-rose-500">{localErr}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-semibold text-zinc-600 dark:border-zinc-700 dark:text-zinc-400 cursor-pointer">Cancel</button>
        <button
          disabled={busy}
          onClick={() => {
            const n = Number(amount);
            if (!Number.isFinite(n) || n <= 0) { setLocalErr("Enter the amount paid"); return; }
            if (!ref.trim()) { setLocalErr("Enter the UTR / transaction reference"); return; }
            onPay(Math.round(n * 100) / 100, ref.trim());
          }}
          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-50 cursor-pointer"
        >
          {busy ? "Saving…" : "Mark paid"}
        </button>
      </div>
    </Modal>
  );
}

function DueFormDialog({ row, busy, onClose, onSave, onDelete, confirmDel, setConfirmDel }: {
  row: PaymentDueRow | null;
  busy: boolean;
  onClose: () => void;
  onSave: (body: Record<string, unknown>, id: string | null) => void;
  onDelete: (id: string) => void;
  confirmDel: PaymentDueRow | null;
  setConfirmDel: (r: PaymentDueRow | null) => void;
}) {
  const [title, setTitle] = useState(row?.title ?? "");
  const [biller, setBiller] = useState(row?.biller ?? "");
  const [category, setCategory] = useState(row?.category ?? "Credit Card");
  const [amount, setAmount] = useState(row?.amount ?? "" as number | "");
  const [frequency, setFrequency] = useState(row?.frequency ?? "monthly");
  const [dueDay, setDueDay] = useState(row?.dueDay ?? "" as number | "");
  const [dueMonth, setDueMonth] = useState(row?.dueMonth ?? "" as number | "");
  const [remindDays, setRemindDays] = useState((row?.remindDays ?? [7, 3, 1]).join(","));
  const [localErr, setLocalErr] = useState<string | null>(null);
  return (
    <Modal title={row ? `Edit due — ${row.title}` : "Add payment due"} onClose={onClose}>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-400 sm:col-span-2">
          Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} className={`${inputCls} mt-1`} placeholder="e.g. HDFC Credit Card bill" maxLength={200} />
        </label>
        <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-400">
          Biller
          <input value={biller} onChange={(e) => setBiller(e.target.value)} className={`${inputCls} mt-1`} placeholder="e.g. HDFC Bank" maxLength={200} />
        </label>
        <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-400">
          Category
          <select value={category} onChange={(e) => setCategory(e.target.value)} className={`${inputCls} mt-1`}>
            {PAYMENT_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-400">
          Amount (₹, expected)
          <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, "") as any)} inputMode="decimal" className={`${inputCls} mt-1`} placeholder="Leave blank if it varies" />
        </label>
        <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-400">
          Repeats
          <select value={frequency} onChange={(e) => setFrequency(e.target.value)} className={`${inputCls} mt-1`}>
            {["daily", "weekly", "monthly", "quarterly", "yearly"].map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </label>
        <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-400">
          Due day of month
          <input value={dueDay} onChange={(e) => setDueDay(e.target.value.replace(/[^0-9]/g, "").slice(0, 2) as any)} inputMode="numeric" className={`${inputCls} mt-1`} placeholder="e.g. 5" />
        </label>
        <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-400">
          Due month (yearly only)
          <input value={dueMonth} onChange={(e) => setDueMonth(e.target.value.replace(/[^0-9]/g, "").slice(0, 2) as any)} inputMode="numeric" className={`${inputCls} mt-1`} placeholder="1–12" />
        </label>
      </div>
      <label className="mt-2 block text-xs font-semibold text-zinc-600 dark:text-zinc-400">
        Reminder days before due (comma-separated)
        <input value={remindDays} onChange={(e) => setRemindDays(e.target.value.replace(/[^0-9,]/g, ""))} className={`${inputCls} mt-1`} placeholder="7,3,1" />
      </label>
      {localErr && <p className="mt-2 text-xs text-rose-500">{localErr}</p>}
      <div className="mt-4 flex items-center justify-between gap-2">
        <div>
          {row && (confirmDel ? (
            <span className="flex items-center gap-2 text-xs">
              <span className="text-zinc-500">Remove this due?</span>
              <button onClick={() => onDelete(row.templateId)} disabled={busy} className="rounded-lg bg-rose-600 px-2.5 py-1.5 font-bold text-white disabled:opacity-50 cursor-pointer">Yes, remove</button>
              <button onClick={() => setConfirmDel(null)} className="rounded-lg border border-zinc-300 px-2.5 py-1.5 font-semibold text-zinc-600 dark:border-zinc-700 dark:text-zinc-400 cursor-pointer">Keep</button>
            </span>
          ) : (
            <button onClick={() => setConfirmDel(row)} className="rounded-lg border border-rose-500/40 px-2.5 py-1.5 text-xs font-semibold text-rose-600 dark:text-rose-400 cursor-pointer">Remove</button>
          ))}
        </div>
        <div className="flex gap-2">
          <button onClick={onClose} className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-semibold text-zinc-600 dark:border-zinc-700 dark:text-zinc-400 cursor-pointer">Cancel</button>
          <button
            disabled={busy}
            onClick={() => {
              if (!title.trim()) { setLocalErr("Title is required"); return; }
              const day = dueDay === "" ? null : Number(dueDay);
              if (day !== null && (!Number.isInteger(day) || day < 1 || day > 31)) { setLocalErr("Due day must be 1–31"); return; }
              const body: Record<string, unknown> = {
                title: title.trim(), biller: biller.trim() || null, category,
                amount: amount === "" ? null : Number(amount),
                frequency, dueDay: day,
                dueMonth: frequency === "yearly" && dueMonth !== "" ? Number(dueMonth) : null,
                ownerRole: "either", remindDays: remindDays || "7,3,1",
              };
              onSave(body, row?.templateId ?? null);
            }}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-500 disabled:opacity-50 cursor-pointer"
          >
            {busy ? "Saving…" : row ? "Save changes" : "Add due"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/50 p-4 backdrop-blur-sm sm:items-center" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl border border-zinc-200 bg-white p-5 shadow-2xl dark:border-zinc-800 dark:bg-zinc-950" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-start justify-between gap-3">
          <h4 className="font-bold text-zinc-900 dark:text-white">{title}</h4>
          <button onClick={onClose} className="rounded px-2 py-0.5 text-lg leading-none text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 cursor-pointer" aria-label="Close">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}
