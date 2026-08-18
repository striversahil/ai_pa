import { processWebhookPayload } from './controller';

/**
 * Framework-agnostic ingest entry used by the Cloudflare Worker.
 * Delegates to the shared core logic (controller.ts) so webhook parsing is
 * identical between the Express app and the Worker build.
 */
export const WhatsAppController = {
  async handleWebhook(body: any): Promise<void> {
    await processWebhookPayload(body);
  },
};
export default WhatsAppController;