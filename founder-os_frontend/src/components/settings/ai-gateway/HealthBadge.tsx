"use client";

import type { AiHealthConfig, AiKeyHealth } from "@/ai-gateway/types";
import { HEALTH_LABEL, healthBand, healthTitle, healthTone } from "@/ai-gateway/metrics";

/** One key's persisted health (score written by the 5-min Worker sweep). */
export function HealthBadge({ health, enabled, cfg }: {
  health: AiKeyHealth | null;
  enabled: boolean;
  cfg?: AiHealthConfig;
}) {
  const band = healthBand(health, enabled, cfg);
  const score = health?.samples ? health.score : null;
  return (
    <span
      title={healthTitle(health)}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-bold ${healthTone(band)}`}
    >
      {HEALTH_LABEL[band]}
      {score != null && <span className="font-mono">{score}</span>}
    </span>
  );
}
