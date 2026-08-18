import { processWebhookPayload } from './controller';
import { messageBuffer } from './message-buffer';

/**
 * Framework-agnostic ingest entry used by the Cloudflare Worker.
 * Delegates to the shared core logic (controller.ts) so webhook parsing is
 * identical between the Express app and the Worker build.
 */
export const WhatsAppController = {
  async handleWebhook(body: any): Promise<void> {
    await processWebhookPayload(body);
    // Workers freeze the isolate shortly after the response, so the buffer's
    // setTimeout-based flush never fires here. Flush synchronously instead.
    await messageBuffer.flush();
  },
};
export default WhatsAppController;