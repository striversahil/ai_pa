# Reusable building blocks (generated)

Everything below was split out of an oversized file by `scripts/refactor/split-module.mjs` and is importable on its own. The original files still re-export every name they exported before, so existing imports keep working. Regenerate this list after future splits.

Conventions: frontend `<Name>.tsx` = one component, `helpers.ts` = non-UI helpers, `types.ts` = types. Backend `pure.ts` = logic with **no** DB/cache/network access (safe to reuse anywhere), `io.ts` = the parts that do I/O, `types.ts` = types. `pure.ts` never imports `io.ts`.

Shared kits: `@/components/ui` (Badge, Card, KpiCard, Skeleton, EmptyState/ErrorState, Table, TabBar, **Modal**, ConfirmDialog, Popover) · `@/lib/format` (money/date formatters) · `@/workspaces` (WorkspaceRenderer, workspaceDataUrl, useWorkspaces, useWorkspaceHost) · backend `worker/viewer.ts` (getViewer/getViewerMe), `worker/http.ts` (readBody), `modules/workspaces/` (catalog, scoping, getWorkspaceData).

## Frontend (120 files)


### `components/accounts-dashboard/`
- `Controller.tsx` — components: `Controller`
- `ExportCard.tsx` — components: `ExportCard`
- `FreqChip.tsx` — components: `FreqChip`
- `RosterRowEditor.tsx` — components: `RosterRowEditor`
- `StatusChip.tsx` — components: `StatusChip`
- `TaskRow.tsx` — components: `TaskRow`
- `TeamBoard.tsx` — components: `TeamBoard`
- `TemplateCreator.tsx` — components: `TemplateCreator`
- `helpers.ts` — functions/values: `FREQS`, `ROLES`, `fmtSize`, `fmtDur`, `fmtShort`, `istToday`, `shiftDay`, `matchSelfRoster`, `ACTOR_KEY`, `fmtToday`, `csvCell`, `PATTERN_MONTHS`, `PATTERN_WEEKDAYS`, `WEEKDAY_NUM`, `PATTERNS`, `ord`, `parseDayList`, `buildTemplateBody`
- `types.ts` — types: `FileItem`, `TaskItem`, `UnscheduledItem`, `RosterRow`, `TemplateRow`, `TeamMember`, `FreqStat`, `TeamData`, `DashData`, `AccountsView`, `LaneStat`, `PatternKey`

### `components/accounts/payment-dues/`
- `Amount.tsx` — components: `Amount`
- `Countdown.tsx` — components: `Countdown`
- `DueFormDialog.tsx` — components: `DueFormDialog`
- `Modal.tsx` — components: `Modal`
- `PayDialog.tsx` — components: `PayDialog`
- `helpers.ts` — functions/values: `PAYMENT_CATEGORIES`, `identifierMeta`, `BUCKETS`, `fmtDateTime`, `WEEKDAY_SHORT`, `MONTH_SHORT`, `schedLabel`, `inputCls`, `postJson`, `groupBills`
- `types.ts` — types: `PaymentAttachment`, `PaymentDueRow`, `PaymentSummary`, `MainTab`, `Bucket`, `BillGroup`

### `components/debtors-tracker/tabs/ageing-tab/`
- `PromiseBadge.tsx` — components: `PromiseBadge`
- `SituationBadge.tsx` — components: `SituationBadge`
- `helpers.ts` — functions/values: `DUE_COLS`, `defaultDir`, `SITUATION_ORDER`, `SITUATION_BADGE`
- `types.ts` — types: `SortKey`, `SortDir`

### `components/debtors-tracker/tabs/invoices-tab/`
- `helpers.ts` — functions/values: `BUCKET_CHIPS`, `INVOICE_TEXT_FIRST`, `DEFAULT_INVOICE_SORT`, `INVOICE_SORT_LABELS`, `DEFAULT_COLUMNS`
- `types.ts` — types: `InvoiceColumn`

