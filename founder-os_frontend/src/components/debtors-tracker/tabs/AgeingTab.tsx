"use client";

import { useMemo, useState } from "react";
import type { CustomerAgeingRow } from "@/debtors-tracker/types";
import { BUCKET_LABELS, CUSTOMER_SITUATIONS, CUSTOMER_SITUATION_LABELS, formatINR, shortDate, situationLabel } from "@/debtors-tracker/types";
import { formatPromiseDate, promiseStatus, promiseStatusLabel, todayIST } from "@/debtors-tracker/promise";
import { Chip, EmptyState, TD, TDR, TH, THR, TableShell } from "../ui";

const DUE_COLS = [
  { label: BUCKET_LABELS.D0, pick: (r: CustomerAgeingRow) => r.bucket0to30 },
  { label: BUCKET_LABELS.D31, pick: (r: CustomerAgeingRow) => r.bucket31to60 },
  { label: BUCKET_LABELS.D61, pick: (r: CustomerAgeingRow) => r.bucket61to90 },
  { label: BUCKET_LABELS.D91, pick: (r: CustomerAgeingRow) => r.bucket91to180 },
  { label: BUCKET_LABELS.D181, pick: (r: CustomerAgeingRow) => r.bucketAbove180 },
] as const;

type SortKey =
  | "customerName"
  | "contact"
  | "lastFollowUpDate"
  | "lastInvoiceDate"
  | "situation"
  | "totalReceivable"
  | "notDue"
  | "bucket0to30"
  | "bucket31to60"
  | "bucket61to90"
  | "bucket91to180"
  | "bucketAbove180"
  | "grossDue"
  | "advanceReceived"
  | "netDue";
type SortDir = "asc" | "desc";

/** New columns default to asc for text, desc for dates/amounts. */
function defaultDir(key: SortKey): SortDir {
  return key === "customerName" || key === "contact" || key === "situation" ? "asc" : "desc";
}

const SITUATION_ORDER = ["", ...CUSTOMER_SITUATIONS];

const SITUATION_BADGE: Record<string, string> = {
  NOT_ANSWERING: "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300",
  BUSY: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
  CALLBACK: "bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300",
  PROMISED_TO_PAY: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300",
  DISPUTED: "bg-orange-50 text-orange-700 dark:bg-orange-500/10 dark:text-orange-300",
  PAID_CLOSED: "bg-zinc-100 text-zinc-600 dark:bg-zinc-500/10 dark:text-zinc-400",
};

function SituationBadge({ situation }: { situation: string }) {
  if (!situation) return <span className="text-zinc-400 dark:text-zinc-500">Unset</span>;
  const cls = SITUATION_BADGE[situation] ?? "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300";
  return (
    <span className={`inline-block rounded-full px-1.5 py-0.5 text-[10px] font-medium ${cls}`}>
      {situationLabel(situation) || situation}
    </span>
  );
}

/**
 * Promise is deliberately independent of the situation: after "Promised to pay"
 * a later "Not answering" call keeps the date as "Last promise" until a newer
 * promise replaces it (or Paid / Closed clears it).
 */
function PromiseBadge({ row, today }: { row: CustomerAgeingRow; today: string }) {
  const settled = row.netDue <= 0 || row.situation === "PAID_CLOSED";
  if (settled) return null;
  if (!row.promisedDate) {
    if (row.situation !== "PROMISED_TO_PAY") return null;
    return (
      <span className="inline-block rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
        No promise date
      </span>
    );
  }
  const state = promiseStatus(row.promisedDate, today);
  const cls = state === "overdue"
    ? "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300"
    : state === "today"
      ? "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300"
      : "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300";
  const isCurrent = row.situation === "PROMISED_TO_PAY";
  return (
    <span
      className={`inline-block rounded-full px-1.5 py-0.5 text-[10px] font-medium ${cls}`}
      title={`${isCurrent ? "Promised" : "Last promised"} ${formatPromiseDate(row.promisedDate)}${row.promisedBy ? ` · set by ${row.promisedBy}` : ""}`}
    >
      {isCurrent ? "Promise" : "Last promise"} {shortDate(row.promisedDate)} · {promiseStatusLabel(row.promisedDate, today)}
    </span>
  );
}

