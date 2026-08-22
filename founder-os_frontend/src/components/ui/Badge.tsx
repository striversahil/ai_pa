import React from "react";
import type { ReactNode } from "react";

type Tone = "neutral" | "brand" | "info" | "success" | "warning" | "danger" | "sky" | "violet" | "cyan" | "purple";

const toneClasses: Record<Tone, string> = {
  neutral: "bg-[var(--bg-input)] text-[var(--text-secondary)]",
  brand: "bg-[color-mix(in_srgb,var(--color-brand-indigo)_12%,transparent)] text-[var(--color-brand-indigo)]",
  info: "bg-[color-mix(in_srgb,var(--color-info)_12%,transparent)] text-[var(--color-info)]",
  success: "bg-[color-mix(in_srgb,var(--color-success)_14%,transparent)] text-[var(--color-success)]",
  warning: "bg-[color-mix(in_srgb,var(--color-warning)_14%,transparent)] text-[var(--color-warning)]",
  danger: "bg-[color-mix(in_srgb,var(--color-danger)_14%,transparent)] text-[var(--color-danger)]",
  sky: "bg-[color-mix(in_srgb,var(--color-sky)_14%,transparent)] text-[var(--color-sky)]",
  violet: "bg-[color-mix(in_srgb,var(--color-violet)_14%,transparent)] text-[var(--color-violet)]",
  cyan: "bg-[color-mix(in_srgb,var(--color-cyan)_14%,transparent)] text-[var(--color-cyan)]",
  purple: "bg-[color-mix(in_srgb,var(--color-purple)_14%,transparent)] text-[var(--color-purple)]",
};

const toneDot: Record<Tone, string> = {
  neutral: "bg-[var(--text-tertiary)]",
  brand: "bg-[var(--color-brand-indigo)]",
  info: "bg-[var(--color-info)]",
  success: "bg-[var(--color-success)]",
  warning: "bg-[var(--color-warning)]",
  danger: "bg-[var(--color-danger)]",
  sky: "bg-[var(--color-sky)]",
  violet: "bg-[var(--color-violet)]",
  cyan: "bg-[var(--color-cyan)]",
  purple: "bg-[var(--color-purple)]",
};

export function Badge({
  children,
  tone = "neutral",
  dot = false,
  className = "",
}: {
  children: ReactNode;
  tone?: Tone;
  dot?: boolean;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${toneClasses[tone]} ${className}`}
    >
      {dot && <span className={`h-1.5 w-1.5 rounded-full ${toneDot[tone]}`} />}
      {children}
    </span>
  );
}

const enquiryStatusTone: Record<string, Tone> = {
  new: "neutral",
  contacted: "brand",
  qualified: "sky",
  proposal: "violet",
  negotiation: "warning",
  won: "success",
  lost: "danger",
};

const priorityTone: Record<string, Tone> = {
  high: "danger",
  medium: "warning",
  low: "success",
};

export function StatusBadge({ status }: { status: string }) {
  const tone = enquiryStatusTone[status] ?? "neutral";
  return (
    <Badge tone={tone} dot>
      {status}
    </Badge>
  );
}

export function PriorityBadge({ priority }: { priority: string }) {
  const tone = priorityTone[priority] ?? "neutral";
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--text-secondary)]">
      <span className={`h-2 w-2 rounded-full ${toneDot[tone]}`} />
      <span className="capitalize">{priority}</span>
    </span>
  );
}

export { toneClasses, toneDot };
export type { Tone };
