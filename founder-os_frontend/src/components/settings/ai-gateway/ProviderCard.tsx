"use client";

import { useState } from "react";
import type { AiHealthConfig, AiKeyInfo, AiProviderInfo, AiRuntimeProvider } from "@/ai-gateway/types";
import { manageAiProvider } from "@/api/ai-providers";
import { setKeyEnabled, setProviderEnabled } from "@/ai-gateway/api";
import { HealthBadge } from "./HealthBadge";

const INPUT = "px-3 py-2 bg-[var(--bg-input)] border border-[var(--border-card)] rounded-lg outline-none focus:border-brand-indigo text-[11px] font-mono text-[var(--text-primary)] disabled:opacity-50 w-full";

function Switch({ on, busy, onClick, title }: { on: boolean; busy: boolean; onClick: () => void; title: string }) {
  return (
    <button type="button" title={title} disabled={busy} onClick={onClick}
      className={`relative w-9 h-5 rounded-full border-0 cursor-pointer transition-colors disabled:opacity-40 ${on ? "bg-emerald-500" : "bg-[var(--border-card)]"}`}>
      <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${on ? "left-[18px]" : "left-0.5"}`} />
    </button>
  );
}

/** One BYOK provider: URL/model, provider switch, key switches + health. */
export function ProviderCard({ provider, runtime, cfg, onChanged, onError }: {
  provider: AiProviderInfo;
  runtime?: AiRuntimeProvider;
  cfg?: AiHealthConfig;
  onChanged: () => void;
  onError: (m: string | null) => void;
}) {
  const [baseUrl, setBaseUrl] = useState(provider.baseUrl);
  const [model, setModel] = useState(provider.model);
  const [newKeys, setNewKeys] = useState("");
  const [busy, setBusy] = useState(false);
  const dirty = baseUrl.trim() !== provider.baseUrl || model.trim() !== provider.model;

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); onError(null);
    try { await fn(); onChanged(); }
    catch (e: any) { onError(e?.message ?? "Save failed"); }
    finally { setBusy(false); }
  };

  const removeKey = (index: number) => {
    if (!confirm(`Remove key #${index + 1} from "${provider.id}"? This cannot be undone.`)) return;
    void run(() => manageAiProvider("remove-key", { id: provider.id, index }));
  };

  const addKeys = () => {
    const keys = newKeys.split(/[,\n]/).map((k) => k.trim()).filter(Boolean).map((key) => ({ key }));
    if (keys.length === 0) return;
    setNewKeys("");
    void run(() => manageAiProvider("add-keys", { id: provider.id, keys }));
  };

  return (
    <div className={`rounded-lg border p-3 space-y-2 ${provider.enabled ? "border-[var(--border-card)]" : "border-amber-500/40 bg-amber-500/5"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Switch on={provider.enabled} busy={busy} title={provider.enabled ? "Disable provider (keys stay stored)" : "Enable provider"}
          onClick={() => void run(() => setProviderEnabled(provider.id, !provider.enabled))} />
        <p className="text-xs font-extrabold text-[var(--text-primary)] font-mono flex-1">{provider.id}</p>
        {runtime && (
          <span className="text-[10px] font-bold text-[var(--text-tertiary)]">{runtime.usable}/{runtime.total} usable</span>
        )}
        <span className="text-[10px] font-bold text-[var(--text-tertiary)]">{provider.keys.length} key{provider.keys.length === 1 ? "" : "s"}</span>
        <button type="button" disabled={busy}
          onClick={() => { if (confirm(`Delete provider "${provider.id}" and its ${provider.keys.length} keys?`)) void run(() => manageAiProvider("delete-provider", { id: provider.id })); }}
          className="px-2 py-1 text-[10px] font-bold rounded-md cursor-pointer border-0 disabled:opacity-40 bg-red-500/10 text-red-500 hover:bg-red-500/20">
          Delete
        </button>
      </div>

      {!provider.enabled && (
        <p className="text-[10px] font-bold text-amber-600 dark:text-amber-400">
          Provider is off — none of its keys compete for traffic (nothing was deleted).
        </p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <label className="block">
          <span className="text-[10px] font-bold text-[var(--text-tertiary)]">Base URL</span>
          <input value={baseUrl} disabled={busy} onChange={(e) => setBaseUrl(e.target.value)} spellCheck={false} placeholder="https://.../v1" className={INPUT} />
        </label>
        <label className="block">
          <span className="text-[10px] font-bold text-[var(--text-tertiary)]">Model</span>
          <input value={model} disabled={busy} onChange={(e) => setModel(e.target.value)} spellCheck={false} placeholder="org/model" className={INPUT} />
        </label>
      </div>
      {dirty && (
        <button type="button" disabled={busy}
          onClick={() => void run(() => manageAiProvider("upsert-provider", { id: provider.id, baseUrl: baseUrl.trim(), model: model.trim() }))}
          className="px-3 py-1.5 bg-brand-indigo/10 text-brand-indigo hover:bg-brand-indigo/20 font-bold text-[11px] rounded-lg cursor-pointer border-0 disabled:opacity-40">
          Save URL / model (keys kept)
        </button>
      )}

      <div className="space-y-1">
        {provider.keys.length === 0 && <p className="text-[10px] text-[var(--text-tertiary)]">No keys yet — paste at least one below.</p>}
        {provider.keys.map((k, i) => (
          <KeyRow key={k.id} k={k} index={i} cfg={cfg} busy={busy}
            onToggle={() => void run(() => setKeyEnabled(provider.id, k.id, !k.enabled))}
            onRemove={() => removeKey(i)} />
        ))}
        <div className="flex items-center gap-2 pt-1">
          <input value={newKeys} disabled={busy} onChange={(e) => setNewKeys(e.target.value)} spellCheck={false}
            placeholder="Paste new keys, comma or newline separated…"
            className="flex-1 px-3 py-2 bg-[var(--bg-input)] border border-dashed border-[var(--border-card)] rounded-lg outline-none focus:border-brand-indigo text-[11px] font-mono text-[var(--text-primary)] disabled:opacity-50" />
          <button type="button" disabled={busy || newKeys.trim() === ""} onClick={addKeys}
            className="px-3 py-2 bg-brand-indigo/10 text-brand-indigo hover:bg-brand-indigo/20 font-bold text-[11px] rounded-lg cursor-pointer border-0 disabled:opacity-40">
            Add keys
          </button>
        </div>
      </div>
    </div>
  );
}

function KeyRow({ k, index, cfg, busy, onToggle, onRemove }: {
  k: AiKeyInfo; index: number; cfg?: AiHealthConfig; busy: boolean;
  onToggle: () => void; onRemove: () => void;
}) {
  const name = k.label?.trim() || `Key ${index + 1}`;
  return (
    <div className={`flex flex-wrap items-center gap-2 rounded-md px-2 py-1.5 ${k.enabled ? "" : "opacity-70"}`}>
      <span className="text-[11px] font-bold text-[var(--text-primary)]">{name}</span>
      <span className="text-[10px] font-mono text-[var(--text-tertiary)]">••••{k.last4}</span>
      <HealthBadge health={k.health} enabled={k.enabled} cfg={cfg} />
      {k.disabledBy === "health" && (
        <span className="text-[10px] text-red-500" title={k.disabledReason ?? ""}>auto-disabled</span>
      )}
      {k.disabledBy === "user" && <span className="text-[10px] text-[var(--text-tertiary)]">manual</span>}
      <span className="flex-1" />
      <button type="button" disabled={busy} onClick={onToggle}
        className={`px-2 py-1 text-[10px] font-bold rounded-md cursor-pointer border-0 disabled:opacity-40 ${k.enabled ? "bg-amber-500/10 text-amber-600 dark:text-amber-400" : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"}`}>
        {k.enabled ? "Disable" : "Enable"}
      </button>
      <button type="button" disabled={busy} onClick={onRemove}
        className="px-2 py-1 text-[10px] font-bold rounded-md cursor-pointer border border-[var(--border-card)] bg-transparent text-[var(--text-secondary)] disabled:opacity-40">
        Remove
      </button>
    </div>
  );
}