### `components/debtors-tracker/tabs/summary-tab/`
- `AdvanceQuadrant.tsx` — components: `AdvanceQuadrant`
- `MetricCard.tsx` — components: `MetricCard`
- `RegionStrip.tsx` — components: `RegionStrip`
- `SectionHeading.tsx` — components: `SectionHeading`
- `helpers.ts` — functions/values: `ACCENTS`, `dayOffset`, `dayLabel`, `mondayOf`, `sumAmounts`, `ADVANCE_TONES`, `REGION_TILE_TONES`
- `types.ts` — types: `Accent`, `AdvanceBucketKey`

### `components/digital-marketing-ads/`
- `AdCard.tsx` — components: `AdCard`
- `NewAdRunModal.tsx` — components: `NewAdRunModal`
- `StatusPill.tsx` — components: `StatusPill`
- `helpers.ts` — functions/values: `int`, `TYPE_META`, `todayIST`, `dateProgress`, `inputCls`, `labelCls`, `uploadAdFile`
- `types.ts` — types: `AdType`, `AdStatus`, `AdAttachment`, `AdRow`, `AdsPayload`

### `components/digital-marketing-dashboard/`
- `Controller.tsx` — components: `Controller`
- `ExportCard.tsx` — components: `ExportCard`
- `FreqChip.tsx` — components: `FreqChip`
- `RosterRowEditor.tsx` — components: `RosterRowEditor`
- `StatusChip.tsx` — components: `StatusChip`
- `TaskRow.tsx` — components: `TaskRow`
- `TemplateCreator.tsx` — components: `TemplateCreator`
- `helpers.ts` — functions/values: `FREQS`, `fmtSize`, `fmtDur`, `fmtShort`, `matchSelfRoster`, `fmtToday`, `csvCell`, `PATTERN_MONTHS`, `PATTERN_WEEKDAYS`, `WEEKDAY_NUM`, `PATTERNS`, `ord`, `parseDayList`, `buildTemplateBody`
- `types.ts` — types: `FileItem`, `MetricField`, `TaskItem`, `UnscheduledItem`, `RosterRow`, `TemplateRow`, `FreqStat`, `DashData`, `DigitalMarketingView`, `PatternKey`

### `components/enquiry-detail/`
- `types.ts` — types: `EnquiryDetailProps`

### `components/field-staff-panel/`
- `CheckInBar.tsx` — components: `CheckInBar`
- `FollowupBox.tsx` — components: `FollowupBox`
- `FollowupToggle.tsx` — components: `FollowupToggle`
- `MillFacts.tsx` — components: `MillFacts`
- `MillList.tsx` — components: `MillList`
- `OpenVisitBanner.tsx` — components: `OpenVisitBanner`
- `StatusDot.tsx` — components: `StatusDot`
- `VisitCard.tsx` — components: `VisitCard`
- `helpers.ts` — functions/values: `inputCls`

### `components/layout/sidebar/`
- `helpers.ts` — functions/values: `DASH_ICONS`
- `types.ts` — types: `SidebarRow`, `SidebarProps`

### `components/management-rates-panel/`
- `types.ts` — types: `MarkupMode`, `ManagementRatesPanelProps`

### `components/management-review/`
- `PageJumper.tsx` — components: `PageJumper`
- `helpers.ts` — functions/values: `isManagementPending`, `pageWindow`

### `components/manual-calls-panel/`
- `helpers.ts` — functions/values: `DAY_RE`, `istToday`, `monthRange`, `shiftMonth`
- `types.ts` — types: `Agent`, `Entry`, `Payload`

### `components/master-data/customer-drawer/`
- `ChipRow.tsx` — components: `ChipRow`
- `Pill.tsx` — components: `Pill`
- `StatusPill.tsx` — components: `StatusPill`
- `helpers.ts` — functions/values: `DRAFT_KEYS`, `MANAGER_KEYS`, `REGIONS`, `toDraft`, `draftToPatch`
- `types.ts` — types: `Draft`

### `components/master-data/master-data-view/`
- `Kpi.tsx` — components: `Kpi`
- `helpers.ts` — functions/values: `CustomerDrawer`, `EditorsPanel`, `ImportModal`, `DUPLICATE_OPTIONS`

