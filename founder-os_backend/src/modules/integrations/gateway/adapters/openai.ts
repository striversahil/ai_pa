// openai.ts — multi-instance, multi-vendor, key rotation + fallback.
//
// A configured instance talks straight to its own OpenAI-compatible endpoint
// (baseUrl + model + comma-separated apiKeys). No instance (or
// config.fallbackToGlobalPool) fails over to Setting ai:providers — keys are
// never copied into the integration row.

import { getGateway, extractJson, type CompletionRequest, type CompletionResult } from '../../../../shared/ai-gateway';
import type { IntegrationAdapter, ResolvedInstance } from '../types';

export interface AiClient {
  complete(req: CompletionRequest): Promise<CompletionResult>;
  completeJson<T>(req: CompletionRequest): Promise<T>;
  completeJsonStream<T>(req: CompletionRequest): Promise<T>;
  embed(input: string | string[], model?: string): Promise<number[][]>;
  health(): unknown[];
  readonly keyCount: number;
  readonly provider: string;
}

function keysOf(instance: ResolvedInstance): string[] {
  const raw = String(instance.secrets.apiKeys || instance.secrets.apiKey || '');
  return raw.split(/[,\n]/).map((k) => k.trim()).filter(Boolean);
}

export const openAiAdapter: IntegrationAdapter<AiClient> = {
  provider: 'openai',
  async connect(instance: ResolvedInstance): Promise<AiClient> {
    const { gatewayContext } = await import('../context');
    const { getAppSettings } = await import('../../../../shared/app-settings');
    const gw = () => getGateway(gatewayContext().env);
    const ensurePool = async () => {
      const client = gw();
      if (!client.keyCount) client.configureFromSettings(await getAppSettings().catch(() => ({})));
      return client;
    };

    const cfg = instance.config as Record<string, any>;
    const keys = keysOf(instance);
    const configured = instance.id !== 'ai-gateway' && keys.length > 0;
    const baseUrl = String(cfg.baseUrl || instance.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
    const model = String(cfg.model || 'gpt-4o-mini');
    const fallback = cfg.fallbackToGlobalPool !== false;

    const viaPool = (req: CompletionRequest) => ensurePool().then((client) => client.complete(req));

    async function direct(req: CompletionRequest): Promise<CompletionResult> {
      let lastError: unknown = null;
      for (const key of keys) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), req.timeoutMs ?? 60_000);
        try {
          const res = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
            body: JSON.stringify({
              model: req.model || model,
              messages: req.messages,
              temperature: req.temperature,
              ...(req.json ? { response_format: { type: 'json_object' } } : {}),
            }),
            signal: req.signal || controller.signal,
          });
          const data: any = await res.json().catch(() => ({}));
          if (!res.ok) { lastError = new Error(`HTTP ${res.status}: ${data?.error?.message || ''}`); continue; }
          return {
            content: String(data?.choices?.[0]?.message?.content ?? ''),
            provider: 'openai',
            keyId: key.slice(-6),
            model: String(data?.model || req.model || model),
            jsonParsed: false,
            usage: data?.usage,
            finishReason: data?.choices?.[0]?.finish_reason,
          };
        } catch (err) {
          lastError = err;
        } finally {
          clearTimeout(timer);
        }
      }
      if (fallback) return viaPool(req);
      throw lastError instanceof Error ? lastError : new Error('all OpenAI-compatible keys failed');
    }

    const complete = (req: CompletionRequest) => (configured ? direct(req) : viaPool(req));
    const completeJson = async <T,>(req: CompletionRequest): Promise<T> =>
      extractJson((await complete({ ...req, json: true })).content) as T;

    return {
      provider: instance.instanceKey,
      get keyCount() { return configured ? keys.length : gw().keyCount; },
      complete,
      completeJson,
      async completeJsonStream<T>(req: CompletionRequest): Promise<T> {
        if (!configured) return (await ensurePool()).completeJsonStream<T>(req);
        return completeJson<T>(req);
      },
      async embed(input: string | string[], embedModel?: string) {
        if (!configured) throw new Error('embeddings need a configured OpenAI-compatible instance');
        let lastError: unknown = null;
        for (const key of keys) {
          const res = await fetch(`${baseUrl}/embeddings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
            body: JSON.stringify({ model: embedModel || model, input }),
          });
          const data: any = await res.json().catch(() => ({}));
          if (res.ok) return (data?.data ?? []).map((row: any) => row.embedding as number[]);
          lastError = new Error(`HTTP ${res.status}: ${data?.error?.message || ''}`);
        }
        throw lastError instanceof Error ? lastError : new Error('embeddings failed');
      },
      health: () => gw().health(),
    };
  },
};
