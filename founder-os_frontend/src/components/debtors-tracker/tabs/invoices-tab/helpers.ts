// Extracted verbatim from InvoicesTab.tsx by scripts/refactor/split-module.mjs.
// InvoicesTab.tsx re-exports everything public here, so existing imports keep working.
import type { SortSpec } from "@/debtors-tracker/multi-sort";

export const BUCKET_CHIPS = ["ALL", "NOT_DUE", "D0", "D31", "D61", "D91", "D181", "PAID"] as const;

export const INVOICE_TEXT_FIRST = new Set(["customer", "invoice", "dueMonth", "bucket", "status", "owner", "place", "remarks"]);

export const DEFAULT_INVOICE_SORT: SortSpec[] = [{ key: "date", dir: "desc" }];

export const INVOICE_SORT_LABELS: Record<string, string> = {
  customer: "Customer", invoice: "Invoice", date: "Date", due: "Due", dueMonth: "Due Month",
  amount: "Amount", received: "Received", balance: "Balance", overdue: "Overdue",
  bucket: "Bucket", status: "Call / Payment", owner: "Owner", place: "State / Region", remarks: "Remarks",
};

export const DEFAULT_COLUMNS = [
  "customer", "invoice", "pdf", "date", "due", "dueMonth", "amount", "received",
  "balance", "overdue", "bucket", "status", "owner", "place", "remarks", "edit",
] as const;
