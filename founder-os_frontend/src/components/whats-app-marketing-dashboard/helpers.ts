// Extracted verbatim from WhatsAppMarketingDashboard.tsx by scripts/refactor/split-module.mjs.
// WhatsAppMarketingDashboard.tsx re-exports everything public here, so existing imports keep working.


export const statusColor: Record<string, string> = {
  active: "text-emerald-300 bg-emerald-500/10 border-emerald-500/30",
  draft: "text-zinc-700 dark:text-zinc-300 bg-zinc-500/10 border-zinc-500/30",
  paused: "text-amber-300 bg-amber-500/10 border-amber-500/30",
  completed: "text-sky-300 bg-sky-500/10 border-sky-500/30",
  archived: "text-zinc-600 dark:text-zinc-500 bg-zinc-500/5 border-zinc-500/20",
};

export const leadStatusColor: Record<string, string> = {
  pending: "text-zinc-500 dark:text-zinc-400",
  sent: "text-sky-300",
  delivered: "text-emerald-300",
  read: "text-emerald-400",
  failed: "text-rose-400",
};
