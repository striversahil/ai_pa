// social-meta.ts — WhatsApp (dedicated) + Facebook/Instagram (manifest fieldMap).

import type { Mapper } from './types';
import { mapWhatsApp } from './whatsapp';
import { genericMapper } from './generic';

export const mapSocialMeta: Mapper = (payload, ctx) => {
  const base = String(ctx.source).split(':')[0];
  if (base === 'whatsapp') return mapWhatsApp(payload, ctx);
  return genericMapper(base)(payload, ctx);
};