### `components/neodove-telecaller-dashboard/`
- `KraBar.tsx` — components: `KraBar`
- `helpers.ts` — functions/values: `REFRESH_MS`, `PRESETS`, `DATE_RE`, `istToday`, `addDays`, `computeRange`, `fmtRangeLabel`, `LIGHT_TEXT`, `LIGHT_BG`, `LIGHT_CHIP`, `fmtTalkTime`, `fmtNum`
- `types.ts` — types: `TrafficLight`, `Kra`, `AgentRow`, `Totals`, `DataResponse`, `PresetKey`

### `components/procurement-queue/`
- `EnquiryStatus.tsx` — components: `EnquiryStatus`
- `helpers.ts` — functions/values: `isProcurementPending`, `byNewest`
- `types.ts` — types: `EnquiryList`

### `components/product-line-dashboard/`
- `ModalFoot.tsx` — components: `ModalFoot`
- `ModalShell.tsx` — components: `ModalShell`
- `helpers.ts` — functions/values: `panel`, `field`, `label`, `primaryBtn`, `ghostBtn`, `dangerBtn`, `iconBtn`, `api`, `fmtINR`, `isHttpUrl`, `isPhotoValue`, `isNum`, `shortDate`, `HUES`, `hueFor`, `attrLabel`, `specSummary`
- `types.ts` — types: `ProductRow`, `GuideRow`, `VendorRow`, `RateRow`, `Payload`, `Detail`

### `components/sales-controller-panel/`
- `ExportDataSection.tsx` — components: `ExportDataSection`
- `HistoryResetSection.tsx` — components: `HistoryResetSection`
- `RosterEditModal.tsx` — components: `RosterEditModal`
- `RosterSection.tsx` — components: `RosterSection`
- `UnmappedSection.tsx` — components: `UnmappedSection`
- `helpers.ts` — functions/values: `TELECALLING_EVENTS`, `hasSalesManagerAccess`, `downloadCsv`, `EXPORT_PERIODS`

### `components/sheet-analysis-dashboard/`
- `helpers.ts` — functions/values: `ACCENT_CLASS`, `formatIso`
- `types.ts` — types: `Kpi`, `Warning`, `Table`, `Insight`, `SheetData`

### `components/specifications-section/`
- `helpers.ts` — functions/values: `MAX_MEDIA_BYTES`
- `types.ts` — types: `SpecificationsSectionProps`

### `components/telecalling-dashboard/`
- `CallTagControl.tsx` — components: `CallTagControl`
- `KraBar.tsx` — components: `KraBar`
- `LeadChips.tsx` — components: `LeadChips`
- `NextStepControl.tsx` — components: `NextStepControl`
- `OrgBadge.tsx` — components: `OrgBadge`
- `QueryErrorBanner.tsx` — components: `QueryErrorBanner`
- `SatChip.tsx` — components: `SatChip`
- `ShieldChip.tsx` — components: `ShieldChip`
- `SnatchChip.tsx` — components: `SnatchChip`
- `StaleChip.tsx` — components: `StaleChip`
- `helpers.ts` — functions/values: `CALL_TAG_META`, `localIsoDay`, `kraStatus`, `regionKey`, `regionQuery`, `adaptLeaderRow`, `adaptBoardStaff`, `adaptDashData`, `adaptAgentView`, `TELECALLING_EVENTS`, `TABS`, `fmtTalk`, `fmtNum`, `fmtLakh`, `convTier`, `LIGHT_TEXT`, `LIGHT_BG`, `LIGHT_CHIP`, `worst`, `OVERALL_LABEL`
- `types.ts` — types: `LeaderRow`, `RiskRow`, `RegionInfo`, `BoardClosedItemLite`, `UnmappedItem`, `UnmappedAcceptedItem`, `DashData`, `DailyRow`, `FollowUp`, `CallTagValue`, `CallTagDelta`, `AgentViewData`, `RosterRow`, `View`, `TrafficLight`

### `components/telecalling/neo-dove-campaign-section/`
- `AgentUrlRow.tsx` — components: `AgentUrlRow`
- `helpers.ts` — functions/values: `jsonFetch`
- `types.ts` — types: `Props`

### `components/user-admin/`
- `helpers.ts` — functions/values: `fmtDate`
- `types.ts` — types: `Tab`

