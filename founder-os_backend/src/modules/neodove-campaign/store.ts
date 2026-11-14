// store.ts — D1 persistence for NeoDove campaign pushes.
//
// Raw SQL (no Prisma shim): the Customer Master module already owns that
// pattern and this table set is Worker-only. MasterCustomer is READ ONLY here.


// Pieces split into ./store-parts/ (importable on their own); re-exported for compat.
export { campaignDb, listAgents, listTeamLeads, getAgentRow, setAgentUrl, agentTallies, listCustomersByState, listStateCounts, listDistrictCounts, lastDistrictPushes, listTypeCounts, lastLivePushes, insertBatch, getBatch, updateBatch, recountBatch, listBatches, insertLeadRows, recoverStuckClaims, claimPending, markOutcomes, listFailedLeads, batchesWithPending } from "./store-parts/io";
export type { LeadOutcome } from "./store-parts/types";


