/**
 * Payment Tracker — client statement export helpers.
 *
 * Pure formatting + browser download/print. The modal owns fetching; this
 * module never mutates data.
 */
import type { CustomerLedger, CustomerLedgerEntry } from "./types";
import { BUCKET_LABELS, shortDate } from "./types";

const RECEIPT_STATUS: Record<string, string> = {
  invoice: "By invoice",
  customer: "By customer (oldest open)",
  advance: "Customer advance",
  unmatched: "Unmatched",
};

function typeLabel(entry: CustomerLedgerEntry): string {
  if (entry.type === "invoice") return "Invoice";
  if (entry.type === "sheet_received") return "Sheet received";
  return "Receipt";
}

function statusLabel(entry: CustomerLedgerEntry): string {
  if (entry.type === "invoice") return BUCKET_LABELS[entry.status as keyof typeof BUCKET_LABELS] ?? entry.status;
  if (entry.type === "sheet_received") return "Per ageing sheet";
  return RECEIPT_STATUS[entry.status] ?? entry.status;
}

function money(n: number): string {
  return String(Math.round(n * 100) / 100);
}

function csvCell(value: string | number | null | undefined): string {
  const raw = value == null ? "" : String(value);
  return /[",\n\r]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
}

function fileSafe(value: string): string {
  return value.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase().slice(0, 80) || "customer";
}

export function ledgerCsv(ledger: CustomerLedger): string {
  const rows: (string | number | null | undefined)[][] = [
    ["Customer", ledger.customerName],
    ["Region", ledger.region || "Unassigned"],
    ["Phone", ledger.phone || ""],
    ["Email", ledger.email || ""],
    ["As of", ledger.asOfIST],
    [],
    ["Date", "Type", "Reference", "Invoice No.", "Description", "Debit", "Credit", "Balance", "Status"],
    ...ledger.entries.map((entry) => [
      entry.date ?? "",
      typeLabel(entry),
      entry.reference,
      entry.invoiceNo,
      entry.description,
      entry.debit ? money(entry.debit) : "",
      entry.credit ? money(entry.credit) : "",
      money(entry.balance),
      statusLabel(entry),
    ]),
    [],
    ["Total invoiced", "", "", "", "", money(ledger.totals.totalInvoiced), "", "", ""],
    ["Itemized receipts", "", "", "", "", "", money(ledger.totals.itemizedReceived), "", ""],
    ["Received per sheet", "", "", "", "", "", money(ledger.totals.sheetReceived), "", ""],
    ["Total received", "", "", "", "", "", money(ledger.totals.totalReceived), "", ""],
    ["Invoice balance", "", "", "", "", "", "", money(ledger.totals.invoiceBalance), ""],
    ["Unapplied receipts", "", "", "", "", "", "", money(ledger.totals.unappliedReceived), ""],
    ["Net receivable", "", "", "", "", "", "", money(ledger.totals.netReceivable), ""],
  ];
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

export function downloadLedgerCsv(ledger: CustomerLedger): void {
  const blob = new Blob([ledgerCsv(ledger)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `client-ledger-${fileSafe(ledger.customerName)}-${ledger.asOfIST}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function esc(value: string | number | null | undefined): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function printLedger(ledger: CustomerLedger): void {
  const rows = ledger.entries.map((entry) => `
    <tr class="${entry.status === "advance" || entry.status === "unmatched" ? "unapplied" : ""}">
      <td>${esc(shortDate(entry.date))}</td>
      <td>${esc(typeLabel(entry))}</td>
      <td>${esc(entry.reference)}</td>
      <td>${esc(entry.invoiceNo)}</td>
      <td>${esc(entry.description)}</td>
      <td class="num">${entry.debit ? esc(money(entry.debit)) : ""}</td>
      <td class="num">${entry.credit ? esc(money(entry.credit)) : ""}</td>
      <td class="num">${esc(money(entry.balance))}</td>
      <td>${esc(statusLabel(entry))}</td>
    </tr>`).join("");
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(ledger.customerName)} — client ledger</title>
<style>
  @page { margin: 12mm; }
  body { font-family: Arial, Helvetica, sans-serif; color: #18181b; font-size: 10px; }
  h1 { font-size: 17px; margin: 0 0 2px; }
  .sub { color: #71717a; font-size: 10px; margin-bottom: 10px; }
  .summary { display: flex; gap: 18px; flex-wrap: wrap; margin: 10px 0 12px; }
  .summary div { border: 1px solid #d4d4d8; padding: 5px 8px; min-width: 105px; }
  .summary span { display: block; color: #71717a; font-size: 8px; text-transform: uppercase; letter-spacing: .05em; }
  .summary strong { display: block; margin-top: 2px; font-size: 12px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #d4d4d8; padding: 3px 4px; text-align: left; }
  th { background: #f4f4f5; font-size: 8px; text-transform: uppercase; letter-spacing: .04em; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  tr.unapplied td { background: #fffbeb; }
  tfoot td { font-weight: bold; background: #fafafa; }
</style></head><body>
  <h1>${esc(ledger.customerName)}</h1>
  <div class="sub">${esc(ledger.region || "Unassigned")}${ledger.phone ? ` · ${esc(ledger.phone)}` : ""}${ledger.email ? ` · ${esc(ledger.email)}` : ""} · As of ${esc(ledger.asOfIST)}</div>
  <div class="summary">
    <div><span>Total invoiced</span><strong>₹ ${esc(money(ledger.totals.totalInvoiced))}</strong></div>
    <div><span>Total received</span><strong>₹ ${esc(money(ledger.totals.totalReceived))}</strong></div>
    <div><span>Invoice balance</span><strong>₹ ${esc(money(ledger.totals.invoiceBalance))}</strong></div>
    <div><span>Unapplied receipts</span><strong>₹ ${esc(money(ledger.totals.unappliedReceived))}</strong></div>
    <div><span>Net receivable</span><strong>₹ ${esc(money(ledger.totals.netReceivable))}</strong></div>
  </div>
  <table>
    <thead><tr><th>Date</th><th>Type</th><th>Reference</th><th>Invoice No.</th><th>Description</th><th class="num">Debit</th><th class="num">Credit</th><th class="num">Balance</th><th>Status</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr><td colspan="5">Net receivable</td><td class="num">${esc(money(ledger.totals.totalInvoiced))}</td><td class="num">${esc(money(ledger.totals.totalReceived))}</td><td class="num">${esc(money(ledger.totals.netReceivable))}</td><td></td></tr></tfoot>
  </table>
</body></html>`;
  const win = window.open("", "_blank", "width=1100,height=800");
  if (!win) return;
  win.document.open();
  win.document.write(html);
  win.document.close();
  win.focus();
  win.setTimeout(() => win.print(), 100);
}
