"use client";

// AccountForm.tsx — one manifest-driven account form inside the provider
// drawer. No stacked drawers: editing replaces the drawer body and Cancel
// returns to the account list.

import React, { useMemo, useState } from "react";
import { AlertCircle, ArrowLeft, Check, Eye, EyeOff, Lock, Save } from "lucide-react";
import { Button } from "@/components/ui";
import { saveInstance } from "@/integrations/gateway-api";
import { buildPayload, fieldRequired, fieldVisible, hasStoredSecret, initialDraft, validateWithStored } from "@/integrations/gateway-pure";
import type { Draft } from "@/integrations/gateway-pure";
import type { InstanceView, ProviderField, ProviderManifest } from "@/integrations/gateway-types";
import { DeliveryBadge, FieldLabel, inputClass, selectClass, textareaClass } from "./gateway-ui";

function optionValue(option: unknown): string {
  if (option && typeof option === "object" && "value" in option) return String((option as { value: unknown }).value);
  return String(option ?? "");
}

function optionLabel(option: unknown): string {
  if (option && typeof option === "object" && "label" in option) return String((option as { label: unknown }).label);
  return optionValue(option);
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${checked ? "bg-[var(--color-brand-indigo)]" : "bg-[var(--border-strong)]"}`}>
      <span className={`h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${checked ? "translate-x-[18px]" : "translate-x-0.5"}`} />
    </button>
  );
}

function FieldControl({ field, value, onChange }: { field: ProviderField; value: unknown; onChange: (v: unknown) => void }) {
  if (field.type === "boolean") {
    return (
      <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-[var(--border-card)] bg-[var(--bg-input)] px-3 py-2 text-xs text-[var(--text-primary)]">
        <input type="checkbox" checked={value === true || value === "true" || value === 1} aria-label={field.label}
          onChange={(e) => onChange(e.target.checked)} className="h-3.5 w-3.5 accent-[var(--color-brand-indigo)]" />
        Enabled
      </label>
    );
  }
  if (field.type === "select") {
    return (
      <select className={selectClass} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>
        <option value="">Not set</option>
        {(field.options || []).map((option) => (
          <option key={optionValue(option)} value={optionValue(option)}>{optionLabel(option)}</option>
        ))}
      </select>
    );
  }
  if (field.type === "json") {
    return (
      <textarea className={textareaClass} value={typeof value === "string" ? value : value ? JSON.stringify(value, null, 2) : ""}
        onChange={(e) => onChange(e.target.value)} placeholder={field.placeholder || "{ }"} spellCheck={false} />
    );
  }
  return (
    <input className={inputClass} type={field.type === "number" ? "number" : "text"} value={String(value ?? "")}
      onChange={(e) => onChange(e.target.value)} placeholder={field.placeholder || ""} />
  );
}

export function AccountForm({
  manifest, instance, hasDefault = false, onCancel, onSaved,
}: {
  manifest: ProviderManifest;
  instance?: InstanceView | null;
  hasDefault?: boolean;
  onCancel: () => void;
  onSaved: (message: string) => void;
}) {
  const editing = !!instance;
  const [draft, setDraft] = useState<Draft>(() => {
    const base = initialDraft(manifest, instance);
    // Never silently demote the provider's current default just because a new
    // account was added; the operator can still switch it on deliberately.
    return instance || !hasDefault ? base : { ...base, isDefault: false };
  });
  const [errors, setErrors] = useState<string[]>([]);
  const [saveError, setSaveError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reveal, setReveal] = useState<Record<string, boolean>>({});

  const configFields = useMemo(
    () => (manifest.configFields || []).filter((field) => fieldVisible(field, draft.config, draft.secrets)),
    [manifest.configFields, draft.config, draft.secrets],
  );

  const secretFields = useMemo(
    () => (manifest.secretFields || []).filter((field) => fieldVisible(field, draft.config, draft.secrets)),
    [manifest.secretFields, draft.config, draft.secrets],
  );

  const patch = (next: Partial<Draft>) => setDraft((prev) => ({ ...prev, ...next }));
  const setConfig = (key: string, value: unknown) => setDraft((prev) => ({ ...prev, config: { ...prev.config, [key]: value } }));
  const setSecret = (key: string, value: string) => setDraft((prev) => ({ ...prev, secrets: { ...prev.secrets, [key]: value } }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const next = validateWithStored(manifest, draft, instance);
    setErrors(next);
    setSaveError("");
    if (next.length) return;
    setBusy(true);
    try {
      await saveInstance(buildPayload(manifest, draft, editing), instance?.id);
      onSaved(editing ? "Account updated." : "Account connected.");
    } catch (error: any) {
      setSaveError(String(error?.message || "Could not save this account"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <button type="button" onClick={onCancel} className="inline-flex items-center gap-1.5 text-[11px] font-bold text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
        <ArrowLeft size={13} /> Back to {manifest.label} accounts
      </button>

      {!!errors.length && (
        <div className="rounded-xl border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/10 px-3 py-2.5">
          <p className="flex items-center gap-1.5 text-[11px] font-bold text-[var(--color-danger)]"><AlertCircle size={12} /> Check these fields</p>
          <ul className="mt-1 list-inside list-disc text-[11px] text-[var(--text-secondary)]">{errors.map((error) => <li key={error}>{error}</li>)}</ul>
        </div>
      )}
      {saveError && <p className="rounded-lg bg-[var(--color-danger)]/10 px-3 py-2 text-[11px] font-bold text-[var(--color-danger)]">{saveError}</p>}

      <section className="rounded-xl border border-[var(--border-card)] bg-[var(--bg-card)] p-4">
        <h4 className="mb-3 text-xs font-extrabold text-[var(--text-primary)]">Account identity</h4>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <FieldLabel required={!editing} hint={editing ? "immutable" : "default is fine"}>Instance key</FieldLabel>
            <input className={inputClass} value={draft.instanceKey} disabled={editing}
              onChange={(e) => patch({ instanceKey: e.target.value.toLowerCase() })} placeholder="default" />
          </div>
          <div>
            <FieldLabel hint="shown across the dashboard">Label</FieldLabel>
            <input className={inputClass} value={draft.label} onChange={(e) => patch({ label: e.target.value })} placeholder={manifest.label} />
          </div>
          <div className="sm:col-span-2">
            <FieldLabel hint="optional for hosted APIs">Base URL</FieldLabel>
            <input className={inputClass} value={draft.baseUrl} onChange={(e) => patch({ baseUrl: e.target.value })}
              placeholder={manifest.defaultBaseUrl || "https://api.example.com"} />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-4 rounded-lg bg-[var(--bg-input)] px-3 py-2.5">
          <label className="flex items-center gap-2 text-[11px] font-semibold text-[var(--text-secondary)]">
            <Toggle checked={draft.enabled} onChange={(enabled) => patch({ enabled })} label="Enabled" /> Enabled
          </label>
          <label className="flex items-center gap-2 text-[11px] font-semibold text-[var(--text-secondary)]">
            <Toggle checked={draft.isDefault} onChange={(isDefault) => patch({ isDefault })} label="Default account" /> Default account
          </label>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-tertiary)]">Inbound mode</span>
            {(["realtime", "batch"] as const).map((mode) => (
              <button key={mode} type="button" onClick={() => patch({ deliveryMode: mode })}
                className={`rounded-md px-2 py-1 text-[10px] font-bold ${draft.deliveryMode === mode ? "bg-[var(--color-brand-indigo)] text-white" : "bg-[var(--bg-card)] text-[var(--text-secondary)]"}`}>
                {mode === "realtime" ? "Real-time" : "Batch"}
              </button>
            ))}
          </div>
        </div>
        <p className="mt-1.5 text-[10px] text-[var(--text-tertiary)]"><DeliveryBadge mode={draft.deliveryMode} /> applies to inbound events; outbound calls are always live.</p>
      </section>

      {!!configFields.length && (
        <section className="rounded-xl border border-[var(--border-card)] bg-[var(--bg-card)] p-4">
          <h4 className="mb-1 text-xs font-extrabold text-[var(--text-primary)]">Configuration</h4>
          <p className="mb-3 text-[10px] text-[var(--text-tertiary)]">Fields come from the provider manifest — required conditions are enforced server-side too.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {configFields.map((field) => (
              <div key={field.key} className={field.type === "json" ? "sm:col-span-2" : ""}>
                <FieldLabel required={fieldRequired(field, draft.config, draft.secrets)} hint={field.hint}>{field.label}</FieldLabel>
                <FieldControl field={field} value={draft.config[field.key]} onChange={(value) => setConfig(field.key, value)} />
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="rounded-xl border border-[var(--border-card)] bg-[var(--bg-card)] p-4">
        <h4 className="flex items-center gap-1.5 text-xs font-extrabold text-[var(--text-primary)]"><Lock size={12} /> Credentials</h4>
        <p className="mb-3 mt-1 text-[10px] text-[var(--text-tertiary)]">AES-256-GCM encrypted at rest. Existing values are never returned to this page — leave a field blank to keep the stored secret.</p>
        {!secretFields.length ? (
          <p className="rounded-lg bg-[var(--bg-input)] px-3 py-2 text-[11px] text-[var(--text-secondary)]">This provider needs no stored credentials.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {secretFields.map((field) => {
              const stored = hasStoredSecret(instance, field);
              return (
                <div key={field.key} className="sm:col-span-2">
                  <FieldLabel required={fieldRequired(field, draft.config, draft.secrets) && !stored}
                    hint={stored ? (field.hint ? `stored · ${field.hint}` : "stored") : field.hint}>
                    {field.label}
                  </FieldLabel>
                  <div className="relative">
                    <input className={`${inputClass} pr-9`} type={reveal[field.key] ? "text" : "password"}
                      value={draft.secrets[field.key] || ""} onChange={(e) => setSecret(field.key, e.target.value)}
                      placeholder={stored ? "•••••••• stored — leave blank to keep" : field.placeholder || "Paste credential"} autoComplete="new-password" />
                    <button type="button" aria-label={reveal[field.key] ? "Hide value" : "Show value"}
                      onClick={() => setReveal((prev) => ({ ...prev, [field.key]: !prev[field.key] }))}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)] hover:text-[var(--text-primary)]">
                      {reveal[field.key] ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <div className="sticky bottom-0 -mx-5 -mb-4 mt-2 flex items-center justify-end gap-2 border-t border-[var(--border-card)] bg-[var(--bg-card)]/95 px-5 py-3 backdrop-blur">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button type="submit" disabled={busy} icon={busy ? <Check size={13} /> : <Save size={13} />}>
          {busy ? "Saving…" : editing ? "Save changes" : "Connect account"}
        </Button>
      </div>
    </form>
  );
}
