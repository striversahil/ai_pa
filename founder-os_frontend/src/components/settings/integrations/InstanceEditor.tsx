"use client";

// InstanceEditor.tsx — add/edit one provider ACCOUNT (the (provider, key)
// address `call()` resolves). Secrets are write-only: the server returns
// names, never values, so an empty box means \"keep the stored value\".

import { useState } from "react";
import { Button, Drawer } from "@/components/ui";
import { saveInstance } from "@/integrations/gateway-api";
import type { InstanceDraft, InstanceView, ProviderManifest } from "@/integrations/gateway-types";

function initialDraft(manifest: ProviderManifest, instance?: InstanceView | null): InstanceDraft {
  const config: Record<string, string> = {};
  for (const field of manifest.fields) {
    config[field.key] = instance ? String(instance.config?.[field.key] ?? "") : "";
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

const inputClass =
  "w-full rounded-lg border border-[var(--border-card)] bg-[var(--bg-card)] px-2.5 py-1.5 text-xs text-[var(--text-primary)] outline-none focus:border-brand-indigo";

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
      subtitle={manifest.hint}
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
            <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-tertiary)]">Base URL (optional)</span>
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

        {manifest.fields.map((field) => (
          <label key={field.key} className="block space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-tertiary)]">
              {field.label}{field.required ? " *" : ""}
            </span>
            <input className={inputClass} value={draft.config[field.key] ?? ""}
              placeholder={field.placeholder ?? field.hint ?? ""}
              onChange={(e) => setConfig(field.key, e.target.value)} />
          </label>
        ))}

        <div className="space-y-2 rounded-lg border border-[var(--border-card)] p-3">
          <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-tertiary)]">Credentials</p>
          {manifest.secretFields.map((field) => (
            <label key={field.key} className="block space-y-1">
              <span className="text-[11px] font-bold text-[var(--text-secondary)]">
                {field.label}{field.required ? " *" : ""}
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
