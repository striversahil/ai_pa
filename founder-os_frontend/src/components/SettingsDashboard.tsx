"use client";

import React, { useState } from "react";
import { useAuth } from "@/auth/AuthContext";
import { useLiveDashboard } from "@/hooks/useLiveData";

interface SettingsPayload {
  settings: Record<string, string>;
  spec: Record<string, { key: string; label: string; hint: string; kind: "enum" | "text" | "textlist"; options: string[]; default: string }>;
  preview: {
    chat: { chain: string[]; models: Record<string, string>; route: { slugs: string; mode: string } };
    intake: { chain: string[]; models: Record<string, string> };
  };
}

const PROVIDER_LABEL: Record<string, string> = {
  agnes: "Agnes pool",
  "openrouter-paid": "Paid OpenRouter",
};

const MODEL_LABEL: Record<string, string> = {
  "agnes-3.0-flash": "Agnes 3.0 Flash",
  "agnes-2.5-flash": "Agnes 2.5 Flash",
};

function prettyChain(chain: string[], models?: Record<string, string>): string {
  if (!chain.length) return "no provider available";
  return chain
    .map((leg) => {
      const m = models?.[leg];
      return m ? `${PROVIDER_LABEL[leg] ?? leg} (${MODEL_LABEL[m] ?? m})` : (PROVIDER_LABEL[leg] ?? leg);
    })
    .join("  →  ");
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
  });
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  if (!me?.isRoot) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
        <div className="text-5xl">🔒</div>
        <h2 className="text-2xl font-bold">Root only</h2>
        <p className="max-w-md text-zinc-500">Application settings are controlled by the root account.</p>
      </div>
    );
  }

  const settings = dash.data?.settings ?? {};
  const spec = dash.data?.spec ?? {};
  const preview = dash.data?.preview;

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

  const MODE_LABEL: Record<string, string> = { prefer: "Prefer", only: "Only" };

  const providerControl = (key: string) => {
    const opts = spec[key]?.options ?? [];
    const cur = settings[key] ?? spec[key]?.default ?? opts[0];
    return (
      <div className="flex rounded-lg border border-[var(--border-card)] overflow-hidden text-[12px] font-bold">
        {opts.map((o) => (
          <button key={o} type="button" disabled={busyKey === key}
            onClick={() => void save(key, o)}
            className={`px-3.5 py-2 cursor-pointer border-0 disabled:opacity-50 ${cur === o ? "bg-brand-indigo text-white" : "bg-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]"}`}>
            {(spec[key]?.key === "chat:paid_route_mode" ? MODE_LABEL : PROVIDER_LABEL)[o] ?? o}
          </button>
        ))}
      </div>
    );
  };

  const modelControl = (key: string) => {
    const opts = spec[key]?.options ?? [];
    const cur = settings[key] ?? spec[key]?.default ?? opts[0];
    return (
      <select value={cur} disabled={busyKey === key} onChange={(e) => void save(key, e.target.value)}
        className="px-3 py-2 bg-[var(--bg-input)] border border-[var(--border-card)] rounded-lg outline-none focus:border-brand-indigo text-xs font-bold text-[var(--text-primary)] disabled:opacity-50 cursor-pointer">
        {opts.map((o) => (
          <option key={o} value={o}>{MODEL_LABEL[o] ?? o}</option>
        ))}
      </select>
    );
  };

/** Free model-id input for the paid legs (OpenRouter has hundreds of ids —
 *  a dropdown can't cover them). Draft stays local until Save; the server
 *  validates the id shape (400 on junk, never silent). Separate component so
 *  its state hook never violates hook order when sections show/hide it. */
