// social-telegram.ts — Telegram updates (chat message; manifest fieldMap).

import type { Mapper } from './types';
import { genericMapper } from './generic';

export const mapSocialTelegram: Mapper = (payload, ctx) => genericMapper('telegram')(payload, ctx);
