// service.ts — NeoDove campaign push orchestration.
//
// Flow: preview (pure selection, no writes) → createPush (batch + ledger rows)
// → runBatch (send one chunk) repeated by the client → cron drain for anything
// left behind. A dry run goes preview → createPush and stops: every ledger row
// is written as `skipped/dry_run` and no network call is made.
//
// Routing: each region has a pair of NeoDove agents (NeoDoveAgent table), each
// with its own campaign URL in a Worker secret. A push either targets one agent
// ("single") or splits the state across the pair ("split") using a stable hash
// of the mobile number — see selection.assignAgents for why it is hashed rather
// than alternated.
//
// Safety rails:
//   - campaign URLs live in Worker secrets (never logged, never returned); only
//     the host is stored on the batch for history.
//   - `NEODOVE_CAMPAIGN_LIVE=1` must be set for a real send. Otherwise the mode
//     always resolves to dry-run, even if the client asks for live.
//   - a push is refused outright if any participating agent has no URL — a
//     half-routed state is worse than a refused one.
//   - non-2xx responses are recorded as failures and NEVER retried (the URL is
//     a non-idempotent POST that creates a lead).
//   - only transport errors are retried, once, because nothing was created.


// Pieces split into ./service-parts/ (importable on their own); re-exported for compat.
export { CampaignError, normalizeRegion, normalizeDistribution, normalizeClientType, extractUrlFromPaste, validateAgentUrl, liveEnabled } from "./service-parts/pure";
export { setAgentCampaignUrl, getCampaignStates, getCampaignPreview, getCampaignBatches, getCampaignTypes, createPush, runBatchChunk, drainPendingPushes } from "./service-parts/io";


