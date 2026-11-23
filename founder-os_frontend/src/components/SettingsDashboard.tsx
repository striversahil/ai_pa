"use client";

import React, { useState } from "react";
import { useAuth } from "@/auth/AuthContext";
import { TabBar } from "@/components/ui";
import { NotificationConsole } from "@/components/notifications-console/NotificationConsole";
import { useLiveDashboard } from "@/hooks/useLiveData";
import { manageAiProvider } from "@/api/ai-providers";

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
  const [tab, setTab] = useState<"ai" | "notifications">("ai");

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

  const providerControl = (key: string) => {
    const opts = spec[key]?.options ?? [];
    const cur = settings[key] ?? spec[key]?.default ?? opts[0];
    const labels: Record<string, string> = { "least-used-first": "Least-used first", "round-robin": "Round robin" };
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

      <TabBar
        variant="segmented"
        active={tab}
        onChange={(k: string) => setTab(k as "ai" | "notifications")}
        items={[
          { key: "ai", label: "AI gateway" },
          { key: "notifications", label: "Notifications" },
        ]}
      />

      {tab === "notifications" ? <NotificationConsole /> : <>
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
              <ProviderList
                savedJson={settings["ai:providers"] ?? ""}
                busy={busyKey === "ai:providers"}
                setBusy={(b) => setBusyKey(b ? "ai:providers" : null)}
                onError={(m) => setSaveError(m)}
                refresh={() => dash.refresh()} />
              <p className="text-[11px] text-[var(--text-tertiary)]">
                Pool: <span className="font-bold text-[var(--text-secondary)]">{preview?.ai?.keys ?? 0} keys</span>
                {(preview?.ai?.providers ?? []).map((p) => ` · ${p.provider} ${p.usable}/${p.total}`).join("")}
              </p>
            </>
          )}
        </>
      )}
      </>}
    </div>
  );
}

/** AI provider list (BYOK): one card per provider (id, base URL, model) +
 *  its key slots. Server redacts keys (counts only), so all mutations go
 *  through POST /api/ai/providers (upsert-provider keeps keys, add-keys
 *  appends, remove-key drops by slot, delete-provider removes). Keys are
 *  write-only inputs — they clear on save and are never rendered back. */
function ProviderList({ savedJson, busy, setBusy, onError, refresh }: {
  savedJson: string; busy: boolean; setBusy: (b: boolean) => void;
  onError: (m: string | null) => void; refresh: () => void;
}) {
  type Saved = { id: string; baseUrl: string; model: string; keys: number };
  let saved: Saved[] = [];
  try {
    const p = JSON.parse(savedJson || '{"providers":[]}');
    const list = Array.isArray(p) ? p : p?.providers ?? [];
    saved = list.map((x: any) => ({
      id: String(x.id ?? ""), baseUrl: String(x.baseUrl ?? ""),
      model: String(x.model ?? ""), keys: typeof x.keys === "number" ? x.keys : (x.keys?.length ?? 0),
    })).filter((x: Saved) => x.id);
  } catch { /* ignore */ }

  const call = async (action: "upsert-provider" | "add-keys" | "remove-key" | "delete-provider", payload: Record<string, unknown>) => {
    setBusy(true);
    onError(null);
    try {
      await manageAiProvider(action, payload);
      refresh();
    } catch (e: any) {
      onError(e?.message ?? "Save failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      {saved.length === 0 && (
        <p className="text-[11px] text-[var(--text-tertiary)]">No custom providers yet — add one below. Until then the pool serves from server env keys only.</p>
      )}
      {saved.map((p) => (
        <ProviderCard key={`${p.id}|${p.baseUrl}|${p.model}|${p.keys}`} saved={p} busy={busy} call={call} />
      ))}
      <NewProviderForm busy={busy} existing={saved.map((p) => p.id)} call={call} />
    </div>
  );
}

