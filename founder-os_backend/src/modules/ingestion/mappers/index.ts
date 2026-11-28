// mappers/index.ts — source → mapper. Every manifest provider with inbound
// support resolves: a specialized mapper when the shape needs one, otherwise
// the manifest-driven generic mapper.

import { getProviderManifest, listProviderManifests } from '../../integrations/gateway/manifest';
import { parseSourceKey } from '../pure';
import type { MapperResult } from '../types';
import { mapTally } from './tally';
import { mapWhatsApp } from './whatsapp';
import { mapZohoEstimate } from './zoho-estimate';
import { mapGmail } from './email';
import { genericMapper } from './generic';
import type { Mapper, MapperContext } from './types';

export function mapperFor(source: string): Mapper | null {
  const { base } = parseSourceKey(source);
  const manifest = getProviderManifest(base);
  if (!manifest?.inbound.supported) return null;
  if (base === 'whatsapp') return mapWhatsApp;
  if (base === 'zoho') return mapZohoEstimate;
  if (base === 'tally') return mapTally;
  if (base === 'gmail') return mapGmail;
  return genericMapper(base);
}

export function mapperSources(): string[] {
  return listProviderManifests()
    .filter((m) => m.inbound.supported)
    .map((m) => m.provider)
    .sort();
}

export function mapInbound(
  source: string,
  payload: Record<string, any>,
  ctx: MapperContext,
): MapperResult {
  const { base } = parseSourceKey(source);
  const mapper = mapperFor(source);
  if (!mapper) return { warnings: [`no mapper for source "${base}"`] };
  try {
    return mapper(payload ?? {}, ctx);
  } catch (error: any) {
    return { warnings: [`mapper threw: ${error?.message ?? 'unknown'}`] };
  }
}

export type { Mapper, MapperContext } from './types';
