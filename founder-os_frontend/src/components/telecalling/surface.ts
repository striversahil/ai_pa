// surface.ts — shared class tokens for the telecalling podium UI.
//
// One place for the surface/text vocabulary so every card in the board agrees.
// Everything routes through the app theme variables (`--bg-card`,
// `--border-card`, `--surface-sunken`, `--text-*`, `--shadow-card`,
// `--ring-color`), which is what makes the board correct in all six presets
// (classic / midnight / discord / amoled / nord / light) instead of only dark.

/** Floating card surface. */
export const CARD =
  "relative overflow-hidden rounded-2xl border border-[var(--border-card)] bg-[var(--bg-card)] shadow-[var(--shadow-card)]";

/** Recessed well for nested content (ledger drawer, staff rail). */
export const WELL = "rounded-xl border border-[var(--border-card)] bg-[var(--surface-sunken)]";

/** 10px uppercase micro-label. */
export const LABEL = "text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--text-tertiary)]";

/** Headline numerals. */
export const NUM = "font-heading font-bold tabular-nums tracking-tight text-[var(--text-primary)]";

/** Keyboard focus ring used by every interactive element on the board. */
export const FOCUS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-color)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--bg-card)]";

/** Quiet secondary button. */
export const BTN =
  `inline-flex items-center justify-center gap-1.5 rounded-lg border border-[var(--border-card)] bg-[var(--bg-card)] px-2.5 py-1.5 text-[11px] font-semibold text-[var(--text-secondary)] transition-colors hover:border-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-300 active:scale-[0.98] ${FOCUS}`;

/** Small status pill. */
export const PILL = "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold";
