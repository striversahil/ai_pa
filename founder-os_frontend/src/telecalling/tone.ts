// tone.ts — light+dark safe colour tones for the telecalling podium UI (PURE).
//
// The old board used dark-only accents (`text-emerald-400`, `text-indigo-300`),
// which drop to ~2:1 contrast on the `light` app preset. Every tone here carries
// a `dark:` pair, so the board reads correctly in all six themes
// (classic / midnight / discord / amoled / nord / light).
//
// Presentational only — the STATUS itself (cleared/ontrack/behind/critical) is
// computed server-side inside the target ledger and must never be re-derived
// here. See `targets.ts` for the labels and the mirror path on the backend.

import type { TargetStatus } from "./targets";

export type TrafficLight = "green" | "amber" | "red";

export interface Tone {
  /** Money/value text — readable on both light and dark surfaces. */
  text: string;
  /** Small pill: border + tint + text. */
  chip: string;
  /** Solid fill for a progress rail. */
  rail: string;
  /** Soft tinted card wash. */
  wash: string;
  /** 1px inset ring for a card edge. */
  ring: string;
  /** Marker / legend dot. */
  dot: string;
}

const EMERALD: Tone = {
  text: "text-emerald-600 dark:text-emerald-400",
  chip: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  rail: "bg-emerald-500",
  wash: "bg-emerald-500/[0.06]",
  ring: "ring-emerald-500/25",
  dot: "bg-emerald-500",
};

const AMBER: Tone = {
  text: "text-amber-600 dark:text-amber-400",
  chip: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  rail: "bg-amber-500",
  wash: "bg-amber-500/[0.06]",
  ring: "ring-amber-500/25",
  dot: "bg-amber-500",
};

const ROSE: Tone = {
  text: "text-rose-600 dark:text-rose-400",
  chip: "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300",
  rail: "bg-rose-500",
  wash: "bg-rose-500/[0.06]",
  ring: "ring-rose-500/25",
  dot: "bg-rose-500",
};

const INDIGO: Tone = {
  text: "text-indigo-600 dark:text-indigo-300",
  chip: "border-indigo-500/30 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300",
  rail: "bg-indigo-500",
  wash: "bg-indigo-500/[0.06]",
  ring: "ring-indigo-500/25",
  dot: "bg-indigo-500",
};

const VIOLET: Tone = {
  text: "text-violet-600 dark:text-violet-300",
  chip: "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300",
  rail: "bg-violet-500",
  wash: "bg-violet-500/[0.06]",
  ring: "ring-violet-500/25",
  dot: "bg-violet-500",
};

const NEUTRAL: Tone = {
  text: "text-[var(--text-secondary)]",
  chip: "border-[var(--border-card)] bg-[var(--surface-sunken)] text-[var(--text-secondary)]",
  rail: "bg-[var(--text-tertiary)]",
  wash: "bg-transparent",
  ring: "ring-transparent",
  dot: "bg-[var(--text-tertiary)]",
};

/** Region target status → tone (mirrors `TARGET_STATUS_*` in targets.ts). */
export const TARGET_TONE: Record<TargetStatus, Tone> = {
  cleared: EMERALD,
  ontrack: EMERALD,
  behind: AMBER,
  critical: ROSE,
};

/** Per-agent KRA traffic light → tone. */
export const TRAFFIC_TONE: Record<TrafficLight, Tone> = {
  green: EMERALD,
  amber: AMBER,
  red: ROSE,
};

/** Fixed accents for the non-region buckets. */
export const BUCKET_TONE = { direct: VIOLET, unlinked: AMBER, neutral: NEUTRAL, accent: INDIGO };
