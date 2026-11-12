/**
 * Telecalling automation — Sales Leaderboard (region model).
 *
 * Founder decision (2026-10-22): estimates are owned by REGIONS (R1–R4),
 * not individuals. There is no dealing engine, no assignment rotation, no
 * cover/EOD machinery — staff hold and work estimates only in their own
 * region.
 *
 * Founder decision (2026-10-26): ONE leaderboard, ranked by region. Telecallers
 * are children of their region, not a second board. Every region owes ₹1L of
 * accepted value per working day, and a week's shortfall carries forward
 * (targets.ts).
 *
 * Wins/₹/points are computed from ACCEPTED ESTIMATES on their acceptedAt day
 * (accepted.ts) — the close-event ledger is still written for history and the
 * per-estimate export, but a missing ledger row can no longer hide a sale.
 * This module provides runLeadConversion (roster sync + link sweep) and
 * computeTelecallingDashboardData (the full leaderboard payload).
 */
import {
  ZOMBIE_DAYS, FRESH_HOURS, parseCommentDateMs, latestCommentDates,
  classifyRisk, buildSnatchReason, RISK_CACHE_KEY, computeRiskCache, getRiskItems,
  invalidateRiskCache,
  type EstimateRisk, type RiskItem, type CachedRiskItem, type RiskCache,
} from './risk';
import {
  CLOSE_SLABS, closePointsFor, isCloseDelta,
  recordConversionClose,
  deleteCloseHistory, getEpochDate, EPOCH_SETTING_KEY,
  getConvertersMap, SNATCH_PENALTY, REMARK_PENALTY,
} from './scoring';
import { getFollowUpSpecialists, recordAssignment } from './rotation';
import { syncTelecallersFromNeodove } from './roster';
import {
  CALL_TAGS, CALLBACK_MAX_DAYS, setEstimateCallTag,
  NEXT_STEP_MAX_DAYS, setEstimateNextStep, overlayNextSteps, overlayCallTags,
  type CallTag,
} from './call-tags';
import { linkEnquiryEstimate, sweepEnquiryEstimateLinks, type EnquiryLinkResult } from './enquiry-links';
import { REGIONS, TL_LEVELS, DAILY_TL_RESELLER_TARGET, tlRegions, isValidRegion, type RegionId, type TlLevel } from './regions';
import { DATE_RE, IN_BATCH, istDate } from './util';
import {
  loadAcceptedSnapshot, loadCreatorIndex, groupAcceptedByWeek, groupAcceptedByWeekFiltered, roundAgg,
  type AcceptedSnapshot, type AcceptedAgg, type AcceptedEstimate,
} from './accepted';
import {
  buildRegionTargets, weekStartOf, DAILY_REGION_TARGET,
  TARGET_START_KEY, DEFAULT_TARGET_START, type RegionTarget,
  workingDaysBetweenExcluding, isSunday,
} from './targets';

// Pieces split into ./service-parts/ (importable on their own); re-exported for compat.
export { toCloseMultiplier, UNATTRIBUTED_LEADS_KEY, UNATTRIBUTED_CLOSE_KEY, runLeadConversion, periodRange, periodPrefix } from "./service-parts/pure";
export type { TelecallingDailyRow, SalesHoliday } from "./service-parts/types";
export { computeTelecallingDaily, getTelecallingDashboardData, computeTelecallingDashboardData, listSalesHolidays, markSalesHoliday, unmarkSalesHoliday } from "./service-parts/io";

//── Facade re-exports (Phase-R split) ─────────────────────────────────────────
// service.ts keeps the region run + leaderboard; every name moved to a sibling
// module is re-exported here so existing importers (`worker/routes/*`, triggers,
// status-sync, estimate-link) keep working with zero call-site changes.
export {
  ZOMBIE_DAYS, FRESH_HOURS, parseCommentDateMs, latestCommentDates,
  classifyRisk, buildSnatchReason, RISK_CACHE_KEY, computeRiskCache, getRiskItems,
  invalidateRiskCache,
} from './risk';

export type { EstimateRisk, RiskItem, CachedRiskItem, RiskCache } from './risk';

export {
  CLOSE_SLABS, closePointsFor, isCloseDelta,
  recordConversionClose,
  deleteCloseHistory, getEpochDate, EPOCH_SETTING_KEY,
  getConvertersMap, SNATCH_PENALTY, REMARK_PENALTY,
} from './scoring';

export { getFollowUpSpecialists, recordAssignment } from './rotation';

export { syncTelecallersFromNeodove } from './roster';

export {
  CALL_TAGS, CALLBACK_MAX_DAYS, setEstimateCallTag,
  NEXT_STEP_MAX_DAYS, setEstimateNextStep, overlayNextSteps, overlayCallTags,
} from './call-tags';

export type { CallTag } from './call-tags';

export { linkEnquiryEstimate, sweepEnquiryEstimateLinks, type EnquiryLinkResult } from './enquiry-links';

export { REGIONS, TL_LEVELS, DAILY_TL_RESELLER_TARGET, tlRegions, tlPairError, isValidRegion, isValidTlLevel } from './regions';

export type { RegionId, TlLevel, RegionDef } from './regions';

export {
  loadAcceptedSnapshot, loadCreatorIndex, groupAcceptedByWeek, groupAcceptedByWeekFiltered, roundAgg,
} from './accepted';

export type {
  AcceptedSnapshot, AcceptedEstimate, AcceptedBucket, AcceptedAgg, AcceptedBucketKind, CreatorIndex,
} from './accepted';

export {
  buildRegionTargets, weekStartOf, weekEndOf, DAILY_REGION_TARGET,
  WORKING_DAYS_PER_WEEK, TARGET_START_KEY, DEFAULT_TARGET_START,
  workingDaysBetweenExcluding, isSunday,
} from './targets';

export type { RegionTarget, WeekLedgerRow, TargetStatus } from './targets';

export { DATE_RE, IN_BATCH, istDate } from './util';
