/**
 * Debtors Tracker — overdue receivables CSV export.
 *
 * One row per client with at least one LIVE, PAST-DUE, UNPAID bill.
 * Paid bills and not-yet-due bills never appear (they are not collectible
 * today), and clients with no overdue bill are omitted entirely.
 *
 * MIRROR: backend `src/automations/debtors-tracker/ledger.ts` — only the
 * D0/D31/D61/D91/D181 buckets are past due; `PAID` / `NOT_DUE` are not.
 */
import type { CustomerAgeingRow, LiveInvoice } from "./types";
import { situationLabel } from "./types";
import { downloadCsv, type CsvValue } from "../lib/csv";

const OVERDUE_BUCKETS = new Set<string>(["D0", "D31", "D61", "D91", "D181"]);

export interface OverdueReceivableRow {
  businessName: string;
  /** WhatsApp-ready Indian number: 91XXXXXXXXXX (digits only). */
  whatsappNumber: string;
  /** Sum of the open, past-due bill balances (gross, before customer advances). */
  totalOverdue: number;
  billCount: number;
  /** Client-facing label of the CRM situation ("Promised to pay", "Unset", …). */
  situation: string;
  /** Semicolon-separated, oldest due first. */
  billNumbers: string;
}

/** A bill is collectible only when it has money left AND is past its due date. */
export function isOverdueOpenInvoice(inv: LiveInvoice): boolean {
  return inv.balance > 0.005 && OVERDUE_BUCKETS.has(inv.bucket);
}

/**
 * Normalize an Indian phone to 91XXXXXXXXXX for WhatsApp bulk tools.
 * 10 digits → prefix 91; 0XXXXXXXXXX → drop 0, prefix 91;
 * +91/91XXXXXXXXXX → digits as-is; 0091… → drop 00.
 * Anything else is preserved rather than corrupted.
 */
export function whatsapp91(raw: string | null | undefined): string {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) return `91${digits.slice(1)}`;
  if (digits.length === 12 && digits.startsWith("91")) return digits;
  if (digits.length === 14 && digits.startsWith("0091")) return digits.slice(2);
  return digits;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function billDate(inv: LiveInvoice): string {
  return inv.dueDate || inv.invoiceDate || "";
}

/**
 * Group live invoices by business, keep only overdue-open bills, and return
 * one collectible row per client. Sorted by the largest overdue balance.
 */
export function buildOverdueReceivableRows(
  invoices: LiveInvoice[],
  customers: CustomerAgeingRow[],
): OverdueReceivableRow[] {
  const contactByName = new Map(
    customers.map((c) => [String(c.customerName ?? "").trim(), c] as const),
  );
  const groups = new Map<string, {
    name: string;
    phone: string;
    situation: string;
    total: number;
    bills: LiveInvoice[];
  }>();

  for (const inv of invoices) {
    if (!isOverdueOpenInvoice(inv)) continue;
    const name = String(inv.customerName ?? "").trim();
    if (!name) continue;

    let group = groups.get(name);
    if (!group) {
      const contact = contactByName.get(name);
      group = {
        name,
        phone: String(contact?.phone || inv.contactPhone || "").trim(),
        situation: situationLabel(contact?.situation || "") || "Unset",
        total: 0,
        bills: [],
      };
      groups.set(name, group);
    } else if (!group.phone) {
      const contact = contactByName.get(name);
      group.phone = String(contact?.phone || inv.contactPhone || "").trim();
    }
    group.total += inv.balance;
    group.bills.push(inv);
  }

  return [...groups.values()]
    .map((group) => {
      const bills = [...group.bills].sort((a, b) => {
        const ad = billDate(a) || "9999-12-31";
        const bd = billDate(b) || "9999-12-31";
        return ad.localeCompare(bd)
          || String(a.invoiceNo).localeCompare(String(b.invoiceNo), undefined, { numeric: true });
      });
      const seen = new Set<string>();
      const numbers: string[] = [];
      for (const bill of bills) {
        const no = String(bill.invoiceNo ?? "").trim() || "(no bill no.)";
        if (seen.has(no)) continue;
        seen.add(no);
        numbers.push(no);
      }
      return {
        businessName: group.name,
        whatsappNumber: whatsapp91(group.phone),
        totalOverdue: round2(group.total),
        billCount: bills.length,
        situation: group.situation,
        billNumbers: numbers.join("; "),
      };
    })
    .filter((row) => row.totalOverdue > 0.005 && row.billCount > 0)
    .sort((a, b) => b.totalOverdue - a.totalOverdue || a.businessName.localeCompare(b.businessName));
}

/**
 * Indian currency display: rupee prefix + lakh/crore grouping.
 * 1234567.5 → "₹12,34,567.50". Display only (the raw number stays the source
 * of truth for filtering/sorting); Excel treats it as text, which is the
 * trade-off for showing ₹ in the sheet.
 */
export function formatInrIndian(n: number): string {
  const value = Number.isFinite(n) ? n : 0;
  return `₹${new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)}`;
}

export function overdueReceivablesCsvRows(
  rows: OverdueReceivableRow[],
  /** Global download count, inclusive of the download being written. */
  exportCount = 0,
): CsvValue[][] {
  return [
    [
      "Business Name",
      "WhatsApp Number (91)",
      "Total Overdue (INR)",
      "Pending Bill Count",
      "Count",
      "Situation",
      "Pending Bill Numbers",
    ],
    ...rows.map((row) => [
      row.businessName,
      row.whatsappNumber,
      formatInrIndian(row.totalOverdue),
      row.billCount,
      exportCount,
      row.situation,
      row.billNumbers,
    ]),
  ];
}

export function downloadOverdueReceivablesCsv(
  rows: OverdueReceivableRow[],
  asOfIST: string,
  exportCount = 0,
): void {
  const stamp = String(asOfIST || new Date().toISOString().slice(0, 10)).replace(/[^0-9-]/g, "");
  downloadCsv(
    `debtors-overdue-receivables-${stamp || "today"}.csv`,
    overdueReceivablesCsvRows(rows, exportCount),
  );
}
