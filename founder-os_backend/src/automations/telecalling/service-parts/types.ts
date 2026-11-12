// Extracted verbatim from service.ts by scripts/refactor/split-module.mjs.
// service.ts re-exports everything public here, so existing imports keep working.


export interface TelecallingDailyRow {
  date: string;
  weekday: string;
  telecallerId: string;
  telecallerName: string;
  region: string;
  won: number;
  closedValue: number;
  /** Accepted estimate numbers that day ("EST-.., EST-.." or ""). */
  closedEstimates: string;
  callsAttempted: number;
  callsConnected: number;
  callsNotConnected: number;
  talkTimeMin: number;
  leadsGenerated: number;
  leadsConverted: number;
  score: number;
}

// ── National holidays (sales deficit exclusion) ─────────────────────────────
// Global day list: a holiday accrues ₹0 target like a Sunday. Sunday rows are
// allowed but reported as no-ops. Past or future dates both allowed — the
// ledger recomputes from the start, so backdated marks retroactively shrink
// old dues by design.

export interface SalesHoliday {
  day: string;
  label: string;
  markedBy: string;
  markedByName: string;
  createdAt: string;
  sundayNoOp: boolean;
}
