// Extracted verbatim from update.ts by scripts/refactor/split-module.mjs.
// update.ts re-exports everything public here, so existing imports keep working.


export interface ItemWriteCtx {
  storedItems: any[];
  privileged: boolean;
  restricted: boolean;
  actingProcurement: boolean;
  surface?: string;
}

export interface RateWriteCtx {
  storedForItems: any | null;
  storedItems: any[];
  privileged: boolean;
  restricted: boolean;
  /** May stamp the conclude handoff (procurement scope or MIS). Stamp-only,
   *  never clear — clearing stays privileged-only. */
  canConclude?: boolean;
}