function ProviderCard({ saved, busy, call }: {
  saved: { id: string; baseUrl: string; model: string; keys: number };
  busy: boolean;
  call: (action: "upsert-provider" | "add-keys" | "remove-key" | "delete-provider", payload: Record<string, unknown>) => Promise<void>;
}) {
  const [baseUrl, setBaseUrl] = useState(saved.baseUrl);
  const [model, setModel] = useState(saved.model);
  const [newKeys, setNewKeys] = useState("");
  const dirty = baseUrl.trim() !== saved.baseUrl || model.trim() !== saved.model;
  const inputCls = "px-3 py-2 bg-[var(--bg-input)] border border-[var(--border-card)] rounded-lg outline-none focus:border-brand-indigo text-[11px] font-mono text-[var(--text-primary)] disabled:opacity-50 w-full";
  return (
    <div className="rounded-lg border border-[var(--border-card)] p-3 space-y-2">
      <div className="flex items-center gap-2">
        <p className="text-xs font-extrabold text-[var(--text-primary)] flex-1 font-mono">{saved.id}</p>
        <span className="text-[10px] font-bold text-[var(--text-tertiary)]">{saved.keys} key{saved.keys === 1 ? "" : "s"}</span>
        <button type="button" disabled={busy}
          onClick={() => { if (confirm(`Delete provider "${saved.id}" and its ${saved.keys} keys?`)) void call("delete-provider", { id: saved.id }); }}
          className="px-2 py-1 text-[10px] font-bold rounded-md cursor-pointer border-0 disabled:opacity-40 bg-red-500/10 text-red-500 hover:bg-red-500/20">
          Delete
        </button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <label className="block">
          <span className="text-[10px] font-bold text-[var(--text-tertiary)]">Base URL</span>
          <input value={baseUrl} disabled={busy} onChange={(e) => setBaseUrl(e.target.value)} spellCheck={false} placeholder="https://.../v1" className={inputCls} />
        </label>
        <label className="block">
          <span className="text-[10px] font-bold text-[var(--text-tertiary)]">Model</span>
          <input value={model} disabled={busy} onChange={(e) => setModel(e.target.value)} spellCheck={false} placeholder="org/model" className={inputCls} />
        </label>
      </div>
      {dirty && (
        <button type="button" disabled={busy}
          onClick={() => void call("upsert-provider", { id: saved.id, baseUrl: baseUrl.trim(), model: model.trim() })}
          className="px-3 py-1.5 bg-brand-indigo/10 text-brand-indigo hover:bg-brand-indigo/20 font-bold text-[11px] rounded-lg cursor-pointer border-0 disabled:opacity-40">
          Save URL / model (keys kept)
        </button>
      )}
      <div className="space-y-1">
        {Array.from({ length: saved.keys }).map((_, i) => (
          <div key={i} className="flex items-center gap-2">
            <p className="text-[11px] font-mono text-[var(--text-secondary)] flex-1">Key {i + 1} <span className="text-[var(--text-tertiary)]">•••••••• (stored, hidden)</span></p>
            <button type="button" disabled={busy}
              onClick={() => void call("remove-key", { id: saved.id, index: i })}
              className="px-2 py-1 text-[10px] font-bold rounded-md cursor-pointer border border-[var(--border-card)] bg-transparent text-[var(--text-secondary)] disabled:opacity-40">
              Remove
            </button>
          </div>
        ))}
        <div className="flex items-center gap-2 pt-1">
          <input value={newKeys} disabled={busy} onChange={(e) => setNewKeys(e.target.value)} spellCheck={false}
            placeholder="Paste new keys, comma-separated…"
            className="flex-1 px-3 py-2 bg-[var(--bg-input)] border border-dashed border-[var(--border-card)] rounded-lg outline-none focus:border-brand-indigo text-[11px] font-mono text-[var(--text-primary)] disabled:opacity-50" />
          <button type="button" disabled={busy || newKeys.trim() === ""}
            onClick={() => {
              const keys = newKeys.split(",").map((k) => k.trim()).filter(Boolean).map((k) => ({ key: k }));
              setNewKeys("");
              void call("add-keys", { id: saved.id, keys });
            }}
            className="px-3 py-2 bg-brand-indigo/10 text-brand-indigo hover:bg-brand-indigo/20 font-bold text-[11px] rounded-lg cursor-pointer border-0 disabled:opacity-40">
            Add keys
          </button>
        </div>
      </div>
    </div>
  );
}

function NewProviderForm({ busy, existing, call }: {
  busy: boolean; existing: string[];
  call: (action: "upsert-provider" | "add-keys" | "remove-key" | "delete-provider", payload: Record<string, unknown>) => Promise<void>;
}) {
  const [id, setId] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [keys, setKeys] = useState("");
  const valid = id.trim() !== "" && !existing.some((e) => e.toLowerCase() === id.trim().toLowerCase())
    && baseUrl.trim() !== "" && model.trim() !== "";
  const inputCls = "px-3 py-2 bg-[var(--bg-input)] border border-[var(--border-card)] rounded-lg outline-none focus:border-brand-indigo text-[11px] font-mono text-[var(--text-primary)] disabled:opacity-50 w-full";
  return (
    <div className="rounded-lg border border-dashed border-[var(--border-card)] p-3 space-y-2">
      <p className="text-xs font-extrabold text-[var(--text-primary)]">Add provider</p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <label className="block">
          <span className="text-[10px] font-bold text-[var(--text-tertiary)]">ID</span>
          <input value={id} disabled={busy} onChange={(e) => setId(e.target.value)} spellCheck={false} placeholder="my-free-1" className={inputCls} />
        </label>
        <label className="block">
          <span className="text-[10px] font-bold text-[var(--text-tertiary)]">Base URL</span>
          <input value={baseUrl} disabled={busy} onChange={(e) => setBaseUrl(e.target.value)} spellCheck={false} placeholder="https://.../v1" className={inputCls} />
        </label>
        <label className="block">
          <span className="text-[10px] font-bold text-[var(--text-tertiary)]">Model</span>
          <input value={model} disabled={busy} onChange={(e) => setModel(e.target.value)} spellCheck={false} placeholder="org/model" className={inputCls} />
        </label>
      </div>
      <input value={keys} disabled={busy} onChange={(e) => setKeys(e.target.value)} spellCheck={false}
        placeholder="API keys, comma-separated (1–10)…"
        className={inputCls} />
      <button type="button" disabled={busy || !valid || keys.trim() === ""}
        onClick={() => {
          const payload = {
            id: id.trim(), baseUrl: baseUrl.trim(), model: model.trim(),
            keys: keys.split(",").map((k) => k.trim()).filter(Boolean).map((k) => ({ key: k })),
          };
          setId(""); setBaseUrl(""); setModel(""); setKeys("");
          // Single atomic call: create provider + fill keys together.
          void call("upsert-provider", payload);
        }}
        className="px-3 py-2 bg-brand-indigo text-white font-bold text-[11px] rounded-lg cursor-pointer border-0 disabled:opacity-40">
        Add provider + keys
      </button>
    </div>
  );
}
