// mappers/index.ts — source → mapper. Every provider the door accepts has
// exactly one entry here; `custom` falls back to the generic lead shape.

import { parseSourceKey } from '../pure';
import type { MapperResult } from '../types';
import { mapAlibaba, mapJustdial, mapTradeindia } from './b2b-portals';
import { mapTally } from './tally';
import { mapWhatsApp, mapCustomLead } from './whatsapp';
import { mapZohoEstimate } from './zoho-estimate';
import type { Mapper, MapperContext } from './types';

const MAPPERS: Record<string, Mapper> = {
  tradeindia: mapTradeindia,
  justdial: mapJustdial,
  alibaba: mapAlibaba,
  tally: mapTally,
  whatsapp: mapWhatsApp,
  zoho: mapZohoEstimate,
  custom: mapCustomLead,
};

export function mapperSources(): string[] {
  return Object.keys(MAPPERS).sort();
}

export function mapInbound(
  source: string,
  payload: Record<string, any>,
  ctx: MapperContext,
): MapperResult {
  const { base } = parseSourceKey(source);
  const mapper = MAPPERS[base];
  if (!mapper) return { warnings: [`no mapper for source "${base}"`] };
  try {
    return mapper(payload ?? {}, ctx);
  } catch (error: any) {
    return { warnings: [`mapper threw: ${error?.message ?? 'unknown'}`] };
  }
}

export type { Mapper, MapperContext } from './types';
