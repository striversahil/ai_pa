// Pure API→UI mappers for the overview pages.
// Mirror logic of backend _overview-shared/sections.ts (formatting only).

import type { OverviewPayload, OverviewSection } from "./types";

export function normalizeOverview(raw: unknown): OverviewPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as any;
  if (!Array.isArray(r.sections)) return null;
  const sections: OverviewSection[] = r.sections.map((s: any) => ({
    slug: String(s?.slug ?? ""),
    title: String(s?.title ?? s?.slug ?? "Section"),
    headline: String(s?.headline ?? ""),
    kpis: Array.isArray(s?.kpis)
      ? s.kpis.map((k: any) => ({ label: String(k?.label ?? ""), value: String(k?.value ?? ""), hint: k?.hint ? String(k.hint) : undefined }))
      : [],
    attention: Array.isArray(s?.attention) ? s.attention.map((a: any) => String(a)) : [],
    ok: Boolean(s?.ok),
    error: s?.error ? String(s.error) : undefined,
  }));
  return {
    meta: {
      analysis: "overview",
      variant: r?.meta?.variant === "sahil" ? "sahil" : "samarth",
      title: String(r?.meta?.title ?? "Overview"),
      generatedAt: String(r?.meta?.generatedAt ?? ""),
      sectionsOk: Number(r?.meta?.sectionsOk ?? sections.filter((s) => s.ok).length),
      sectionsTotal: Number(r?.meta?.sectionsTotal ?? sections.length),
    },
    sections,
  };
}

export function sectionLink(slug: string): string {
  return `#/automations/${slug}`;
}
