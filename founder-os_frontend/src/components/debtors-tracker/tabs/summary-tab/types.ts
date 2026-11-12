// Extracted verbatim from SummaryTab.tsx by scripts/refactor/split-module.mjs.
// SummaryTab.tsx re-exports everything public here, so existing imports keep working.
import { ACCENTS } from "./helpers";

export type Accent = keyof typeof ACCENTS;

export type AdvanceBucketKey = "previousWeek" | "previousMonth" | "advanceWeek" | "advanceMonth";
