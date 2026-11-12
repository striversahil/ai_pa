"use client";

// Extracted verbatim from OrderPanel.tsx by scripts/refactor/split-module.mjs.
// OrderPanel.tsx re-exports everything public here, so existing imports keep working.


/** The little separator between identity facts. */
export function Dot() {
  return <span className="text-zinc-300 dark:text-zinc-600">·</span>;
}
