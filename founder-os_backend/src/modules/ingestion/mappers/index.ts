// mappers/index.ts — source → mapper, chosen by manifest.inbound.mapper.
// Every inbound provider has a mapper name in the manifest; no provider list
// is hard-coded here beyond the mapper registry itself.

import { getProviderManifest, listProviderManifests } from '../../integrations/gateway/manifest';
import { parseSourceKey } from '../pure';
import type { MapperResult } from '../types';
import { mapB2bPortals } from './b2b-portals';
import { mapCustom } from './custom';
import { mapGmail } from './email';
import { mapForms } from './forms';
import { mapSocialLinkedIn } from './social-linkedin';
import { mapSocialMeta } from './social-meta';
import { mapSocialTelegram } from './social-telegram';
import { mapZohoEstimate } from './zoho-estimate';
import { genericMapper } from './generic';
import type { Mapper, MapperContext } from './types';

const MAPPERS: Record<string, Mapper> = {
  'b2b-portals': mapB2bPortals,
  'social-meta': mapSocialMeta,
  'social-linkedin': mapSocialLinkedIn,
  'social-telegram': mapSocialTelegram,
  forms: mapForms,
  email: mapGmail,
  'zoho-estimate': mapZohoEstimate,
  custom: mapCustom,
};

export function mapperFor(source: string): Mapper | null {
  const { base } = parseSourceKey(source);
  const manifest = getProviderManifest(base);
  if (!manifest?.inbound.supported) return null;
  const name = manifest.inbound.mapper || 'generic';
  return MAPPERS[name] || genericMapper(base);
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
