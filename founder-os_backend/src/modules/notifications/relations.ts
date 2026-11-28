// ─────────────────────────────────────────────────────────────────────────────
// modules/notifications/relations.ts — GENERATED. Do not edit by hand.
//
// Regenerate with: node scripts/gen-schema-relations.mjs
// Verify (CI guard): node scripts/gen-schema-relations.mjs --check
//
// Compiled from 10 sources:
//   • prisma/schema.prisma + prisma/core/*.prisma  → kind "declared" (@relation)
//   • src/shared/d1-prisma.ts#RELATIONS            → kind "orm"      (runtime joins)
//
// These are the table → table edges the notification AI is allowed to JOIN on.
// Live SQLite foreign keys ("fk") and the curated no-FK application joins
// ("app") are merged at runtime in ./schema.ts.
//
// source-hash: e32d55de43c7
// ─────────────────────────────────────────────────────────────────────────────

export type RelationKind = 'orm' | 'declared';

export interface TableRelation {
  /** Table the edge starts at. */
  from: string;
  /** Column on `from` that holds the key. */
  field: string;
  /** Table the edge points at. */
  model: string;
  /** Column on `model` (almost always `id`). */
  ref: string;
  kind: RelationKind;
}

export const RELATIONS_SOURCE_HASH = "e32d55de43c7";

