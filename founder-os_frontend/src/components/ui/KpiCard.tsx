import React from "react";
import type { ReactNode } from "react";
import { Card } from "./Card";

interface KpiCardProps {
  title: string;
  value: ReactNode;
  icon: ReactNode;
  accent?: "brand" | "success" | "warning" | "danger" | "info" | "violet";
  delta?: { value: string; positive: boolean; note?: string };
  hint?: string;
}

const accentMap: Record<NonNullable<KpiCardProps["accent"]>, string> = {
  brand: "text-[var(--color-brand-indigo)] bg-[color-mix(in_srgb,var(--color-brand-indigo)_12%,transparent)]",
  success: "text-[var(--color-success)] bg-[color-mix(in_srgb,var(--color-success)_12%,transparent)]",
  warning: "text-[var(--color-warning)] bg-[color-mix(in_srgb,var(--color-warning)_12%,transparent)]",
  danger: "text-[var(--color-danger)] bg-[color-mix(in_srgb,var(--color-danger)_12%,transparent)]",
  info: "text-[var(--color-info)] bg-[color-mix(in_srgb,var(--color-info)_12%,transparent)]",
  violet: "text-[var(--color-violet)] bg-[color-mix(in_srgb,var(--color-violet)_12%,transparent)]",
};

export function KpiCard({ title, value, icon, accent = "brand", delta, hint }: KpiCardProps) {
  return (
    <Card interactive className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-label uppercase tracking-wide text-[var(--text-secondary)]">{title}</span>
        <div className={`flex h-10 w-10 items-center justify-center rounded-[var(--radius-sm)] ${accentMap[accent]}`}>{icon}</div>
      </div>
      <div className="font-heading text-[2rem] font-bold leading-none tracking-tight text-[var(--text-primary)] tabular-nums">
        {value}
      </div>
      {delta ? (
        <div className="flex items-center gap-1.5 text-caption">
          <span className={`font-semibold ${delta.positive ? "text-[var(--color-success)]" : "text-[var(--color-danger)]"}`}>
            {delta.positive ? "▲" : "▼"} {delta.value}
          </span>
          {delta.note && <span className="text-[var(--text-secondary)]">{delta.note}</span>}
        </div>
      ) : hint ? (
        <div className="text-caption text-[var(--text-secondary)]">{hint}</div>
      ) : null}
    </Card>
  );
}
