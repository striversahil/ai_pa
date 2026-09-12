// ─────────────────────────────────────────────────────────────────────────────
// worker.ts — thin entry point.
//
// The application logic lives in src/worker/:
//   context.ts      — Bindings type, bootstrapEnv, deps(), boot, auth, guards,
//                     live broadcast, shared helpers, app factory (middleware).
//   routes/*.ts     — one module per API domain (auth, chat, enquiries, system,
//                     estimates, whatsapp, triggers, runner, autopilot,
//                     automations/marketing, events).
//   cron.ts         — native `* * * * *` cron router (neodove-refresh +
//                     GitHub Actions workflow_dispatch dispatcher).
// ─────────────────────────────────────────────────────────────────────────────
import { EventHub } from './durable/event-hub';
import { AsyncTaskRunner } from './durable/async-task-runner';
import { ChatRoomDO } from './durable/chat-room';
import { createApp } from './worker/context';
import { registerAuthRoutes } from './worker/routes/auth';
import { registerChatRoutes } from './worker/routes/chat';
import { registerEnquiryRoutes } from './worker/routes/enquiries';
import { registerSystemRoutes, registerSseRoute } from './worker/routes/system';
import { registerEstimatesRoutes } from './worker/routes/estimates';
import { registerCrmAttachmentRoutes } from './worker/routes/crm-attachments';
import { registerWhatsappRoutes } from './worker/routes/whatsapp';
import { registerTriggerRoutes } from './worker/routes/triggers';
import { registerRunnerRoutes } from './worker/routes/runner';
import { registerAutopilotRoutes } from './worker/routes/autopilot';
import { registerAutomationRoutes, registerMarketingRoutes } from './worker/routes/automations';
import { registerEventsRoute } from './worker/routes/events';
import { scheduled } from './worker/cron';

const app = createApp();

// ── Route modules ────────────────────────────────────────────────────────────
registerAuthRoutes(app);
registerChatRoutes(app);
registerEnquiryRoutes(app);
registerSystemRoutes(app);
registerSseRoute(app);
registerEstimatesRoutes(app);
registerCrmAttachmentRoutes(app);
registerWhatsappRoutes(app);
registerTriggerRoutes(app);
registerRunnerRoutes(app);
registerAutopilotRoutes(app);
registerAutomationRoutes(app);
registerMarketingRoutes(app);
registerEventsRoute(app);

export default {
  fetch: app.fetch,
  scheduled,
};
export { EventHub, AsyncTaskRunner, ChatRoomDO };