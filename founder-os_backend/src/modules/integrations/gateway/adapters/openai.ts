// openai.ts — a THIN adapter over the existing AI gateway. Keys stay in
// Setting ai:providers; this row stores nothing and never echoes a key.

import { getGateway, type CompletionRequest, type CompletionResult } from '../../../../shared/ai-gateway';
import type { IntegrationAdapter, ResolvedInstance } from '../types';

export interface AiClient {
  complete(req: CompletionRequest): Promise<CompletionResult>;
  completeJson<T>(req: CompletionRequest): Promise<T>;
  completeJsonStream<T>(req: CompletionRequest): Promise<T>;
  health(): unknown[];
  readonly keyCount: number;
}

export const openAiAdapter: IntegrationAdapter<AiClient> = {
  provider: 'openai',
  async connect(_instance: ResolvedInstance): Promise<AiClient> {
    // Lazy import: the gateway context is bound by the route that calls us.
    const { gatewayContext } = await import('../context');
    const { getAppSettings } = await import('../../../../shared/app-settings');
    const gw = () => getGateway(gatewayContext().env);
    return {
      get keyCount() { return gw().keyCount; },
      complete: async (req) => {
        const client = gw();
        if (!client.keyCount) client.configureFromSettings(await getAppSettings().catch(() => ({})));
        return client.complete(req);
      },
      completeJson: async <T,>(req: CompletionRequest) => {
        const client = gw();
        if (!client.keyCount) client.configureFromSettings(await getAppSettings().catch(() => ({})));
        return client.completeJson<T>(req);
      },
      completeJsonStream: async <T,>(req: CompletionRequest) => {
        const client = gw();
        if (!client.keyCount) client.configureFromSettings(await getAppSettings().catch(() => ({})));
        return client.completeJsonStream<T>(req);
      },
      health: () => gw().health(),
    };
  },
};
