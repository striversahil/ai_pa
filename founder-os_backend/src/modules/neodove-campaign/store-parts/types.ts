// Extracted verbatim from store.ts by scripts/refactor/split-module.mjs.
// store.ts re-exports everything public here, so existing imports keep working.


export interface LeadOutcome {
  id: string;
  ok: boolean;
  httpStatus: number | null;
  body: string;
}
