"use client";

import { useState } from "react";
import { manageAiProvider } from "@/api/ai-providers";

const INPUT = "px-3 py-2 bg-[var(--bg-input)] border border-[var(--border-card)] rounded-lg outline-none focus:border-brand-indigo text-[11px] font-mono text-[var(--text-primary)] disabled:opacity-50 w-full";

/** Create a provider with its first keys in ONE atomic call. */
export function NewProviderForm({ existing, onChanged, onError }: {
  existing: string[];
  onChanged: () => void;
  onError: (m: string | null) => void;
}) {
  const [id, setId] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [keys, setKeys] = useState("");
  const [busy, setBusy] = useState(false);
  const valid = id.trim() !== "" && !existing.some((e) => e.toLowerCase() === id.trim().toLowerCase())
    && baseUrl.trim() !== "" && model.trim() !== "";

  const submit = async () => {
    setBusy(true); onError(null);
    try {
      await manageAiProvider("upsert-provider", {
        id: id.trim(), baseUrl: baseUrl.trim(), model: model.trim(),
        keys: keys.split(/[,\n]/).map((k) => k.trim()).filter(Boolean).map((key) => ({ key })),
      });
      setId(""); setBaseUrl(""); setModel(""); setKeys("");
      onChanged();
    } catch (e: any) { onError(e?.message ?? "Save failed"); }
    finally { setBusy(false); }
  };

  return (
    <div className="rounded-lg border border-dashed border-[var(--border-card)] p-3 space-y-2">
      <p className="text-xs font-extrabold text-[var(--text-primary)]">Add provider</p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <label className="block">
          <span className="text-[10px] font-bold text-[var(--text-tertiary)]">ID</span>
          <input value={id} disabled={busy} onChange={(e) => setId(e.target.value)} spellCheck={false} placeholder="my-free-1" className={INPUT} />
        </label>
        <label className="block">
          <span className="text-[10px] font-bold text-[var(--text-tertiary)]">Base URL</span>
          <input value={baseUrl} disabled={busy} onChange={(e) => setBaseUrl(e.target.value)} spellCheck={false} placeholder="https://.../v1" className={INPUT} />
        </label>
        <label className="block">
          <span className="text-[10px] font-bold text-[var(--text-tertiary)]">Model</span>
          <input value={model} disabled={busy} onChange={(e) => setModel(e.target.value)} spellCheck={false} placeholder="org/model" className={INPUT} />
        </label>
      </div>
      <input value={keys} disabled={busy} onChange={(e) => setKeys(e.target.value)} spellCheck={false}
        placeholder="API keys, comma or newline separated (1–10)…" className={INPUT} />
      <button type="button" disabled={busy || !valid || keys.trim() === ""} onClick={() => void submit()}
        className="px-3 py-2 bg-brand-indigo text-white font-bold text-[11px] rounded-lg cursor-pointer border-0 disabled:opacity-40">
        Add provider + keys
      </button>
    </div>
  );
}
