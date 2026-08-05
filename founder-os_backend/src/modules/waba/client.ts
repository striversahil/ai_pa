import { config } from '../../config';
import { logger } from '../../shared/logger';

export type WabaSendResult = {
  ok: boolean;
  messageId?: string;
  error?: string;
  statusCode?: number;
};

type WabaSendBase = {
  to: string; // E.164 without '+', e.g. 919876543210
};

// Send an approved template message (required for business-initiated messages).
export type WabaTemplateSend = WabaSendBase & {
  type: 'template';
  templateName: string;
  templateLanguage?: string;
  bodyParams?: (string | number)[];
  mediaUrl?: string; // attached to a media component if present
};

// Send a free-form text message (only allowed inside a 24h customer session).
export type WabaTextSend = WabaSendBase & {
  type: 'text';
  body: string;
};

// Send a media-only message (document/image/audio/video), e.g. an invoice PDF.
export type WabaMediaSend = WabaSendBase & {
  type: 'media';
  mediaType: 'document' | 'image' | 'audio' | 'video' | 'sticker';
  mediaUrl: string;
  caption?: string;
  filename?: string;
};

export type WabaSendPayload = WabaTemplateSend | WabaTextSend | WabaMediaSend;

function buildTemplateComponents(p: WabaTemplateSend) {
  const components: any[] = [];
  const bodyParams = p.bodyParams?.length
    ? p.bodyParams.map(v => ({ type: 'text', text: String(v) }))
    : [];
  if (bodyParams.length) {
    components.push({ type: 'body', parameters: bodyParams });
  }
  if (p.mediaUrl) {
    const media = {
      type: p.mediaUrl.endsWith('.pdf') ? 'document' : 'image',
      link: p.mediaUrl,
    };
    components.push({ type: 'header', parameters: [{ type: 'image' as any, image: media }] });
  }
  return components;
}

function buildBody(p: WabaSendPayload): any {
  const messaging = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: p.to,
  };
  if (p.type === 'template') {
    return {
      ...messaging,
      type: 'template',
      template: {
        name: p.templateName,
        language: { code: p.templateLanguage || 'en' },
        components: buildTemplateComponents(p),
      },
    };
  }
  if (p.type === 'text') {
    return {
      ...messaging,
      type: 'text',
      text: { preview_url: false, body: p.body },
    };
  }
  // media
  return {
    ...messaging,
    type: p.mediaType,
    [p.mediaType]: {
      link: p.mediaUrl,
      caption: p.caption,
      filename: p.filename,
    },
  };
}

// Minimal Meta WhatsApp Business Cloud API client. Every method returns a
// structured result instead of throwing, so the campaign runner can record
// per-lead failures without try/catch noise.
export const WabaClient = {
  isConfigured(): boolean {
    return !!(config.WHATSAPP_CLOUD_ACCESS_TOKEN && config.WHATSAPP_CLOUD_PHONE_NUMBER_ID);
  },

  async send(payload: WabaSendPayload): Promise<WabaSendResult> {
    if (!this.isConfigured()) {
      return { ok: false, error: 'WABA not configured (WHATSAPP_CLOUD_ACCESS_TOKEN / WHATSAPP_CLOUD_PHONE_NUMBER_ID missing)' };
    }
    const url = `https://graph.facebook.com/${config.WHATSAPP_CLOUD_API_VERSION}/${config.WHATSAPP_CLOUD_PHONE_NUMBER_ID}/messages`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.WHATSAPP_CLOUD_ACCESS_TOKEN}`,
        },
        body: JSON.stringify(buildBody(payload)),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err = data?.error?.message || data?.error?.error_user_msg || `HTTP ${res.status}`;
        logger.error({ url, status: res.status, error: err }, 'WabaClient.send failed');
        return { ok: false, error: err, statusCode: res.status };
      }
      const messageId: string | undefined = data?.messages?.[0]?.id;
      return { ok: true, messageId };
    } catch (e: any) {
      logger.error({ error: e.message }, 'WabaClient.send network error');
      return { ok: false, error: e.message };
    }
  },

  // Get the name/display phone number for the configured sender.
  async getPhoneName(): Promise<{ ok: boolean; name?: string; phone?: string; error?: string }> {
    if (!this.isConfigured()) return { ok: false, error: 'WABA not configured' };
    try {
      const url = `https://graph.facebook.com/${config.WHATSAPP_CLOUD_API_VERSION}/${config.WHATSAPP_CLOUD_PHONE_NUMBER_ID}?fields=verified_name,display_phone_number,quality_rating`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${config.WHATSAPP_CLOUD_ACCESS_TOKEN}` } });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: data?.error?.message || `HTTP ${res.status}` };
      return { ok: true, name: data.verified_name, phone: data.display_phone_number };
    } catch (e: any) {
      return { ok: false, error: e.message };
    }
  },
};