### `components/whats-app-dashboard/`
- `types.ts` — types: `Digest`, `Contact`, `RawMessage`, `PendingItem`, `PendingChat`

### `components/whats-app-marketing-dashboard/`
- `Kpi.tsx` — components: `Kpi`
- `MiniStat.tsx` — components: `MiniStat`
- `helpers.ts` — functions/values: `statusColor`, `leadStatusColor`
- `types.ts` — types: `LeadStats`, `Campaign`, `DashboardData`

### `components/zoho-estimates/`
- `helpers.ts` — functions/values: `KPI_FILTERS`

### `crm/order-panel/`
- `AddressCard.tsx` — components: `AddressCard`
- `DetailRow.tsx` — components: `DetailRow`
- `Dot.tsx` — components: `Dot`
- `EmptyProofDoc.tsx` — components: `EmptyProofDoc`
- `ItemStateChip.tsx` — components: `ItemStateChip`
- `ProofCard.tsx` — components: `ProofCard`
- `ProofDoc.tsx` — components: `ProofDoc`
- `ReasonBox.tsx` — components: `ReasonBox`
- `helpers.ts` — functions/values: `uploadProofFile`, `dateLabel`, `fullDateLabel`, `regionName`, `ageLabel`, `isPhotoFile`, `isPdfFile`, `proofFileFromId`
- `types.ts` — types: `PanelMode`

## Backend (72 files)


### `automations/accounts/seed-tasks-parts/`
- `pure.ts` — functions/values: `SEED_TASKS`
- `types.ts` — types: `AccountsSeedTask`

### `automations/accounts/service-parts/`
- `io.ts` — functions/values: `ensureSeedTemplates`, `ensureInstances`, `splitSharedMains`, `getCarriedOverdue`, `runDailyRollover`, `invalidateAccountsCache`, `computeDashboard`, `getAccountsDashboardData`, `getAccountsExport`, `resolveSelfAccountant`, `listAccountants`, `createAccountant`, `updateAccountant`, `listTemplates`, `createTemplate`, `updateTemplate`, `logTask`, `getPaymentTemplates`, `paymentAttachmentsByLog`, `getPaymentDues`, `getPaymentHistory`, `ensurePaymentInstance`, `payDue`, `createAttachmentRecord`, `getAttachment` …
- `pure.ts` — functions/values: `FREQUENCIES`, `OWNER_ROLES`, `PAYMENT_CATEGORIES`, `LOG_STATUSES`, `DATA_TTL_MS`, `DATA_CACHE_PREFIX`, `SLOT_MAIN`, `SLOT_SENIOR`, `SLOT_JUNIOR`, `LANE_SLOTS`, `slotsFor`, `slotKey`, `istDateStr`, `parseDay`, `fmtDay`, `daysInMonth`, `MONTH_NUM`, `WEEKDAY_NUM`, `UNSCHEDULED_RULES`, `monthNum`, `occurrenceMatch`, `evalRule`, `parseRule`, `dueDateForStatement`, `isOffsetDueOn` …
- `types.ts` — types: `LaneScope`, `PaymentBucket`, `PaymentAttachment`, `PaymentDueRow`, `PaymentSummary`

### `automations/debtors-tracker/imports-parts/`
- `io.ts` — functions/values: `bookUnmatched`, `importDebtors`, `importCollections`, `updateInvoiceFields`, `deleteInvoice`, `deleteCollection`, `resetDebtorsTracker`
- `pure.ts` — functions/values: `invKeyOf`, `custKeyOf`, `compositeKey`, `resolveBaseReceived`, `pickUnmatched`, `collectionDedupKey`, `pickInvoiceForCollection`, `INVOICE_EDITABLE_FIELDS`, `FOLLOW_UP_FIELDS`
- `types.ts` — types: `UnmatchedIndex`, `InvoiceEditableField`

