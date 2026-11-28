"use client";

// gateway-ui.tsx — small presentational atoms shared by the integration
// workspace. Brand icons are not in lucide, so each manifest provider gets a
// stable lucide glyph instead of a hard-coded logo component.

import React, { useEffect, useState } from "react";
import {
  Bot, Briefcase, Building2, Calculator, Camera, Check, Copy,
  FileSpreadsheet, FileText, FormInput, Mail, MapPin, MessagesSquare,
  Plug, Search, Send, Share2, Timer, Webhook,
} from "lucide-react";
import { Badge, Button } from "@/components/ui";
import type { Tone } from "@/components/ui";
import { copyText } from "@/integrations/gateway-copy";

export const inputClass = "w-full rounded-lg border border-[var(--border-card)] bg-[var(--bg-input)] px-3 py-2 text-xs text-[var(--text-primary)] outline-none transition focus:border-[var(--color-brand-indigo)] focus:ring-2 focus:ring-[var(--color-brand-indigo)]/15 disabled:opacity-60";
export const textareaClass = `${inputClass} min-h-[88px] font-mono leading-relaxed`;
export const selectClass = `${inputClass} cursor-pointer`;

export function ProviderGlyph({ provider, size = 18 }: { provider: string; size?: number }) {
  const Icon = provider === "zoho" ? Calculator
    : provider === "whatsapp" ? MessagesSquare
    : provider === "tally" ? FileText
    : provider === "tradeindia" || provider === "indiamart" || provider === "exportersindia" || provider === "alibaba" ? Building2
    : provider === "justdial" || provider === "google_search" ? Search
    : provider === "gmail" ? Mail
    : provider === "facebook" ? Share2
    : provider === "instagram" ? Camera
    : provider === "linkedin" ? Briefcase
    : provider === "telegram" ? Send
    : provider === "google_forms" ? FormInput
    : provider === "google_maps" ? MapPin
    : provider === "google_sheets" ? FileSpreadsheet
    : provider === "openai" ? Bot
    : provider === "custom" ? Webhook
    : Plug;
  return <Icon size={size} strokeWidth={2} />;
}

const categoryTone: Record<string, Tone> = {
  ai: "violet", accounting: "success", b2b_portal: "sky", social: "brand",
  forms: "cyan", email: "warning", geo_enrichment: "info",
  search_enrichment: "purple", custom: "neutral",
};

export function CategoryBadge({ category, label }: { category: string; label: string }) {
  return <Badge tone={categoryTone[category] || "neutral"}>{label}</Badge>;
}

export function DirectionBadge({ direction }: { direction?: string }) {
  const label = direction === "both" ? "Two-way" : direction === "inbound" ? "Inbound" : direction === "outbound" ? "Outbound" : "Connector";
  return <Badge tone={direction === "inbound" ? "sky" : direction === "outbound" ? "violet" : "brand"}>{label}</Badge>;
}

export function DeliveryBadge({ mode }: { mode: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-[var(--bg-input)] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--text-tertiary)]">
      {mode === "realtime" ? <Send size={10} /> : <Timer size={10} />}
      {mode === "realtime" ? "Real-time" : "5-min batch"}
    </span>
  );
}

const statusToneMap: Record<string, Tone> = {
  processed: "success", pending: "warning", processing: "info", dead_letter: "danger",
};

export function StatusPill({ status }: { status: string }) {
  return <Badge tone={statusToneMap[status] || "neutral"} dot>{status.replace(/_/g, " ")}</Badge>;
}

export function CopyButton({
  value,
  label = "Copy",
  size = "sm",
  onCopied,
}: {
  value: string;
  label?: string;
  size?: "sm" | "md";
  onCopied?: () => void;
}) {
  const [done, setDone] = useState(false);
  useEffect(() => { if (!done) return; const t = setTimeout(() => setDone(false), 1600); return () => clearTimeout(t); }, [done]);
  return (
    <Button
      size={size}
      variant="secondary"
      icon={done ? <Check size={13} /> : <Copy size={13} />}
      onClick={async () => {
        const ok = await copyText(value);
        if (ok) { setDone(true); onCopied?.(); }
      }}
    >
      {done ? "Copied" : label}
    </Button>
  );
}

export function FieldLabel({ children, required, hint }: { children: React.ReactNode; required?: boolean; hint?: string }) {
  return (
    <div className="mb-1.5 flex items-baseline justify-between gap-2">
      <label className="text-[11px] font-bold uppercase tracking-wide text-[var(--text-secondary)]">
        {children}{required ? <span className="ml-0.5 text-[var(--color-danger)]">*</span> : null}
      </label>
      {hint ? <span className="text-[10px] text-[var(--text-tertiary)]">{hint}</span> : null}
    </div>
  );
}

export function EmptyState({
  icon, title, body, action,
}: { icon: React.ReactNode; title: string; body?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-[var(--border-card)] bg-[var(--bg-card)] px-6 py-12 text-center">
      <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--bg-input)] text-[var(--text-tertiary)]">{icon}</div>
      <p className="text-sm font-bold text-[var(--text-primary)]">{title}</p>
      {body ? <p className="mt-1 max-w-md text-xs text-[var(--text-secondary)]">{body}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
