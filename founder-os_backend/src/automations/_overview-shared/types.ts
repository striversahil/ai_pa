/**
 * _overview-shared/types.ts — shapes for the Founder / Sahil overview pages.
 *
 * Both `samarth-overview` and `sahil-overview` serve the IDENTICAL layout
 * (founder decision): one concise card per source dashboard. They differ only
 * by permission scope (`samarth` vs `sahil`). All pure shapes live here so the
 * two automations stay thin re-exports over `aggregator.ts`.
 *
 * Mirror: founder-os_frontend/src/overview/types.ts (same names + semantics).
 */

export interface OverviewKpi {
  label: string;
  value: string;
  hint?: string;
}

export interface OverviewSection {
  /** Source automation slug (deep-link target `#/automations/<slug>`). */
  slug: string;
  title: string;
  /** One-line concise highlight for the card header. */
  headline: string;
  kpis: OverviewKpi[];
  /** Max 3–4 items needing attention (overdues, risks, blockers). */
  attention: string[];
  ok: boolean;
  error?: string;
}

export interface OverviewPayload {
  meta: {
    analysis: 'overview';
    variant: 'samarth' | 'sahil';
    title: string;
    generatedAt: string;
    sectionsOk: number;
    sectionsTotal: number;
  };
  sections: OverviewSection[];
}
