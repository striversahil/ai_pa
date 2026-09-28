// Mirror of founder-os_backend/src/automations/_overview-shared/types.ts
// (same names + semantics — change both together, never drift).

export interface OverviewKpi {
  label: string;
  value: string;
  hint?: string;
}

export interface OverviewSection {
  slug: string;
  title: string;
  headline: string;
  kpis: OverviewKpi[];
  attention: string[];
  ok: boolean;
  error?: string;
}

export interface OverviewPayload {
  meta: {
    analysis: "overview";
    variant: "samarth" | "sahil";
    title: string;
    generatedAt: string;
    sectionsOk: number;
    sectionsTotal: number;
  };
  sections: OverviewSection[];
}
