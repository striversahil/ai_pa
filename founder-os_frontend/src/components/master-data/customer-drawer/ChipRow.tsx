"use client";

// Extracted verbatim from CustomerDrawer.tsx by scripts/refactor/split-module.mjs.
// CustomerDrawer.tsx re-exports everything public here, so existing imports keep working.
import type { ReactNode } from "react";

export function ChipRow({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>;
}
