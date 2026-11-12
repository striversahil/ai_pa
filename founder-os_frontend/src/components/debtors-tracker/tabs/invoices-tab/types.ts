// Extracted verbatim from InvoicesTab.tsx by scripts/refactor/split-module.mjs.
// InvoicesTab.tsx re-exports everything public here, so existing imports keep working.
import type { LiveInvoice } from "@/debtors-tracker/types";
import type { ReactNode } from "react";

export type InvoiceColumn = {
  key: string;
  label?: string;
  align?: "right";
  ariaLabel?: string;
  render: (inv: LiveInvoice) => ReactNode;
};
