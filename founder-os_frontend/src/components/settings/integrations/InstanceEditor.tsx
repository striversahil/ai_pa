"use client";

// InstanceEditor.tsx — add/edit one provider ACCOUNT (the (provider, key)
// address `call()` resolves). Fields, types, options, defaults and
// requiredWhen all come from manifest.json; secrets are write-only (the
// server returns names, never values, so an empty box means "keep stored").

import { useState } from "react";
import { Button, Drawer } from "@/components/ui";
import { saveInstance } from "@/integrations/gateway-api";
import type { FieldCondition, InstanceDraft, InstanceView, ProviderField, ProviderManifest } from "@/integrations/gateway-types";

function conditionMet(condition: FieldCondition | undefined, config: Record<string, string>): boolean {
  if (!condition) return true;
  const value = String(config[condition.field] ?? "");
  if (condition.includes !== undefined) return value.includes(condition.includes);
  if (condition.equals !== undefined) return value === String(condition.equals);
  return value !== "";
}

function initialDraft(manifest: ProviderManifest, instance?: InstanceView | null): InstanceDraft {
  const config: Record<string, string> = {};
  for (const field of manifest.configFields) {
    const stored = instance ? instance.config?.[field.key] : undefined;
    const fallback = field.defaultValue !== undefined ? String(field.defaultValue) : "";
    config[field.key] = stored === undefined || stored === null ? fallback : String(stored);
  }
  return {
    provider: manifest.provider,
    instanceKey: instance?.instanceKey ?? "default",
    label: instance?.label ?? "",
    deliveryMode: instance?.deliveryMode ?? manifest.defaultDeliveryMode,
    baseUrl: instance?.baseUrl ?? "",
    isDefault: instance?.isDefault ?? false,
    enabled: instance?.enabled ?? true,
    config,
    secrets: {},
  };
}

const inputClass = "w-full rounded-lg border border-[var(--border-card)] bg-[var(--bg-card)] px-2.5 py-1.5 text-xs text-[var(--text-primary)] outline-none focus:border-brand-indigo";

function FieldInput({ field, value, onChange }: { field: ProviderField; value: string; onChange: (v: string) => void }) {
  if (field.type === "select") {
    return (
      <select className={inputClass} value={value} onChange={(e) => onChange(e.target.value)}>
        {!field.options?.includes(value) && <option value="">Choose…</option>}
        {(field.options ?? []).map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    );
  }
  if (field.type === "boolean") {
    return (
      <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
        <input type="checkbox" checked={value === "true"} onChange={(e) => onChange(e.target.checked ? "true" : "false")} />
        {field.hint ?? "Enabled"}
      </label>
    );
  }
  if (field.type === "textarea" || field.type === "json") {
    return (
      <textarea
        className={`${inputClass} min-h-[72px] font-mono`}
        value={value}
        placeholder={field.placeholder ?? field.hint ?? ""}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  return (
    <input
      className={inputClass}
      type={field.type === "number" ? "number" : "text"}
      value={value}
      placeholder={field.placeholder ?? field.hint ?? ""}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function InstanceEditor({ manifest, instance, onClose, onSaved }: {
  manifest: ProviderManifest;
  instance?: InstanceView | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<InstanceDraft>(() => initialDraft(manifest, instance));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const patch = (next: Partial<InstanceDraft>) => setDraft((d) => ({ ...d, ...next }));
  const setConfig = (key: string, value: string) => setDraft((d) => ({ ...d, config: { ...d.config, [key]: value } }));
  const setSecret = (key: string, value: string) => setDraft((d) => ({ ...d, secrets: { ...d.secrets, [key]: value } }));

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await saveInstance(
        {
          provider: manifest.provider,
          instanceKey: draft.instanceKey.trim() || "default",
          label: draft.label.trim(),
          deliveryMode: draft.deliveryMode,
          baseUrl: draft.baseUrl.trim(),
          isDefault: draft.isDefault,
          enabled: draft.enabled,
          config: draft.config,
          secrets: draft.secrets,
        },
        instance?.id,
      );
      onSaved();
    } catch (e: any) {
      setError(e?.message ?? "Save failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      title={instance ? `Edit ${instance.label}` : `Add ${manifest.label}`}
      subtitle={manifest.description}
      onClose={onClose}
      width="max-w-xl"
    >
      <div className="space-y-4 px-5 py-4">
        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-tertiary)]">Instance key</span>
            <input className={inputClass} value={draft.instanceKey} disabled={!!instance}
              placeholder="default" onChange={(e) => patch({ instanceKey: e.target.value })} />
          </label>
          <label className="space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-tertiary)]">Label</span>
            <input className={inputClass} value={draft.label} placeholder={`${manifest.label} default`}
              onChange={(e) => patch({ label: e.target.value })} />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-tertiary)]">Delivery</span>
            <select className={inputClass} value={draft.deliveryMode}
              onChange={(e) => patch({ deliveryMode: e.target.value === "realtime" ? "realtime" : "batch" })}>
              <option value="realtime">Realtime (process on receipt)</option>
              <option value="batch">Batch (scheduled runner)</option>
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-tertiary)]">Base URL (optional override)</span>
            <input className={inputClass} value={draft.baseUrl} placeholder="https://…"
              onChange={(e) => patch({ baseUrl: e.target.value })} />
          </label>
        </div>

        <div className="flex items-center gap-4 text-[11px] text-[var(--text-secondary)]">
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={draft.isDefault} onChange={(e) => patch({ isDefault: e.target.checked })} />
            Default for this provider
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={draft.enabled} onChange={(e) => patch({ enabled: e.target.checked })} />
            Enabled
          </label>
        </div>

        {manifest.configFields
          .filter((field) => conditionMet(field.requiredWhen, draft.config))
          .map((field) => (
            <label key={field.key} className="block space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-tertiary)]">
                {field.label}{field.required || field.requiredWhen ? " *" : ""}
              </span>
              <FieldInput field={field} value={draft.config[field.key] ?? ""} onChange={(v) => setConfig(field.key, v)} />
              {field.hint && field.type !== "boolean" && <span className="text-[10px] text-[var(--text-tertiary)]">{field.hint}</span>}
            </label>
          ))}

        <div className="space-y-2 rounded-lg border border-[var(--border-card)] p-3">
          <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-tertiary)]">Credentials</p>
          {manifest.secretFields
            .filter((field) => conditionMet(field.requiredWhen, draft.config))
            .map((field) => (
              <label key={field.key} className="block space-y-1">
                <span className="text-[11px] font-bold text-[var(--text-secondary)]">
                  {field.label}{field.required || field.requiredWhen ? " *" : ""}
                </span>
                <input className={inputClass} type="password" autoComplete="new-password"
                  value={draft.secrets[field.key] ?? ""}
                  placeholder={instance?.secretKeys.includes(field.key) ? "•••• stored — type to replace" : (field.placeholder ?? field.hint ?? "")}
                  onChange={(e) => setSecret(field.key, e.target.value)} />
              </label>
            ))}
          <p className="text-[10px] text-[var(--text-tertiary)]">
            Empty = keep the stored value. Encrypted at rest (AES-256-GCM); never returned by any route.
          </p>
        </div>

        {error && <p className="text-xs font-bold text-red-500">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={() => void save()} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
        </div>
      </div>
    </Drawer>
  );
}
