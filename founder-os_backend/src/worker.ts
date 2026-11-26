// ─────────────────────────────────────────────────────────────────────────────
// worker.ts — thin entry point.
//
// The application logic lives in src/worker/:
//   context.ts      — Bindings type, bootstrapEnv, deps(), boot, auth, guards,
//                     live broadcast, shared helpers, app factory (middleware).
//   routes/*.ts     — one module per API domain (auth, chat, enquiries, system,
//                     estimates, whatsapp, triggers, runner, autopilot,
//                     automations (registry), session (viewer workspaces),
//                     whatsapp-marketing, events).
//   cron.ts         — native `* * * * *` cron router (neodove-refresh +
//                     GitHub Actions workflow_dispatch dispatcher).
// ─────────────────────────────────────────────────────────────────────────────
import { EventHub } from './durable/event-hub';
import { AsyncTaskRunner } from './durable/async-task-runner';
import { ChatRoomDO } from './durable/chat-room';
import { createApp } from './worker/context';
import { registerAuthRoutes } from './worker/routes/auth';
import { registerViewAsRoutes } from './worker/routes/view-as';
import { registerChatRoutes } from './worker/routes/chat';
import { registerEnquiryRoutes } from './worker/routes/enquiries';
import { registerEnquiryFileRoutes } from './worker/routes/enquiry-files';
import { registerEnquiryThreadRoutes } from './worker/routes/enquiry-threads';
import { registerSystemRoutes, registerSseRoute } from './worker/routes/system';
import { registerSettingsRoutes } from './worker/routes/settings';
import { registerEstimatesRoutes } from './worker/routes/estimates';
import { registerTelecallingRoutes } from './worker/routes/telecalling';
import { registerCrmAttachmentRoutes } from './worker/routes/crm-attachments';
import { registerCrmRoutes } from './worker/routes/crm';
import { registerCrmCashRoutes } from './worker/routes/crm-cash';
import { registerCrmSyncRoutes } from './worker/routes/crm-sync';
import { registerWhatsappRoutes } from './worker/routes/whatsapp';
import { registerTriggerRoutes } from './worker/routes/triggers';
import { registerRunnerRoutes } from './worker/routes/runner';
import { registerAutopilotRoutes } from './worker/routes/autopilot';
import { registerAutomationRoutes } from './worker/routes/automations';
import { registerMarketingRoutes } from './worker/routes/whatsapp-marketing';
import { registerSessionRoutes } from './worker/routes/session';
import { registerAccountsRoutes } from './worker/routes/accounts';
import { registerAccountsFileRoutes } from './worker/routes/accounts-files';
import { registerCopilotRoutes } from './worker/routes/copilot';
import { registerProductLineRoutes } from './worker/routes/product-line';
import { registerDigitalMarketingRoutes } from './worker/routes/digital-marketing';
import { registerHumanResourcesRoutes } from './worker/routes/human-resources';
import { registerHumanResourcesControllerRoutes } from './worker/routes/human-resources-controller';
import { registerHumanResourcesDocumentRoutes } from './worker/routes/human-resources-documents';
import { registerHumanResourcesAssetRoutes } from './worker/routes/human-resources-assets';
import { registerSalesRegionRoutes } from './worker/routes/sales-regions';
import { registerDelegationRoutes } from './worker/routes/delegation';
import { registerMyLeaveRoutes } from './worker/routes/my-leave';
import { registerLinkedinRoutes } from './worker/routes/linkedin';
import { registerEmailRoutes } from './worker/routes/email';
import { registerDebtorsTrackerRoutes } from './worker/routes/debtors-tracker';
import { registerMasterDataRoutes } from './worker/routes/master-data';
import { registerReportingSheetRoutes } from './worker/routes/reporting-sheet';
import { registerNeodoveCampaignRoutes } from './worker/routes/neodove-campaign';
import { registerStockRoutes } from './worker/routes/stock';
import { registerEventsRoute } from './worker/routes/events';
import { registerAndroidRoutes } from './worker/routes/android';
import { registerCallLogRoutes } from './worker/routes/call-log';
import { registerDialerRoutes } from './worker/routes/dialer';
import { registerFieldStaffRoutes } from './worker/routes/field-staff';
import { registerSalesObjectionsRoutes } from './worker/routes/sales-objections';
import { registerNotificationRoutes } from './worker/routes/notifications';
import { registerWorkRoutes } from './worker/routes/work';
import { registerOrgRoutes } from './worker/routes/org';
import { registerOrgChartRoutes } from './worker/routes/org-chart';
import { registerDashboardRoutes } from './worker/routes/dashboards';
import { registerLeadRoutes } from './worker/routes/leads';
import { registerAiRoutes } from './worker/routes/ai';
import { scheduled } from './worker/cron';

const app = createApp();

// ── Route modules ────────────────────────────────────────────────────────────
registerAuthRoutes(app);
// Root "view as" (read-only impersonation) — under /api/auth/, registered here
// so the enter/exit endpoints exist even though the read-only gate lives in
// createApp().
registerViewAsRoutes(app);
registerChatRoutes(app);
registerEnquiryRoutes(app);
registerEnquiryFileRoutes(app);
registerEnquiryThreadRoutes(app);
registerSystemRoutes(app);
registerSettingsRoutes(app);
registerSseRoute(app);
registerEstimatesRoutes(app);
registerTelecallingRoutes(app);
registerCrmAttachmentRoutes(app);
registerCrmRoutes(app);
registerCrmCashRoutes(app);
registerCrmSyncRoutes(app);
registerWhatsappRoutes(app);
registerTriggerRoutes(app);
registerRunnerRoutes(app);
registerAutopilotRoutes(app);
registerAutomationRoutes(app);
registerSessionRoutes(app);
registerAccountsRoutes(app);
registerAccountsFileRoutes(app);
registerCopilotRoutes(app);
registerProductLineRoutes(app);
registerDigitalMarketingRoutes(app);
registerHumanResourcesRoutes(app);
registerHumanResourcesControllerRoutes(app);
registerHumanResourcesDocumentRoutes(app);
registerHumanResourcesAssetRoutes(app);
registerSalesRegionRoutes(app);
registerDelegationRoutes(app);
registerMyLeaveRoutes(app);
registerLinkedinRoutes(app);
registerEmailRoutes(app);
registerDebtorsTrackerRoutes(app);
registerMasterDataRoutes(app);
registerReportingSheetRoutes(app);
registerNeodoveCampaignRoutes(app);
registerStockRoutes(app);
registerMarketingRoutes(app);
registerEventsRoute(app);
registerAndroidRoutes(app);
registerCallLogRoutes(app);
registerDialerRoutes(app);
registerFieldStaffRoutes(app);
registerSalesObjectionsRoutes(app);
// Registered BEFORE work.ts so the richer notification API owns
// /api/notifications (work.ts keeps the legacy Phase-6a handlers).
registerNotificationRoutes(app);
registerWorkRoutes(app);
registerOrgRoutes(app);
registerOrgChartRoutes(app);
registerDashboardRoutes(app);
registerLeadRoutes(app);
registerAiRoutes(app);

export default {
  fetch: app.fetch,
  scheduled,
};
export { EventHub, AsyncTaskRunner, ChatRoomDO };