"use client";

// position-widgets/TargetTileWidget — sales target tile (phase 1, read-only).
// Presentational: the sales number in, no fetch. Math stays in the sales
// domain (telecalling targets) — this tile only renders the preview figure.
export default function TargetTileWidget({ label, value, sub }: {
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/5 px-3 py-2.5">
      <div className="text-[10px] font-extrabold uppercase tracking-wider text-indigo-400">{label}</div>
      <div className="text-lg font-extrabold text-zinc-800 dark:text-zinc-100">{value}</div>
      <div className="text-[10px] text-zinc-500">{sub}</div>
    </div>
  );
}
