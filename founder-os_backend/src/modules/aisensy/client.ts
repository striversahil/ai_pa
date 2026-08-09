import { config } from '../../config';
import { logger } from '../../shared/logger';

export type AisensySendResult = {
  ok: boolean;
  error?: string;
  statusCode?: number;
  raw?: any;
};

export type AisensySendPayload = {
  // Name of the LIVE campaign created in the AiSensy dashboard.
  campaignName: string;
  destination: string; // E.164 with or without '+', e.g. +919876543210
  userName?: string;
  source?: string;
  templateParams?: (string | number)[];
  media?: { url: string; filename?: string };
  tags?: string[];
  attributes?: Record<string, string>;
};

// Minimal AiSensy campaign API client (POST /campaign/t1/api/v2).
// https://wiki.aisensy.com/en/articles/11501889-api-reference-docs
export const AisensyClient = {
  isConfigured(): boolean {
    return !!config.AISENSY_API_KEY;
  },

  async sendCampaign(payload: AisensySendPayload): Promise<AisensySendResult> {
    if (!this.isConfigured()) {
      return { ok: false, error: 'AiSensy not configured (AISENSY_API_KEY missing)' };
    }
    const url = `${config.AISENSY_BASE_URL}/campaign/t1/api/v2`;
    const body = {
      apiKey: config.AISENSY_API_KEY,
      campaignName: payload.campaignName,
      destination: payload.destination,
      userName: payload.userName,
      source: payload.source,
      media: payload.media,
      templateParams: payload.templateParams?.map(String),
      tags: payload.tags,
      attributes: payload.attributes,
    };
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err = data?.message || data?.error || `HTTP ${res.status}`;
        logger.error({ url, status: res.status, error: err }, 'AisensyClient.sendCampaign failed');
        return { ok: false, error: err, statusCode: res.status, raw: data };
      }
      return { ok: true, raw: data };
    } catch (e: any) {
      logger.error({ error: e.message }, 'AisensyClient.sendCampaign network error');
      return { ok: false, error: e.message };
    }
  },
};
