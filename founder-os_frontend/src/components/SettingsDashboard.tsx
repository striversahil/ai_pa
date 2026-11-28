"use client";

import React, { useState } from "react";
import { useAuth } from "@/auth/AuthContext";
import { useLiveDashboard } from "@/hooks/useLiveData";
import { AiGatewayPanel } from "@/components/settings/ai-gateway/AiGatewayPanel";
import { IntegrationsGatewayPanel } from "@/components/settings/integrations/IntegrationsGatewayPanel";

interface SettingsPayload {
  settings: Record<string, string>;
  spec: Record<string, { key: string; label: string; hint: string; kind: "enum" | "text" | "textlist" | "json" | "jsonlarge"; options: string[]; default: string }>;
  preview: {
    ai?: { strategy: string; keys: number; providers: Array<{ provider: string; usable: number; total: number }> };
  };
}

/** Root-only runtime application settings: AI provider priority + model
 *  selection for chat and enquiry intake. Values are plain enums in the
 *  Setting table — key material never passes through here. Writes are
 *  non-optimistic (server truth wins); the live event converges all tabs. */
export default function SettingsDashboard() {
  const { me } = useAuth();
  const dash = useLiveDashboard<SettingsPayload>(async () => {
    const res = await fetch("/api/settings");
    if (!res.ok) throw new Error(`load failed (${res.status})`);
    return res.json();
  }, { events: ["settings"] });
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  if (!me?.isRoot) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
        <div className="text-5xl">🔒</div>
        <h2 className="text-2xl font-bold">Root only</h2>
        <p className="max-w-md text-[var(--text-tertiary)]">Application settings are controlled by the root account.</p>
      </div>
    );
  }

  const settings = dash.data?.settings ?? {};
  const spec = dash.data?.spec ?? {};

  const save = async (key: string, value: string) => {
    if ((settings[key] ?? spec[key]?.default) === value || busyKey) return;
    setBusyKey(key);
    setSaveError(null);
    try {
      const res = await fetch(`/api/settings/${encodeURIComponent(key)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value }),
      });
      // Never flip the control optimistically: a failed PUT must NOT display
      // the new state (same rule as the penalty toggle).
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `Save failed (${res.status})`);
      }
      const body = await res.json().catch(() => ({}));
      if (body && body.ok === false) throw new Error(body?.error || "Save failed");
      dash.refresh();
    } catch (e: any) {
      setSaveError(e?.message ?? "Save failed");
    } finally {
      setBusyKey(null);
    }
  };

  const providerControl = (key: string) => {
    const opts = spec[key]?.options ?? [];
    const cur = settings[key] ?? spec[key]?.default ?? opts[0];
    const labels: Record<string, string> = { "least-used-first": "Least-used first", "round-robin": "Round robin", enforce: "Invoice required", off: "Gate off" };
    return (
      <div className="flex rounded-lg border border-[var(--border-card)] overflow-hidden text-[12px] font-bold">
        {opts.map((o) => (
          <button key={o} type="button" disabled={busyKey === key}
            onClick={() => void save(key, o)}
            className={`px-3.5 py-2 cursor-pointer border-0 disabled:opacity-50 ${cur === o ? "bg-brand-indigo text-white" : "bg-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]"}`}>
            {labels[o] ?? o}
          </button>
        ))}
      </div>
    );
  };

  const section = (title: string, desc: string, children: React.ReactNode) => (
    <div className="rounded-xl border border-[var(--border-card)]/70 bg-[var(--bg-input)]/20 p-4 space-y-3">
      <div>
        <h3 className="text-sm font-extrabold text-[var(--text-primary)]">{title}</h3>
        <p className="text-[11px] text-[var(--text-secondary)] mt-0.5">{desc}</p>
      </div>
      {children}
    </div>
  );

  const row = (label: string, hint: string, control: React.ReactNode) => (
    <div className="flex flex-wrap items-center gap-3">
      <div className="min-w-[12rem] flex-1">
        <p className="text-xs font-bold text-[var(--text-primary)]">{label}</p>
        <p className="text-[10px] text-[var(--text-tertiary)]">{hint}</p>
      </div>
      {control}
    </div>
  );

  return (
    <div className="space-y-4 max-w-3xl">
      <div>
        <h2 className="text-lg font-extrabold text-[var(--text-primary)]">Settings</h2>
        <p className="text-[11px] text-[var(--text-secondary)]">Runtime backend controls. Changes apply to the next chat turn / intake run — no deploy needed. API keys stay in secrets and are never shown here.</p>
      </div>

      <>
      {dash.loading && !dash.data && <p className="text-xs text-[var(--text-tertiary)]">Loading settings…</p>}
      {!!dash.error && !dash.data && <p className="text-xs font-bold text-red-500">Failed to load settings.</p>}
      {saveError && <p className="text-xs font-bold text-red-500">{saveError}</p>}

      {dash.data && (
        <>
          {section("AI gateway (BYOK)",
            "One endpoint for every AI call: POST /api/ai/complete. Add any OpenAI-compatible providers + keys; strategy applies globally. Keys are stored server-side and never displayed — not even here.",
            <>
              {row(spec["ai:strategy"]?.label ?? "Strategy",
                spec["ai:strategy"]?.hint ?? "",
                providerControl("ai:strategy"))}
              <AiGatewayPanel />
            </>
          )}

          {section("Third-party providers",
            "Every outside service resolves through one call(provider, { instanceKey }) facade: Zoho Books, WhatsApp Cloud, Tally, TradeIndia, Justdial, Alibaba, custom HTTP. Each account's credentials are encrypted at rest and refreshed automatically; inbound pushes stage in one log and either process instantly or wait for the 5-minute runner.",
            <IntegrationsGatewayPanel />
          )}

          {section("CRM dispatch floor",
            "The invoicing check on dispatch. The floor normally needs a fresh invoice PDF for every batch; with the gate off material can go out now and the invoice follows later — the batch is recorded either way.",
            <>
              {row(spec["crm:invoice_gate"]?.label ?? "Invoice gate",
                spec["crm:invoice_gate"]?.hint ?? "",
                providerControl("crm:invoice_gate"))}
              {(settings["crm:invoice_gate"] ?? "enforce") === "off" && (
                <p className="text-[11px] font-bold text-amber-600 dark:text-amber-400">
                  Accounting check is lifted — dispatches go out without an invoice and are recorded as such.
                </p>
              )}
            </>
          )}
        </>
      )}
      </>
    </div>
  );
}
