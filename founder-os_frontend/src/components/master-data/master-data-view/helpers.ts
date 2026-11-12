// Extracted verbatim from MasterDataView.tsx by scripts/refactor/split-module.mjs.
// MasterDataView.tsx re-exports everything public here, so existing imports keep working.
import dynamic from "next/dynamic";

export const CustomerDrawer = dynamic(() => import("../CustomerDrawer"), { ssr: false });

export const EditorsPanel = dynamic(() => import("../EditorsPanel"), { ssr: false });

export const ImportModal = dynamic(() => import("../ImportModal"), { ssr: false });

export const DUPLICATE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "All rows" },
  { value: "all", label: "All duplicates" },
  { value: "open", label: "Needs review" },
  { value: "reviewed", label: "Reviewed" },
  { value: "High", label: "High confidence" },
  { value: "Medium", label: "Medium confidence" },
  { value: "Review", label: "Review tier" },
];