function PaidModelInput({ value, disabled, onSave, placeholder }: { value: string; disabled: boolean; onSave: (v: string) => void; placeholder?: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? value;
  const dirty = draft !== null && draft.trim() !== value;
  return (
    <div className="flex items-center gap-2">
      <input value={shown} disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={placeholder ?? "org/model-id…"}
        spellCheck={false}
        className="w-64 px-3 py-2 bg-[var(--bg-input)] border border-[var(--border-card)] rounded-lg outline-none focus:border-brand-indigo text-xs font-mono text-[var(--text-primary)] disabled:opacity-50" />
      <button type="button" disabled={!dirty || disabled}
        onClick={() => { const v = (draft ?? "").trim(); setDraft(null); onSave(v); }}
        className="px-3 py-2 bg-brand-indigo/10 text-brand-indigo hover:bg-brand-indigo/20 font-bold text-[11px] rounded-lg cursor-pointer border-0 disabled:opacity-40">
        Save
      </button>
    </div>
  );
}

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

      {dash.loading && !dash.data && <p className="text-xs text-[var(--text-tertiary)]">Loading settings…</p>}
      {!!dash.error && !dash.data && <p className="text-xs font-bold text-red-500">Failed to load settings.</p>}
      {saveError && <p className="text-xs font-bold text-red-500">{saveError}</p>}

      {dash.data && (
        <>
          {section("AI chat",
            "Every copilot turn walks the chain in order with the same sticky key. A dead leg fails over; paid spends only when Agnes can't serve.",
            <>
              {row(spec["chat:primary_provider"]?.label ?? "Primary provider",
                spec["chat:primary_provider"]?.hint ?? "",
                providerControl("chat:primary_provider"))}
              {(settings["chat:primary_provider"] ?? spec["chat:primary_provider"]?.default) === "openrouter-paid"
                ? row(spec["chat:openrouter_model"]?.label ?? "Paid model",
                    spec["chat:openrouter_model"]?.hint ?? "",
                    <PaidModelInput
                      value={settings["chat:openrouter_model"] ?? spec["chat:openrouter_model"]?.default ?? ""}
                      disabled={busyKey === "chat:openrouter_model"}
                      onSave={(v) => void save("chat:openrouter_model", v)} />)
                : row(spec["chat:agnes_model"]?.label ?? "Agnes model",
                    spec["chat:agnes_model"]?.hint ?? "",
                    modelControl("chat:agnes_model"))}
              {row(spec["chat:paid_route"]?.label ?? "Paid provider routing",
                spec["chat:paid_route"]?.hint ?? "",
                <PaidModelInput
                  value={settings["chat:paid_route"] ?? spec["chat:paid_route"]?.default ?? ""}
                  disabled={busyKey === "chat:paid_route"}
                  placeholder="provider slugs, comma-separated — empty = default"
                  onSave={(v) => void save("chat:paid_route", v)} />)}
              {row(spec["chat:paid_route_mode"]?.label ?? "Paid routing mode",
                spec["chat:paid_route_mode"]?.hint ?? "",
                providerControl("chat:paid_route_mode"))}
              <p className="text-[11px] text-[var(--text-tertiary)]">Effective chain: <span className="font-bold text-[var(--text-secondary)]">{prettyChain(preview?.chat.chain ?? [], preview?.chat.models)}</span></p>
              <p className="text-[11px] text-[var(--text-tertiary)]">Paid route: <span className="font-bold text-[var(--text-secondary)]">{preview?.chat.route?.mode === "only" ? "ONLY " : "prefer "}{preview?.chat.route?.slugs}</span></p>
            </>
          )}

          {section("Enquiry intake",
            "Add-via-AI and new-items logging walk the chain in order. Applies to the next intake run.",
            <>
              {row(spec["intake:primary_provider"]?.label ?? "Primary provider",
                spec["intake:primary_provider"]?.hint ?? "",
                providerControl("intake:primary_provider"))}
              {(settings["intake:primary_provider"] ?? spec["intake:primary_provider"]?.default) === "openrouter-paid"
                ? row(spec["intake:openrouter_model"]?.label ?? "Paid model",
                    spec["intake:openrouter_model"]?.hint ?? "",
                    <PaidModelInput
                      value={settings["intake:openrouter_model"] ?? spec["intake:openrouter_model"]?.default ?? ""}
                      disabled={busyKey === "intake:openrouter_model"}
                      onSave={(v) => void save("intake:openrouter_model", v)} />)
                : <p className="text-[11px] text-[var(--text-tertiary)]">Agnes leg uses its default model (agnes-3.0-flash).</p>}
              <p className="text-[11px] text-[var(--text-tertiary)]">Effective chain: <span className="font-bold text-[var(--text-secondary)]">{prettyChain(preview?.intake.chain ?? [], preview?.intake.models)}</span></p>
            </>
          )}
        </>
      )}
    </div>
  );
}
