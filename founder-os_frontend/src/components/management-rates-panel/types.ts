// Extracted verbatim from ManagementRatesPanel.tsx by scripts/refactor/split-module.mjs.
// ManagementRatesPanel.tsx re-exports everything public here, so existing imports keep working.
import type { Enquiry, EnquiryItem } from "@/types";

export type MarkupMode = "percent" | "final";

export interface ManagementRatesPanelProps {
  enquiry: Enquiry;
  onSave: (items: EnquiryItem[], finalize: boolean) => Promise<void> | void;
}