### `automations/debtors-tracker/types-parts/`
- `pure.ts` — functions/values: `DEBTOR_COLUMNS_LEGEND`, `COLLECTION_COLUMNS_LEGEND`, `BUCKETS`, `BUCKET_LABELS`, `bucketFromPastedLabel`, `normalizeCustomerName`, `normalizeCustomerKey`, `normalizeInvoiceNo`
- `types.ts` — types: `DebtorRow`, `CollectionRow`, `InvoiceNoConflict`, `ImportConflict`, `DebtorImportReport`, `CollectionImportReport`, `DebtorsTrackerPayload`, `CustomerAgeingRow`, `LiveInvoice`, `Bucket`, `ReceiptBucketKey`, `ReceiptBucketCell`, `ReceiptBucketWindow`, `ReceiptAgeingSplit`, `LiveCollection` …

### `automations/human-resources/service-parts/`
- `io.ts` — functions/values: `resolveSelfHumanResourcesMember`, `computeDashboard`, `getHumanResourcesDashboardData`, `listMembers`, `createMember`, `updateMember`, `ensureAssignableMember`, `createTask`, `updateTask`, `deleteTask`, `createExpense`, `updateExpense`, `deleteExpense`, `createFundTxn`, `updateFundTxn`, `deleteFundTxn`
- `pure.ts` — functions/values: `normId`, `emailTokens`, `expenseJson`, `fundTxnJson`

### `automations/neodove-refresh-parts/`
- `io.ts` — functions/values: `fetchLeadsGenerated`, `fetchRosterUserIds`, `probeNeodoveDirectory`, `refreshNeodoveReport`
- `pure.ts` — functions/values: `NEODOVE_API`, `DAYS`, `MONTHS`, `istDateStr`, `istRangeStrings`, `rowDateStr`, `istDayEpochRange`, `NEODOVE_PIPELINE_ID`, `NEODOVE_LEAD_STAGE_ID`, `normalizeRow`

### `automations/neodove-telecaller-report/index-parts/`
- `io.ts` — functions/values: `loadReportsInRange`, `invalidateNeodoveCache`, `getNeodoveAgentMap`, `getAllNeodoveAgents`, `getNeodoveRangeMap`, `getLatestNeodoveDay`, `loadZohoNameMap`, `loadZohoByAgent`, `data`
- `pure.ts` — functions/values: `CONNECTED_CALLS_PER_DAY`, `LEADS_PER_AGENT_PER_DAY`, `NUMERIC_KEYS`, `DATE_RE`, `aggregate`, `lightFor`, `ORDER`, `computeAgentKra`, `handler`
- `types.ts` — types: `NeodoveAgentRow`, `TrafficLight`, `AgentKra`

### `automations/product-line/intake-parts/`
- `io.ts` — functions/values: `ensureVendorId`, `ensureProductId`, `fileDraft`, `liveCategories`, `requiredSpecs`, `fullChecklist`, `specDetails`, `specLabels`, `dedupeRates`, `refreshMissing`, `execTool`, `executeProposal`, `TOOL_DEFS`, `productLineIntakeDef`
- `pure.ts` — functions/values: `parseAttrValues`, `parseMissingList`, `rateCard`, `SPEC_FILLER`, `SPEC_SYNONYMS`, `SPEC_SYN_MAP`, `specTokens`, `specTokenHits`, `resolveSpecKeys`, `captureSpecs`, `canonicalAttrKey`, `missing`, `validDate`, `norm`, `vendorCanon`, `aliasList`, `matchVendors`, `matchProducts`, `pageArgs`, `includes`
- `types.ts` — types: `IntakeCtx`, `IntakeDraft`, `FiledRate`

### `automations/product-line/service-parts/`
- `io.ts` — functions/values: `getProductLineData`, `invalidateProductLineCache`, `getProductIndex`, `invalidateProductIndex`, `getRatesForProduct`, `invalidateProductRatesCache`, `getRateById`, `getVendorIndex`, `invalidateVendorIndex`, `countRatesForVendor`, `countActiveRatesForVendor`, `getProductDetail`, `invalidateProductDetailCache`
- `pure.ts` — functions/values: `DATA_KEY`, `DATA_TTL_MS`, `parseAliases`, `parseAttrValues`, `parseCondition`, `parseMissingSpecs`, `INDEX_KEY`, `INDEX_TTL_MS`, `RATES_TTL_MS`, `VENDORS_KEY`, `VENDORS_TTL_MS`, `DETAIL_TTL_MS`
- `types.ts` — types: `ProductIndexRow`, `VendorIndexRow`

