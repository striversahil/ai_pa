// store.ts — D1 persistence for the Customer push.
//
// Raw SQL (no Prisma shim) — same pattern master-data owns, and core_customer
// is READ ONLY here. Pieces live in ./store-parts/ so each stays importable on
// its own; this file re-exports the public surface.

export { pushDb } from './store-parts/db';
export { listDialerAgents, listDialerTeamLeads } from './store-parts/roster';
export {
  listCustomersByState, listStateCounts, listDistrictCounts, listTypeCounts,
  lastLivePushes, lastDistrictPushes,
} from './store-parts/book';
export {
  insertBatch, getBatch, updateBatch, recountBatch, listBatches,
  insertLeadRows, markOutcomes, markSkipped,
} from './store-parts/ledger';
export type { LeadOutcome } from './store-parts/ledger';
