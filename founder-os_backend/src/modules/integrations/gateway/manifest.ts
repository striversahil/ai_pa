// manifest.ts — what the console renders and what the routes validate.
// ONE list: a provider exists because it appears here (and has an adapter).

import type { ProviderKey, ProviderManifest } from './types';

function f(key: string, label: string, extra: Partial<{ hint: string; placeholder: string; required: boolean }> = {}) {
  return { key, label, ...extra };
}

export const PROVIDER_MANIFESTS: ProviderManifest[] = [
  {
    provider: 'zoho',
    label: 'Zoho Books',
    category: 'Estimates',
    hint: 'Refresh-token OAuth. Access tokens are cached in Token (source zoho:<instanceKey>) and refreshed on 401.',
    fields: [
      f('organizationId', 'Organization ID', { required: true, placeholder: '60000000000' }),
      f('accountsUrl', 'Accounts domain', { placeholder: 'https://accounts.zoho.in' }),
      f('apiDomain', 'API domain', { placeholder: 'https://www.zohoapis.in' }),
    ],
    secretFields: [
      f('clientId', 'Client ID', { required: true }),
      f('clientSecret', 'Client secret', { required: true }),
      f('refreshToken', 'Refresh token', { required: true }),
      f('webhookSecret', 'Webhook secret', { hint: 'HMAC over the raw body for estimate pushes.' }),
    ],
    supportsWebhook: true,
    supportsPolling: false,
    defaultDeliveryMode: 'batch',
    instanceRequired: true,
    webhookPath: '/api/webhooks/zoho',
  },
  {
    provider: 'whatsapp',
    label: 'WhatsApp Cloud',
    category: 'Messaging',
    hint: 'Meta Cloud API. Unnamed instance = the env-configured WABA client.',
    fields: [
      f('phoneNumberId', 'Phone number ID', { required: true }),
      f('apiVersion', 'Graph version', { placeholder: 'v21.0' }),
      f('businessId', 'Business account ID'),
    ],
    secretFields: [
      f('accessToken', 'Access token', { required: true }),
      f('appSecret', 'App secret'),
      f('webhookVerifyToken', 'Webhook verify token', { required: true }),
      f('webhookSecret', 'Webhook signature secret', { hint: 'Defaults to appSecret.' }),
    ],
    supportsWebhook: true,
    supportsPolling: false,
    defaultDeliveryMode: 'realtime',
    instanceRequired: true,
    webhookPath: '/api/webhooks/whatsapp',
  },
  {
    provider: 'tally',
    label: 'Tally Forms',
    category: 'Forms',
    fields: [f('formName', 'Form name')],
    secretFields: [f('webhookSecret', 'Webhook secret', { required: true })],
    supportsWebhook: true,
    supportsPolling: false,
    defaultDeliveryMode: 'realtime',
    instanceRequired: true,
    webhookPath: '/api/webhooks/tally',
  },
  {
    provider: 'tradeindia',
    label: 'TradeIndia',
    category: 'B2B portal',
    fields: [
      f('sellerId', 'Seller ID'),
      f('pollUrl', 'Enquiry pull URL', { hint: 'Optional: the batch runner polls it.' }),
    ],
    secretFields: [
      f('webhookSecret', 'Webhook secret', { required: true }),
      f('apiKey', 'API key'),
    ],
    supportsWebhook: true,
    supportsPolling: true,
    defaultDeliveryMode: 'batch',
    instanceRequired: true,
    webhookPath: '/api/webhooks/tradeindia',
  },
  {
    provider: 'justdial',
    label: 'Justdial',
    category: 'B2B portal',
    hint: 'GET lead push: query params are the payload.',
    fields: [f('partnerId', 'Partner ID'), f('pollUrl', 'Lead pull URL')],
    secretFields: [
      f('webhookSecret', 'Webhook secret', { required: true }),
      f('apiKey', 'API key'),
    ],
    supportsWebhook: true,
    supportsPolling: true,
    defaultDeliveryMode: 'realtime',
    instanceRequired: true,
    webhookPath: '/api/webhooks/justdial',
  },
  {
    provider: 'alibaba',
    label: 'Alibaba.com',
    category: 'B2B portal',
    fields: [f('sellerId', 'Seller ID'), f('pollUrl', 'Inquiry pull URL')],
    secretFields: [
      f('webhookSecret', 'Webhook secret', { required: true }),
      f('appKey', 'App key'),
      f('appSecret', 'App secret'),
    ],
    supportsWebhook: true,
    supportsPolling: true,
    defaultDeliveryMode: 'batch',
    instanceRequired: true,
    webhookPath: '/api/webhooks/alibaba',
  },
  {
    provider: 'custom',
    label: 'Custom HTTP',
    category: 'Generic',
    hint: 'Any REST endpoint. `custom:erp` addresses the instanceKey erp.',
    fields: [
      f('baseUrl', 'Base URL', { required: true, placeholder: 'https://erp.example.com' }),
      f('authHeaderName', 'Auth header', { placeholder: 'Authorization' }),
      f('authScheme', 'Auth scheme', { placeholder: 'bearer | x-api-key | basic' }),
    ],
    secretFields: [
      f('authToken', 'Auth token'),
      f('webhookSecret', 'Webhook secret', { required: true }),
    ],
    supportsWebhook: true,
    supportsPolling: true,
    defaultDeliveryMode: 'batch',
    instanceRequired: true,
    webhookPath: '/api/webhooks/custom',
  },
  {
    provider: 'openai',
    label: 'AI gateway',
    category: 'AI',
    hint: 'Thin adapter over Setting ai:providers — this row never stores a key.',
    fields: [],
    secretFields: [],
    supportsWebhook: false,
    supportsPolling: false,
    defaultDeliveryMode: 'realtime',
    instanceRequired: false,
    webhookPath: '',
  },
];

const BY_PROVIDER = new Map<string, ProviderManifest>(
  PROVIDER_MANIFESTS.map((m) => [m.provider, m]),
);

export function manifestFor(provider: string): ProviderManifest | null {
  return BY_PROVIDER.get(String(provider ?? '').trim().toLowerCase()) ?? null;
}

export function providerKeys(): ProviderKey[] {
  return PROVIDER_MANIFESTS.map((m) => m.provider);
}

export function isProvider(provider: string): provider is ProviderKey {
  return BY_PROVIDER.has(provider);
}

/** Webhook source accepted by the door for this provider (custom has slugs). */
export function webhookSourceFor(provider: string): string {
  return String(provider ?? '').split(':')[0];
}