### `automations/telecalling/client-segments-parts/`
- `io.ts` — functions/values: `loadTypeRules`, `loadManuals`, `loadMasterEntries`, `classifyClients`, `loadClientQueue`, `setTypeRule`, `setManualSegment`
- `pure.ts` — functions/values: `LEGAL_RE`, `normalizeClientKey`, `tokensOf`, `defaultSegmentFor`, `isValidSegment`, `buildMasterIndex`, `toCandidate`
- `types.ts` — types: `ClientSegmentKind`, `ClientCandidate`, `ClientClass`, `ClientQueueRow`, `MasterEntry`, `MasterIndex`

### `automations/telecalling/service-parts/`
- `io.ts` — functions/values: `getEnquiryLeadCounts`, `computeTelecallingDaily`, `getTelecallingDashboardData`, `computeTelecallingDashboardData`, `buildDailySection`, `listSalesHolidays`, `markSalesHoliday`, `unmarkSalesHoliday`
- `pure.ts` — functions/values: `toCloseMultiplier`, `RISK_LIST_CAP`, `UNATTRIBUTED_LEADS_KEY`, `UNATTRIBUTED_CLOSE_KEY`, `runLeadConversion`, `shiftDays`, `periodRange`, `periodPrefix`, `workingDaysBetween`, `istDayOf`, `listDays`, `WEEKDAY_SHORT`, `weekdayOf`
- `types.ts` — types: `TelecallingDailyRow`, `SalesHoliday`

### `copilot/engine-parts/`
- `io.ts` — functions/values: `gatewayReady`, `bumpCount`, `defaultToolDefs`, `runTool`, `logUsage`, `readChatUsage`, `checkHourlyLimit`, `runTurn`
- `pure.ts` — functions/values: `MAX_STEPS`, `COUNT_TTL_MS`, `BUSY_REPLY`, `CHAT_PROVIDER`, `chatLegParams`, `CHAT_MAX_TOKENS`, `CUT_RESUME`, `MAX_CUT_RESUMES`, `parseArgs`, `toolSig`, `seedToolSigs`, `repeatNudge`, `blockedOut`, `startLabel`, `is429Like`, `MAX_HUMAN_TURNS`, `LIMIT_REPLY`, `THINK_BRIEF`, `RATE_WINDOW_MS`, `rateWho`, `USAGE_TTL_MS`, `usageKey`

### `modules/ai/service-parts/`
- `io.ts` — functions/values: `AIService`
- `pure.ts` — functions/values: `isMockLLM`
- `types.ts` — types: `SummaryOutput`

### `modules/auth/routes-parts/`
- `io.ts` — functions/values: `authLogin`, `authCallback`, `authMe`, `authLogout`, `asRoot`, `asUserManager`, `authListUsers`, `authListScopes`, `authCreateScope`, `authDeleteScope`, `authSetUserScopes`, `authListRoles`, `authCreateRole`, `authDeleteRole`, `authSetUserRoles`, `authUserPositions`, `authSetUserProfile`, `authDeleteUser`
- `pure.ts` — functions/values: `json`, `redirect`, `isRoot`, `isTargetRoot`
- `types.ts` — types: `AuthResult`

### `modules/auth/store-parts/`
- `io.ts` — functions/values: `D1AuthStore`
- `pure.ts` — functions/values: `newId`, `MemoryAuthStore`
- `types.ts` — types: `AuthStore`

### `modules/chat/store-parts/`
- `io.ts` — functions/values: `resolveLinkedSender`, `D1ChatStore`
- `pure.ts` — functions/values: `newId`, `LINKED_ACCOUNT_EMAILS`, `LINKED_PRIMARY_EMAIL`, `parseAttachments`, `mapMessage`, `MemoryChatStore`
- `types.ts` — types: `ChatUser`, `ChatChannel`, `ChatAttachment`, `ChatMessage`, `ChatReaction`, `ChatStore`

