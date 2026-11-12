// Extracted verbatim from SheetAnalysisDashboard.tsx by scripts/refactor/split-module.mjs.
// SheetAnalysisDashboard.tsx re-exports everything public here, so existing imports keep working.


export const ACCENT_CLASS: Record<string, { text: string; glow: string }> = {
  indigo: { text: "text-indigo-400", glow: "bg-indigo-500/10" },
  emerald: { text: "text-emerald-400", glow: "bg-emerald-500/10" },
  rose: { text: "text-rose-400", glow: "bg-rose-500/10" },
  amber: { text: "text-amber-400", glow: "bg-amber-500/10" },
  violet: { text: "text-violet-400", glow: "bg-violet-500/10" },
};

export const formatIso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
