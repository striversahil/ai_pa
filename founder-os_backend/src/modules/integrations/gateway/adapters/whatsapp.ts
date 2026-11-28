// whatsapp.ts — Meta Cloud API sender for ONE instance (its own number/token).
// Mirrors src/modules/waba/client.ts (same graph URL + body shape) but reads
// the account from the instance, not from process/Worker env.

import { IntegrationError, type IntegrationAdapter, type ResolvedInstance } from '../types';

export interface WhatsAppClient {
  phoneNumberId: string;
  sendText(to: string, text: string): Promise<{ ok: boolean; messageId?: string; error?: string }>;
  sendTemplate(
    to: string,
    name: string,
    language: string,
    components?: unknown[],
  ): Promise<{ ok: boolean; messageId?: string; error?: string }>;
  ping(): Promise<{ ok: boolean; status: number; error?: string }>;
}

function digits(to: string): string {
  return String(to ?? '').replace(/[^0-9]/g, '');
}

export const whatsappAdapter: IntegrationAdapter<WhatsAppClient> = {
  provider: 'whatsapp',
  async connect(instance: ResolvedInstance): Promise<WhatsAppClient> {
    const cfg = instance.config as Record<string, any>;
    const phoneNumberId = String(cfg.phoneNumberId ?? '');
    const version = String(cfg.apiVersion || 'v21.0');
    const token = instance.secrets.accessToken;
    if (!phoneNumberId || !token) {
      throw new IntegrationError('whatsapp', 'instance is missing phoneNumberId or accessToken', 409);
    }
    const endpoint = `https://graph.facebook.com/${version}/${phoneNumberId}/messages`;

    async function post(body: unknown) {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const data: any = await res.json().catch(() => ({}));
      if (!res.ok) {
        return { ok: false, error: data?.error?.message || data?.error?.error_user_msg || `HTTP ${res.status}` };
      }
      return { ok: true, messageId: data?.messages?.[0]?.id as string | undefined };
    }

    return {
      phoneNumberId,
      sendText: (to, text) => post({
        messaging_product: 'whatsapp', to: digits(to), type: 'text', text: { body: text },
      }),
      sendTemplate: (to, name, language, components) => post({
        messaging_product: 'whatsapp', to: digits(to), type: 'template',
        template: { name, language: { code: language }, ...(components?.length ? { components } : {}) },
      }),
      async ping() {
        const res = await fetch(`https://graph.facebook.com/${version}/${phoneNumberId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data: any = await res.json().catch(() => ({}));
        return { ok: res.ok, status: res.status, error: res.ok ? undefined : data?.error?.message };
      },
    };
  },
};
