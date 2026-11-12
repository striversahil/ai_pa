// Extracted verbatim from AgeingTab.tsx by scripts/refactor/split-module.mjs.
// AgeingTab.tsx re-exports everything public here, so existing imports keep working.


export type SortKey =
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

export type SortDir = "asc" | "desc";
