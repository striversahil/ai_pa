// routes.ts — enquiry CRUD orchestrator (thin).
//
// Domain logic lives in focused modules; this file only wires store calls,
// scope checks, and live broadcasts:
//   types.ts    — row/item/comment/thread shapes + daily-no/label helpers
//   parse.ts    — pure parsers (media/rates/thread/qty/money/ISO)
//   queues.ts   — queue predicates (which enquiry sits in which dashboard)
//   scopes.ts   — authz (isRestrictedViewer/canManageRates), margin policy,
//                 money validation, live summaries, creator-agent resolve
//   redaction.ts— procurement-safe AI redaction cache (hash-verified)
//   update.ts   — item lifecycles (normalizeItemWrites/applyRateLifecycles/…)
//   store.ts    — persistence (D1/Memory/Prisma via store-prisma.ts)
// Re-exports below preserve existing `EnquiryRoutes.*` import paths.
import {
  isRestrictedViewer,
  canManageRates,
  canConcludeProcurement,
  canSeeProcurementRequests,
  redactEnquiryPII,
  stripMarginFields,
  normalizeMoneyInput,
  validateRatesInput,
  summarizeEnquiry,
  resolveCreatorAgentId,
  type EnquiryLiveSummary,
} from "./scopes";
import { asRedactedViewCache, hashItem, redactCommentList, redactEnquiryRows, stripQueueMediaUrls } from "./redaction";

// Pieces split into ./routes-parts/ (importable on their own); re-exported for compat.
export type { EnquiryResult, RedactOpts, ProcQueueOpts } from "./routes-parts/types";
export { enquiryList, procurementQueueList, enquiryGetRedacted, enquiryAddRequirement, enquiryUpdate, enquiryDelete, enquiryGet, enquiryComments, enquiryAddComment } from "./routes-parts/pure";
export { enquiryCreate, enquiryIntake } from "./routes-parts/io";

export {
  isRestrictedViewer,
  canManageRates,
  canConcludeProcurement,
  canSeeProcurementRequests,
  redactEnquiryPII,
  stripMarginFields,
  normalizeMoneyInput,
  validateRatesInput,
  summarizeEnquiry,
  resolveCreatorAgentId,
  asRedactedViewCache,
  hashItem,
};

export { getManagementQueues, invalidateManagementQueues } from "./queues-cache";

export type { EnquiryLiveSummary };

// Row redaction + media stripping live in redaction.ts (Phase-1 split);
// re-exported here so existing `EnquiryRoutes.*` call sites keep working.
export { redactCommentList, redactEnquiryRows, stripQueueMediaUrls } from "./redaction";
