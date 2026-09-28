/**
 * _overview-shared/aggregator.ts — single compute path for both overview pages.
 *
 * Scalability contract: reads every source dashboard through
 * `AutomationEngine.getData(slug)` (the registry, not direct imports), so a
 * new source is one entry in `sections.ts` — zero changes here. Per-section
 * `Promise.allSettled` isolates failures (one slow/failed dashboard never
 * blanks the whole page). The result is KV-cached 60s (`cached()`) to collapse
 * refetch storms from live broadcasts.
 */

import { AutomationEngine } from '../../modules/automation/engine';
import { cached } from '../../shared/cache';
import { SECTIONS, ALL_SOURCE_SLUGS } from './sections';
import type { OverviewPayload } from './types';

export const OVERVIEW_TTL_MS = 60 * 1000;

async function fetchAll(): Promise<Record<string, { data: unknown; error: unknown }>> {
  const settled = await Promise.allSettled(
    ALL_SOURCE_SLUGS.map(async (slug) => ({ slug, data: await AutomationEngine.getData(slug, {}) })),
  );
  const out: Record<string, { data: unknown; error: unknown }> = {};
  for (const s of settled) {
    if (s.status === 'fulfilled') out[s.value.slug] = { data: s.value.data, error: null };
    else {
      const slug = ALL_SOURCE_SLUGS[settled.indexOf(s)] ?? 'unknown';
      out[slug] = { data: null, error: s.reason };
    }
  }
  return out;
}

async function computeOverview(variant: 'samarth' | 'sahil'): Promise<OverviewPayload> {
  const raw = await fetchAll();
  const sections = SECTIONS.map((def) => def.build(raw));
  return {
    meta: {
      analysis: 'overview',
      variant,
      title: variant === 'samarth' ? 'Samarth Overview' : 'Sahil Overview',
      generatedAt: new Date().toISOString(),
      sectionsOk: sections.filter((s) => s.ok).length,
      sectionsTotal: sections.length,
    },
    sections,
  };
}

export function getOverviewData(variant: 'samarth' | 'sahil'): Promise<OverviewPayload> {
  return cached(`overview:${variant}`, OVERVIEW_TTL_MS, () => computeOverview(variant));
}
