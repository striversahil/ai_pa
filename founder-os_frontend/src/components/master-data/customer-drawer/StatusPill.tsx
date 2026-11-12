"use client";

// Extracted verbatim from CustomerDrawer.tsx by scripts/refactor/split-module.mjs.
// CustomerDrawer.tsx re-exports everything public here, so existing imports keep working.


export function StatusPill({ status }: { status: string }) {
  const active = String(status ?? "").toLowerCase() !== "inactive";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
        active
          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          : "bg-zinc-500/10 text-zinc-500 dark:text-zinc-400"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${active ? "bg-emerald-500" : "bg-zinc-400"}`} />
      {status}
    </span>
  );
}
