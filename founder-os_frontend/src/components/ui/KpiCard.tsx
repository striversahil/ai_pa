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
        <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-tertiary)]">{title}</span>
        <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${accentMap[accent]}`}>{icon}</div>
      </div>
      <div className="font-heading text-2xl font-extrabold tracking-tight text-[var(--text-primary)] md:text-3xl">
        {value}
      </div>
      {delta ? (
        <div className="flex items-center gap-1.5 text-[11px]">
          <span className={`font-bold ${delta.positive ? "text-[var(--color-success)]" : "text-[var(--color-danger)]"}`}>
            {delta.positive ? "▲" : "▼"} {delta.value}
          </span>
          {delta.note && <span className="text-[var(--text-tertiary)]">{delta.note}</span>}
        </div>
      ) : hint ? (
        <div className="text-[11px] text-[var(--text-tertiary)]">{hint}</div>
      ) : null}
    </Card>
  );
}
