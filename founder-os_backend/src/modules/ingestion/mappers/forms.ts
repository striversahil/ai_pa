// forms.ts — Tally and Google Forms submissions (fields[{label,value}]).

import type { Mapper } from './types';
import { mapTally } from './tally';
import { genericMapper } from './generic';

export const mapForms: Mapper = (payload, ctx) => {
  const base = String(ctx.source).split(':')[0];
  return base === 'google_forms' ? genericMapper(base)(payload, ctx) : mapTally(payload, ctx);
};
