"use client";

// Extracted verbatim from TelecallingDashboard.tsx by scripts/refactor/split-module.mjs.
// TelecallingDashboard.tsx re-exports everything public here, so existing imports keep working.
import { KNOWN_ORG_LABELS } from "../zoho/orgs";

/** Zoho org badge (multi-org sync). Renders only when 2+ orgs are present in
 *  the loaded data — single-org views stay exactly as before. */
export function OrgBadge({ orgId, orgs }: { orgId?: string | null; orgs: string[] }) {
  if (!orgId || orgs.length < 2) return null;
  const label = KNOWN_ORG_LABELS[orgId] ?? `Org •••${orgId.slice(-4)}`;
  return (
    <span title={`Zoho Books organization (${orgId})`} className="inline-flex items-center shrink-0 rounded border font-bold bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/30 px-1.5 py-0.5 text-[10px] uppercase">
      {label}
    </span>
  );
}