export default function AgeingTab({
  customers, onGoToAccounts, onEditContact, onEditSituation, onFollowUp, onViewLedger, canAccounts,
}: {
  customers: CustomerAgeingRow[];
  onGoToAccounts: () => void;
  onEditContact: (customer: CustomerAgeingRow) => void;
  onEditSituation: (customer: CustomerAgeingRow) => void;
  onFollowUp: (customerName: string) => void;
  onViewLedger: (customer: CustomerAgeingRow) => void;
  canAccounts: boolean;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("grossDue");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [situationFilter, setSituationFilter] = useState<string>("ALL");
  const [groupBy, setGroupBy] = useState(false);
  const today = useMemo(() => todayIST(), []);

  const changeSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
      return;
    }
    setSortKey(key);
    setSortDir(defaultDir(key));
  };

  const sortArrow = (key: SortKey) => (sortKey === key ? (sortDir === "asc" ? " ↑" : " ↓") : "");

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of customers) m.set(r.situation || "", (m.get(r.situation || "") || 0) + 1);
    return m;
  }, [customers]);

  const filtered = useMemo(() => {
    const rows = situationFilter === "ALL"
      ? customers
      : customers.filter((r) => (r.situation || "") === situationFilter);
    const dir = sortDir === "asc" ? 1 : -1;
    const nameTie = (a: CustomerAgeingRow, b: CustomerAgeingRow) => a.customerName.localeCompare(b.customerName);
    // Empty dates always sink to the bottom, whichever direction is active.
    const dateCmp = (av: string | null, bv: string | null) => {
      if (!av && !bv) return 0;
      if (!av) return 1;
      if (!bv) return -1;
      return av.localeCompare(bv);
    };
    return [...rows].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "customerName":
          cmp = a.customerName.localeCompare(b.customerName);
          break;
        case "contact":
          cmp = (a.phone || a.email || "").localeCompare(b.phone || b.email || "");
          break;
        case "lastFollowUpDate":
          cmp = dateCmp(a.lastFollowUpDate, b.lastFollowUpDate);
          break;
        case "lastInvoiceDate":
          cmp = dateCmp(a.lastInvoiceDate, b.lastInvoiceDate);
          break;
        case "situation":
          cmp = (situationLabel(a.situation || "") || "Unset").localeCompare(situationLabel(b.situation || "") || "Unset");
          break;
        case "totalReceivable":
        case "notDue":
        case "bucket0to30":
        case "bucket31to60":
        case "bucket61to90":
        case "bucket91to180":
        case "bucketAbove180":
        case "grossDue":
        case "advanceReceived":
        case "netDue":
          cmp = (a[sortKey] as number) - (b[sortKey] as number);
          break;
      }
      if (cmp !== 0) return cmp * dir;
      return nameTie(a, b);
    });
  }, [customers, situationFilter, sortKey, sortDir]);

  const groups = useMemo(() => {
    if (!groupBy) return null;
    const m = new Map<string, CustomerAgeingRow[]>();
    for (const r of filtered) {
      const k = r.situation || "";
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(r);
    }
    return SITUATION_ORDER.filter((s) => m.has(s)).map((s) => {
      const rows = m.get(s)!;
      const gross = rows.reduce((a, r) => a + r.grossDue, 0);
      const net = rows.reduce((a, r) => a + r.netDue, 0);
      return { situation: s, rows, gross, net };
    });
  }, [filtered, groupBy]);

  const totals = useMemo(() => filtered.reduce((acc, r) => {
    acc.totalReceivable += r.totalReceivable;
    acc.notDue += r.notDue;
    for (const c of DUE_COLS) acc.buckets[c.label] = (acc.buckets[c.label] || 0) + c.pick(r);
    acc.grossDue += r.grossDue;
    acc.advanceReceived += r.advanceReceived;
    acc.netDue += r.netDue;
    return acc;
  }, { totalReceivable: 0, notDue: 0, buckets: {} as Record<string, number>, grossDue: 0, advanceReceived: 0, netDue: 0 }), [filtered]);

  const renderRow = (r: CustomerAgeingRow, i: number) => (
    <tr key={r.customerKey || r.customerName} className="even:bg-zinc-50/50 hover:bg-indigo-50/40 dark:even:bg-zinc-900/20 dark:hover:bg-indigo-500/5">
      <td className={`${TD} w-10 text-zinc-400`}>{i + 1}</td>
      <td className={`${TD} max-w-[280px]`} title={r.customerName}>
        <div className="flex items-center gap-2">
          <span className="truncate font-medium text-zinc-800 dark:text-zinc-200">{r.customerName}</span>
          {r.region && (
            <span className="shrink-0 rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300">
              {r.region}
            </span>
          )}
        </div>
      </td>
      <td className={TD}>
        <div className="max-w-[220px] truncate" title={[r.phone, r.email].filter(Boolean).join(" · ")}>
          {r.phone || r.email || <span className="text-amber-600 dark:text-amber-400">No contact</span>}
        </div>
        {r.phone && (
          <div className="mt-0.5 text-[10px] text-zinc-400 dark:text-zinc-500">
            {r.whatsappOptIn ? "WhatsApp opt-in" : "No WhatsApp opt-in"}
          </div>
        )}
      </td>
      <td className={TD}>
        {r.lastFollowUpDate
          ? <><div>{shortDate(r.lastFollowUpDate)}</div><div className="text-[10px] text-zinc-400 dark:text-zinc-500">{r.lastFollowUpStatus || "—"}</div></>
          : <span className="text-zinc-400 dark:text-zinc-500">Not called</span>}
      </td>
      <td className={`${TD} whitespace-nowrap`}>
        {r.lastInvoiceDate
          ? <span title={r.lastInvoiceDate}>{shortDate(r.lastInvoiceDate)}</span>
          : <span className="text-zinc-400 dark:text-zinc-500">—</span>}
      </td>
      <td className={`${TD} max-w-[220px]`}>
        <div className="flex flex-wrap items-center gap-1.5">
          <SituationBadge situation={r.situation || ""} />
          <PromiseBadge row={r} today={today} />
          <button onClick={() => onEditSituation(r)} className="shrink-0 rounded px-1 py-0.5 text-[11px] font-medium text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-500/10">Set</button>
        </div>
        {r.situationRemarks && (
          <div className="mt-0.5 truncate text-[11px] text-zinc-500 dark:text-zinc-400" title={`${r.situationRemarks}${r.remarkCount > 1 ? ` · ${r.remarkCount} remarks` : ""}`}>
            {r.lastRemarkAt ? `${shortDate(r.lastRemarkAt)} · ` : ""}{r.situationRemarks}
            {r.remarkCount > 1 ? ` · ${r.remarkCount} remarks` : ""}
          </div>
        )}
      </td>
      <td className={`${TDR} font-medium text-zinc-800 dark:text-zinc-200`}>{formatINR(r.totalReceivable, false)}</td>
      <td className={`${TDR} text-sky-600 dark:text-sky-400`}>{formatINR(r.notDue)}</td>
      {DUE_COLS.map((c) => (
        <td key={c.label} className={TDR}>{formatINR(c.pick(r))}</td>
      ))}
      <td className={`${TDR} font-medium text-rose-600 dark:text-rose-400`}>{formatINR(r.grossDue, false)}</td>
      <td className={`${TDR} text-emerald-600 dark:text-emerald-400`}>{formatINR(r.advanceReceived)}</td>
      <td className={`${TDR} font-medium text-amber-600 dark:text-amber-400`}>{formatINR(r.netDue, false)}</td>
      <td className={`${TD} whitespace-nowrap text-right`}>
        <button onClick={() => onViewLedger(r)} className="rounded px-2 py-1 text-[11px] font-medium text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800">Ledger</button>
        <button onClick={() => onFollowUp(r.customerName)} className="ml-1 rounded px-2 py-1 text-[11px] font-medium text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-500/10">Follow up</button>
        <button onClick={() => onEditContact(r)} className="ml-1 rounded px-2 py-1 text-[11px] font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800">Contact</button>
      </td>
    </tr>
  );

  const renderGroupHeader = (label: string, count: number, gross: number, net: number, key: string) => (
    <tr key={`group-${key}`} className="bg-zinc-100/80 dark:bg-zinc-800/50">
      <td colSpan={17} className="px-3 py-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-300">
        {label} · {count} customer{count === 1 ? "" : "s"} · Gross due {formatINR(gross, false)} · Net due {formatINR(net, false)}
      </td>
    </tr>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-zinc-500 dark:text-zinc-400" title="Click any column header to sort — click again to reverse">Sort by · or click a column header</span>
        {([
          ["grossDue", "Gross due"],
          ["totalReceivable", "Total receivable"],
          ["netDue", "Net due"],
          ["lastInvoiceDate", "Last invoice date"],
        ] as const).map(([key, label]) => (
          <Chip key={key} active={sortKey === key} onClick={() => changeSort(key)}>
            {label}{sortKey === key ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
          </Chip>
        ))}
        <label className="ml-2 flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
          Situation
          <select
            value={situationFilter}
            onChange={(e) => setSituationFilter(e.target.value)}
            className="rounded-lg border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-800 outline-none focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
          >
            <option value="ALL">All ({customers.length})</option>
            {SITUATION_ORDER.map((s) => (
              <option key={s || "unset"} value={s}>
                {s ? CUSTOMER_SITUATION_LABELS[s as keyof typeof CUSTOMER_SITUATION_LABELS] : "Unset"} ({counts.get(s) || 0})
              </option>
            ))}
          </select>
        </label>
        <Chip active={groupBy} onClick={() => setGroupBy((v) => !v)}>Group by situation</Chip>
        <div className="flex-1" />
        <span className="text-xs text-zinc-400 dark:text-zinc-500">{filtered.length} customers</span>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title={customers.length ? "No customers in this situation" : "No customer ageing yet"}
          hint={customers.length
            ? "Try a different situation filter — or set the situation from any customer row."
            : canAccounts
              ? "Import the debtors ageing sheet from the Accounts tab — the buckets are calculated automatically from each invoice's due date."
              : "The accounts team has not imported the debtors sheet yet. Ageing, dues and follow-up status will appear here once it is loaded."}
          action={!customers.length && canAccounts
            ? <button onClick={onGoToAccounts} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">Go to Accounts</button>
            : undefined}
        />
      ) : (
        <TableShell minWidth={1580}>
          <thead>
            <tr title="Click any column header to sort ↑ ↓ — click again to reverse">
              <th className={TH}>#</th>
              <th className={`${TH} cursor-pointer select-none hover:text-zinc-800 dark:hover:text-zinc-100`} onClick={() => changeSort("customerName")} title="Sort by customer">Customer / Debtor{sortArrow("customerName")}</th>
              <th className={`${TH} cursor-pointer select-none hover:text-zinc-800 dark:hover:text-zinc-100`} onClick={() => changeSort("contact")} title="Sort by contact">Contact{sortArrow("contact")}</th>
              <th className={`${TH} cursor-pointer select-none hover:text-zinc-800 dark:hover:text-zinc-100`} onClick={() => changeSort("lastFollowUpDate")} title="Sort by last follow-up">Last follow-up{sortArrow("lastFollowUpDate")}</th>
              <th className={`${TH} cursor-pointer select-none hover:text-zinc-800 dark:hover:text-zinc-100`} onClick={() => changeSort("lastInvoiceDate")} title="Sort by last invoice date">Last invoice date{sortArrow("lastInvoiceDate")}</th>
              <th className={`${TH} cursor-pointer select-none hover:text-zinc-800 dark:hover:text-zinc-100`} onClick={() => changeSort("situation")} title="Sort by situation">Situation / CRM remarks{sortArrow("situation")}</th>
              <th className={`${THR} cursor-pointer select-none hover:text-zinc-800 dark:hover:text-zinc-100`} onClick={() => changeSort("totalReceivable")} title="Sort by total receivable">Total Receivable{sortArrow("totalReceivable")}</th>
              <th className={`${THR} cursor-pointer select-none hover:text-zinc-800 dark:hover:text-zinc-100`} onClick={() => changeSort("notDue")} title="Sort by not due">Not Due{sortArrow("notDue")}</th>
              {DUE_COLS.map((c) => {
                const key = (
                  c.label === BUCKET_LABELS.D0 ? "bucket0to30"
                    : c.label === BUCKET_LABELS.D31 ? "bucket31to60"
                    : c.label === BUCKET_LABELS.D61 ? "bucket61to90"
                    : c.label === BUCKET_LABELS.D91 ? "bucket91to180"
                    : "bucketAbove180"
                ) as SortKey;
                return (
                  <th key={c.label} className={`${THR} cursor-pointer select-none hover:text-zinc-800 dark:hover:text-zinc-100`} onClick={() => changeSort(key)} title={`Sort by ${c.label}`}>
                    {c.label}{sortArrow(key)}
                  </th>
                );
              })}
              <th className={`${THR} cursor-pointer select-none hover:text-zinc-800 dark:hover:text-zinc-100`} onClick={() => changeSort("grossDue")} title="Sort by gross due">Gross Due{sortArrow("grossDue")}</th>
              <th className={`${THR} cursor-pointer select-none hover:text-zinc-800 dark:hover:text-zinc-100`} onClick={() => changeSort("advanceReceived")} title="Sort by advance">Advance{sortArrow("advanceReceived")}</th>
              <th className={`${THR} cursor-pointer select-none hover:text-zinc-800 dark:hover:text-zinc-100`} onClick={() => changeSort("netDue")} title="Sort by net due">Net Due{sortArrow("netDue")}</th>
              <th className={TH} aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {groups
              ? groups.map((g) => [
                renderGroupHeader(
                  g.situation ? (CUSTOMER_SITUATION_LABELS[g.situation as keyof typeof CUSTOMER_SITUATION_LABELS] ?? g.situation) : "Unset",
                  g.rows.length, g.gross, g.net, g.situation || "unset",
                ),
                ...g.rows.map((r, i) => renderRow(r, i)),
              ])
              : filtered.map((r, i) => renderRow(r, i))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-zinc-200 bg-zinc-50 font-medium text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900/80 dark:text-zinc-100">
              <td className="px-3 py-2" />
              <td className="px-3 py-2 whitespace-nowrap">Total</td>
              <td className="px-3 py-2" />
              <td className="px-3 py-2" />
              <td className="px-3 py-2" />
              <td className="px-3 py-2" />
              <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{formatINR(totals.totalReceivable, false)}</td>
              <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{formatINR(totals.notDue, false)}</td>
              {DUE_COLS.map((c) => <td key={c.label} className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{formatINR(totals.buckets[c.label] || 0, false)}</td>)}
              <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{formatINR(totals.grossDue, false)}</td>
              <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{formatINR(totals.advanceReceived, false)}</td>
              <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{formatINR(totals.netDue, false)}</td>
              <td className="px-3 py-2" />
            </tr>
          </tfoot>
        </TableShell>
      )}
    </div>
  );
}