### `modules/crm/scheduling-parts/`
- `pure.ts` — functions/values: `effectiveQty`, `isRemovedItem`, `isCancelledOrder`, `deriveLifecycle`, `isOverdueItem`, `isDueTodayItem`, `isOrderOverdue`, `countDueToday`, `ok`, `fail`, `str3`, `validateReason`, `validateSchedule`, `validateReschedule`, `validateDispatch`, `resolveDispatchQty`, `validateAmend`, `validateLocalCancel`
- `types.ts` — types: `ItemLike`, `OrderLike`, `ValidationOk`, `ValidationFail`, `Validation`, `ScheduleEntry`, `ScheduleArgs`, `RescheduleEntry`, `RescheduleArgs`, `DispatchEntry`, `DispatchProof`, `DispatchArgs`, `AmendQtyChange`, `AmendRemove`, `AmendAdd` …

### `modules/crm/store-parts/`
- `io.ts` — functions/values: `withFlags`, `itemsForOrders`, `listOrders`, `sortNewestFirst`, `matchesView`, `orderRegion`, `getOrder`, `proofsForOrder`, `verifyDispatchProof`, `syncState`, `loadRawOrder`, `loadRawItems`, `writeEvent`, `refreshLifecycle`, `scheduleOrder`, `rescheduleOrder`, `dispatchOrder`, `attachProofDocs`, `attachProofPhotos`, `hasDispatchCredit`, `creditDispatch`, `confirmSourceDeletion`, `updateAddresses`, `amendOrderItems`, `cancelOrderLocal` …
- `pure.ts` — functions/values: `mirrorOrderTouch`, `iso`, `num`, `str`, `toItemView`, `toOrderView`, `ITEM_BATCH`, `proofFile`, `isPdfFile`, `isImageFile`, `CrmError`, `assertWorkable`, `PROOF_DOC_RULES`, `PROOF_DOC_SLOTS`, `SCORE_STAGES`, `STAGE_DEPT`, `STAGE_COMPLETION`, `orderStage`, `FLOOR_WINDOW_DAYS`, `dayAdd`, `isCompleteInZoho`, `lineKeyFor`, `REGION_LOOKUP_BATCH`, `ORDER_COLS`, `sqlValue` …
- `types.ts` — types: `ListArgs`, `ProofFile`, `ActionResult`, `ProofDocSlot`, `SyncedOrder`, `SyncVerify`, `SyncResult`, `ScoreStage`

### `modules/enquiries/loops-parts/`
- `pure.ts` — functions/values: `LOOP_KINDS`, `LOOP_PARTIES`, `LOOP_STATUSES`, `MAX_LOOPS`, `isParty`, `isKind`, `cleanText`, `cleanMedia`, `parseLoopRecords`, `openLoops`, `migrateItemLoops`, `answerAllOpen`, `answerOpen`, `canOpen`, `applyLoopOps`, `defaultHolder`, `auditNote`
- `types.ts` — types: `LoopWriter`

### `modules/enquiries/routes-parts/`
- `io.ts` — functions/values: `enquiryCreate`, `enquiryIntake`
- `pure.ts` — functions/values: `json`, `err`, `enquiryList`, `procurementQueueList`, `enquiryGetRedacted`, `enquiryAddRequirement`, `enquiryUpdate`, `enquiryDelete`, `enquiryGet`, `enquiryComments`, `enquiryAddComment`
- `types.ts` — types: `EnquiryResult`, `RedactOpts`, `ProcQueueOpts`

### `modules/enquiries/store-parts/`
- `io.ts` — functions/values: `D1EnquiryStore`
- `pure.ts` — functions/values: `newId`, `mapEnquiry`, `mapComment`, `sanitize`, `MemoryEnquiryStore`

### `modules/enquiries/update-parts/`
- `pure.ts` — functions/values: `normalizeItemWrites`, `normIntakeLine`, `applyIntakeBulkResult`, `applyLateQuoteReopen`, `applySentRevision`, `applyRateLifecycles`, `assertFinalizeGate`, `retitleOnSourceChange`
- `types.ts` — types: `ItemWriteCtx`, `RateWriteCtx`