export const TABLE_RELATIONS: readonly TableRelation[] = [
  { from: "AccountsTaskAttachment", field: "logId", model: "AccountsTaskLog", ref: "id", kind: "orm" },
  { from: "AccountsTaskLog", field: "accountantId", model: "Accountant", ref: "id", kind: "orm" },
  { from: "AccountsTaskLog", field: "logId", model: "AccountsTaskAttachment", ref: "id", kind: "orm" },
  { from: "AccountsTaskLog", field: "templateId", model: "AccountsTaskTemplate", ref: "id", kind: "orm" },
  { from: "AuthRoleScope", field: "roleKey", model: "AuthRole", ref: "key", kind: "declared" },
  { from: "AuthRoleScope", field: "scopeKey", model: "AuthScope", ref: "key", kind: "declared" },
  { from: "AuthSession", field: "userId", model: "AuthUser", ref: "id", kind: "declared" },
  { from: "AuthUserRole", field: "roleKey", model: "AuthRole", ref: "key", kind: "declared" },
  { from: "AuthUserRole", field: "userId", model: "AuthUser", ref: "id", kind: "declared" },
  { from: "AuthUserScope", field: "scopeKey", model: "AuthScope", ref: "key", kind: "declared" },
  { from: "AuthUserScope", field: "userId", model: "AuthUser", ref: "id", kind: "declared" },
  { from: "AutomationRun", field: "automationId", model: "Automation", ref: "id", kind: "declared" },
  { from: "ChatMember", field: "channelId", model: "ChatChannel", ref: "id", kind: "declared" },
  { from: "ChatMember", field: "userId", model: "AuthUser", ref: "id", kind: "declared" },
  { from: "ChatMessage", field: "channelId", model: "ChatChannel", ref: "id", kind: "declared" },
  { from: "ChatMessage", field: "senderId", model: "AuthUser", ref: "id", kind: "declared" },
  { from: "ChatReadState", field: "channelId", model: "ChatChannel", ref: "id", kind: "declared" },
  { from: "ChatReadState", field: "userId", model: "AuthUser", ref: "id", kind: "declared" },
  { from: "Classification", field: "estimateId", model: "Estimate", ref: "estimateId", kind: "declared" },
  { from: "Comment", field: "estimateId", model: "Estimate", ref: "estimateId", kind: "declared" },
  { from: "CoreActionEvent", field: "actionId", model: "CoreAction", ref: "id", kind: "declared" },
  { from: "CrmSalesOrder", field: "soId", model: "CrmSoItem", ref: "id", kind: "orm" },
  { from: "CrmSalesOrder", field: "soId", model: "CrmScheduleEvent", ref: "id", kind: "orm" },
  { from: "DigitalMarketingAd", field: "adId", model: "DigitalMarketingAdAttachment", ref: "id", kind: "orm" },
  { from: "DigitalMarketingAdAttachment", field: "adId", model: "DigitalMarketingAd", ref: "id", kind: "orm" },
  { from: "DigitalMarketingOpenTask", field: "taskId", model: "DigitalMarketingOpenTaskEntry", ref: "id", kind: "orm" },
  { from: "DigitalMarketingOpenTask", field: "taskId", model: "DigitalMarketingOpenTaskAttachment", ref: "id", kind: "orm" },
  { from: "DigitalMarketingOpenTaskAttachment", field: "entryId", model: "DigitalMarketingOpenTaskEntry", ref: "id", kind: "orm" },
  { from: "DigitalMarketingOpenTaskAttachment", field: "taskId", model: "DigitalMarketingOpenTask", ref: "id", kind: "orm" },
  { from: "DigitalMarketingOpenTaskEntry", field: "entryId", model: "DigitalMarketingOpenTaskAttachment", ref: "id", kind: "orm" },
  { from: "DigitalMarketingOpenTaskEntry", field: "taskId", model: "DigitalMarketingOpenTask", ref: "id", kind: "orm" },
  { from: "DigitalMarketingTaskAttachment", field: "logId", model: "DigitalMarketingTaskLog", ref: "id", kind: "orm" },
  { from: "DigitalMarketingTaskLog", field: "accountantId", model: "DigitalMarketingManager", ref: "id", kind: "orm" },
  { from: "DigitalMarketingTaskLog", field: "logId", model: "DigitalMarketingTaskAttachment", ref: "id", kind: "orm" },
  { from: "DigitalMarketingTaskLog", field: "templateId", model: "DigitalMarketingTaskTemplate", ref: "id", kind: "orm" },
  { from: "EnquiryComment", field: "enquiryId", model: "Enquiry", ref: "id", kind: "declared" },
  { from: "Estimate", field: "estimateId", model: "Comment", ref: "id", kind: "orm" },
  { from: "Estimate", field: "estimateId", model: "Classification", ref: "id", kind: "orm" },
  { from: "EstimateAssignment", field: "estimateId", model: "Estimate", ref: "estimateId", kind: "declared" },
  { from: "EstimateAssignment", field: "estimateId", model: "Estimate", ref: "id", kind: "orm" },
  { from: "EstimateAssignment", field: "telecallerId", model: "Telecaller", ref: "id", kind: "orm" },
  { from: "HumanResourcesAsset", field: "assetTypeId", model: "HumanResourcesAssetType", ref: "id", kind: "orm" },
  { from: "HumanResourcesAsset", field: "memberId", model: "HumanResourcesMember", ref: "id", kind: "orm" },
  { from: "HumanResourcesAssetType", field: "assetTypeId", model: "HumanResourcesAsset", ref: "id", kind: "orm" },
  { from: "HumanResourcesAssetType", field: "assetTypeId", model: "HumanResourcesPositionAsset", ref: "id", kind: "orm" },
  { from: "HumanResourcesAttendance", field: "memberId", model: "HumanResourcesMember", ref: "id", kind: "orm" },
  { from: "HumanResourcesDocumentType", field: "documentTypeId", model: "HumanResourcesMemberDocument", ref: "id", kind: "orm" },
  { from: "HumanResourcesExpense", field: "categoryId", model: "HumanResourcesExpenseCategory", ref: "id", kind: "orm" },
  { from: "HumanResourcesExpenseCategory", field: "categoryId", model: "HumanResourcesExpense", ref: "id", kind: "orm" },
  { from: "HumanResourcesHiringPosition", field: "positionId", model: "HumanResourcesPositionDoc", ref: "id", kind: "orm" },
  { from: "HumanResourcesInventoryItem", field: "itemId", model: "HumanResourcesInventoryTxn", ref: "id", kind: "orm" },
  { from: "HumanResourcesInventoryTxn", field: "itemId", model: "HumanResourcesInventoryItem", ref: "id", kind: "orm" },
  { from: "HumanResourcesLeave", field: "memberId", model: "HumanResourcesMember", ref: "id", kind: "orm" },
  { from: "HumanResourcesMember", field: "assignedToId", model: "HumanResourcesTask", ref: "id", kind: "orm" },
  { from: "HumanResourcesMember", field: "memberId", model: "HumanResourcesSalaryComponent", ref: "id", kind: "orm" },
  { from: "HumanResourcesMember", field: "memberId", model: "HumanResourcesAttendance", ref: "id", kind: "orm" },
  { from: "HumanResourcesMember", field: "memberId", model: "HumanResourcesLeave", ref: "id", kind: "orm" },
  { from: "HumanResourcesMember", field: "memberId", model: "HumanResourcesSalarySlip", ref: "id", kind: "orm" },
  { from: "HumanResourcesMember", field: "memberId", model: "HumanResourcesMemberDocument", ref: "id", kind: "orm" },
  { from: "HumanResourcesMember", field: "memberId", model: "HumanResourcesAsset", ref: "id", kind: "orm" },
  { from: "HumanResourcesMember", field: "salaryTemplateId", model: "HumanResourcesSalaryTemplate", ref: "id", kind: "orm" },
  { from: "HumanResourcesMember", field: "shiftId", model: "HumanResourcesShift", ref: "id", kind: "orm" },
  { from: "HumanResourcesMemberDocument", field: "documentTypeId", model: "HumanResourcesDocumentType", ref: "id", kind: "orm" },
  { from: "HumanResourcesMemberDocument", field: "memberId", model: "HumanResourcesMember", ref: "id", kind: "orm" },
  { from: "HumanResourcesPositionAsset", field: "assetTypeId", model: "HumanResourcesAssetType", ref: "id", kind: "orm" },
  { from: "HumanResourcesPositionAsset", field: "orgPositionId", model: "OrgChartPosition", ref: "id", kind: "orm" },
  { from: "HumanResourcesPositionDoc", field: "positionId", model: "HumanResourcesHiringPosition", ref: "id", kind: "orm" },
  { from: "HumanResourcesSalaryComponent", field: "memberId", model: "HumanResourcesMember", ref: "id", kind: "orm" },
  { from: "HumanResourcesSalaryComponent", field: "templateId", model: "HumanResourcesSalaryTemplate", ref: "id", kind: "orm" },
  { from: "HumanResourcesSalarySlip", field: "memberId", model: "HumanResourcesMember", ref: "id", kind: "orm" },
  { from: "HumanResourcesSalaryTemplate", field: "salaryTemplateId", model: "HumanResourcesMember", ref: "id", kind: "orm" },
  { from: "HumanResourcesSalaryTemplate", field: "templateId", model: "HumanResourcesSalaryTemplateComponent", ref: "id", kind: "orm" },
  { from: "HumanResourcesSalaryTemplateComponent", field: "templateId", model: "HumanResourcesSalaryTemplate", ref: "id", kind: "orm" },
  { from: "HumanResourcesTask", field: "assignedToId", model: "HumanResourcesMember", ref: "id", kind: "orm" },
  { from: "HumanResourcesTask", field: "taskId", model: "HumanResourcesTaskLog", ref: "id", kind: "orm" },
  { from: "HumanResourcesTaskLog", field: "taskId", model: "HumanResourcesTask", ref: "id", kind: "orm" },
  { from: "KypGuide", field: "productId", model: "ProductItem", ref: "id", kind: "orm" },
  { from: "MarketingCampaign", field: "campaignId", model: "MarketingLead", ref: "id", kind: "orm" },
  { from: "MarketingCampaign", field: "campaignId", model: "MarketingCampaignRun", ref: "id", kind: "orm" },
  { from: "MarketingCampaignRun", field: "campaignId", model: "MarketingCampaign", ref: "id", kind: "declared" },
  { from: "MarketingLead", field: "campaignId", model: "MarketingCampaign", ref: "id", kind: "declared" },
  { from: "MessageLineage", field: "taskId", model: "WaTask", ref: "id", kind: "orm" },
  { from: "OrgChartPosition", field: "orgPositionId", model: "HumanResourcesPositionAsset", ref: "id", kind: "orm" },
  { from: "OverrideLog", field: "taskId", model: "WaTask", ref: "id", kind: "orm" },
  { from: "ProductItem", field: "productId", model: "KypGuide", ref: "id", kind: "orm" },
  { from: "ProductItem", field: "productId", model: "VendorRate", ref: "id", kind: "orm" },
  { from: "StockItem", field: "itemId", model: "StockMovement", ref: "id", kind: "orm" },
  { from: "StockItem", field: "itemId", model: "StockReservation", ref: "id", kind: "orm" },
  { from: "StockMovement", field: "itemId", model: "StockItem", ref: "id", kind: "orm" },
  { from: "StockReservation", field: "itemId", model: "StockItem", ref: "id", kind: "declared" },
  { from: "TelecallerScoreEvent", field: "telecallerId", model: "Telecaller", ref: "id", kind: "orm" },
  { from: "Vendor", field: "vendorId", model: "VendorRate", ref: "id", kind: "orm" },
  { from: "VendorRate", field: "productId", model: "ProductItem", ref: "id", kind: "orm" },
  { from: "VendorRate", field: "vendorId", model: "Vendor", ref: "id", kind: "orm" },
  { from: "WaAction", field: "taskId", model: "WaTask", ref: "id", kind: "orm" },
  { from: "WaTask", field: "taskId", model: "WaTaskHistory", ref: "id", kind: "orm" },
  { from: "WaTask", field: "taskId", model: "WaAction", ref: "id", kind: "orm" },
  { from: "WaTaskHistory", field: "taskId", model: "WaTask", ref: "id", kind: "orm" },
];

/** Edges grouped by their source table (built once — read by schema.ts). */
export const RELATIONS_BY_TABLE: Record<string, TableRelation[]> = (() => {
  const out: Record<string, TableRelation[]> = {};
  for (const e of TABLE_RELATIONS) (out[e.from] ??= []).push(e);
  return out;
})();