### `modules/enquiries/vision-intake-parts/`
- `io.ts` — functions/values: `loadLiveCatalog`, `runAgnesVisionIntake`
- `pure.ts` — functions/values: `ROUTER_SYSTEM`, `normTok`, `lookupDeterministic`, `lookupToken`, `buildLookupList`, `LOOKUP_FALLBACK_SYSTEM`, `SPEC_CHECK_SYSTEM`, `isRateLimited`
- `types.ts` — types: `KypKey`, `LiveCatalog`

### `modules/neodove-campaign/service-parts/`
- `io.ts` — functions/values: `resolveAgents`, `resolveTeamLeads`, `teamLeadCoverage`, `setAgentCampaignUrl`, `getCampaignStates`, `getCampaignPreview`, `getCampaignBatches`, `getCampaignTypes`, `createPush`, `sendOne`, `talliesFor`, `runBatchChunk`, `failedView`, `drainPendingPushes`
- `pure.ts` — functions/values: `REGIONS`, `DEFAULT_CHUNK`, `MAX_CHUNK`, `CONCURRENCY`, `FETCH_TIMEOUT_MS`, `AGENT_SECRET_RE`, `CampaignError`, `normalizeRegion`, `normalizeState`, `normalizeDistribution`, `normalizeClientType`, `normalizeCampaignUrl`, `urlFromSecret`, `extractUrlFromPaste`, `validateAgentUrl`, `liveEnabled`, `participantsFor`, `hostOf`, `newId`
- `types.ts` — types: `ResolvedAgent`, `SendOutcome`

### `modules/neodove-campaign/store-parts/`
- `io.ts` — functions/values: `campaignDb`, `listAgents`, `listTeamLeads`, `getAgentRow`, `setAgentUrl`, `agentTallies`, `listCustomersByState`, `listStateCounts`, `listTypeCounts`, `lastLivePushes`, `insertBatch`, `getBatch`, `updateBatch`, `recountBatch`, `listBatches`, `insertLeadRows`, `recoverStuckClaims`, `claimPending`, `markOutcomes`, `listFailedLeads`, `batchesWithPending`
- `pure.ts` — functions/values: `AGENT_COLUMNS`, `CUSTOMER_COLUMNS`, `BATCH_COLUMNS`, `toBatch`, `PATCHABLE`, `LEAD_COLUMNS`, `INSERT_CHUNK`
- `types.ts` — types: `LeadOutcome`

### `shared/ai-gateway-parts/`
- `io.ts` — functions/values: `logGatewayUsage`, `readGatewayUsage`, `modelFlagged`, `flagModelDown`, `AiGateway`
- `pure.ts` — functions/values: `GATEWAY_USAGE_TTL_MS`, `GATEWAY_USAGE_PREFIX`, `gatewayUsageKey`, `hashAI`, `FALLBACK_MODEL`, `MODEL_DOWN_TTL_MS`, `OPENROUTER_TEXT_MODEL`, `OPENROUTER_VISION_MODEL`, `PAID_CHAT_ROUTING`, `PROVIDERS`, `AiGatewayError`, `detectProvider`, `KeyPool`, `sleep`, `RELAY_ACTIVE_KEY`, `RELAY_TTL_MS`, `RELAY_COOLDOWN_KEY`, `RELAY_COOLDOWN_MS`, `RELAY_POISONED_KEY`, `RELAY_POISONED_TTL_MS`, `RELAY_ACTIVE_KEY_BAK`, `RELAY_POISONED_KEY_BAK`, `RELAY_MEMO_MS`, `extractJson`, `buildVisionUserContent`
- `types.ts` — types: `ProviderConfig`, `AiKey`, `KeyHealth`, `TextPart`, `ImagePart`, `MessageContent`, `ChatMessage`, `ToolDefinition`, `ToolCall`, `CompletionRequest`, `CompletionResult`, `ProxyLane`

### `storage/d1-provider-parts/`
- `io.ts` — functions/values: `D1StorageProvider`
- `pure.ts` — functions/values: `uuid`, `iso`, `parseDate`, `toBool`, `boolToInt`, `contactFromRow`, `messageFromRow`, `emailFromRow`, `digestFromRow`, `taskFromRow`, `pendingFromRow`, `noteFromRow`, `chatNoteFromRow`, `auditFromRow`
- `types.ts` — types: `Row`

