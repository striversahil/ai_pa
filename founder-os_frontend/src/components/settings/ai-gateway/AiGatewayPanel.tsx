"use client";

import { useEffect, useState } from "react";
import { useAiGateway } from "@/hooks/useAiGateway";
import { saveHealthPolicy } from "@/ai-gateway/api";
import type { AiHealthConfig } from "@/ai-gateway/types";
import { ProviderCard } from "./ProviderCard";
import { NewProviderForm } from "./NewProviderForm";
import { PlaygroundPanel } from "./PlaygroundPanel";

/** Settings → AI gateway: live pool, provider/key switches, health and the
 *  pinned-key playground. Root-only by virtue of where it is mounted. */
export function AiGatewayPanel() {
  const { data, loading, error, refresh } = useAiGateway();
  const [localError, setLocalError] = useState<string | null>(null);

  const providers = data?.config?.providers ?? [];
  const cfg = data?.config?.health;
  const [draft, setDraft] = useState<AiHealthConfig | null>(null);
  useEffect(() => { if (cfg && !draft) setDraft(cfg); }, [cfg, draft]);
  const runtime = new Map((data?.providers ?? []).map((p) => [p.provider, p]));

  return (
    <div className="space-y-3">
      {loading && !data && <p className="text-xs text-[var(--text-tertiary)]">Loading gateway…</p>}
      {!!error && !data && <p className="text-xs font-bold text-red-500">Failed to load the AI gateway.</p>}
      {localError && <p className="text-xs font-bold text-red-500">{localError}</p>}

      {data && (
        <>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--text-tertiary)]">
            <span>Pool: <b className="text-[var(--text-secondary)]">{data.keys} keys</b> (this isolate)</span>
            <span>Strategy: <b className="text-[var(--text-secondary)]">{data.strategy}</b></span>
            {data.providers.map((p) => (
              <span key={p.provider} className="font-mono">{p.provider} {p.usable}/{p.total}</span>
            ))}
            {cfg && (
              <span>
                auto-disable &lt; <b className="text-[var(--text-secondary)]">{cfg.threshold}</b>
                {" · "}at risk &lt; {cfg.atRisk}
                {" · "}min {cfg.minSamples} calls
              </span>
            )}
            {cfg && !cfg.autoDisable && (
              <span className="font-bold text-amber-600 dark:text-amber-400">observe only (auto-disable off)</span>
            )}
          </div>

          {providers.length === 0 && (
            <p className="text-[11px] text-[var(--text-tertiary)]">
              No custom providers yet — add one below. Until then the pool serves from server env keys only.
            </p>
          )}
          {providers.map((p) => (
            <ProviderCard
              key={`${p.id}|${p.baseUrl}|${p.model}`}
              provider={p}
              runtime={runtime.get(p.id)}
              cfg={cfg}
              onChanged={refresh}
              onError={setLocalError}
            />
          ))}

          <NewProviderForm
            existing={providers.map((p) => p.id)}
            onChanged={refresh}
            onError={setLocalError}
          />

          <HealthPolicy cfg={cfg} draft={draft} setDraft={setDraft} refresh={refresh} onError={setLocalError} />

          <PlaygroundPanel providers={providers} />
        </>
      )}
    </div>
  );
}

/** Thresholds (Setting ai:health). Defaults 40 / 60 / 5 samples; autoDisable
 *  can be turned off to observe scores without ever disabling a key. */
function HealthPolicy({ cfg, draft, setDraft, refresh, onError }: {
  cfg?: AiHealthConfig;
  draft: AiHealthConfig | null;
  setDraft: (v: AiHealthConfig | null) => void;
  refresh: () => void;
  onError: (m: string | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  if (!cfg || !draft) return null;
  const num = (v: string, fallback: number) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
  const field = (label: string, key: keyof AiHealthConfig, min: number, max: number, hint: string) => (
    <label className="block">
      <span className="text-[10px] font-bold text-[var(--text-tertiary)]">{label}</span>
      <input type="number" min={min} max={max} value={String(draft[key])} disabled={busy}
        onChange={(e) => setDraft({ ...draft, [key]: num(e.target.value, Number(draft[key])) })}
        className="px-2 py-1.5 bg-[var(--bg-input)] border border-[var(--border-card)] rounded-lg outline-none focus:border-brand-indigo text-[11px] font-mono text-[var(--text-primary)] w-full" />
      <span className="text-[9px] text-[var(--text-tertiary)]">{hint}</span>
    </label>
  );

  const save = async () => {
    setBusy(true); onError(null);
    try {
      const next = {
        ...draft,
        atRisk: Math.max(draft.atRisk, draft.threshold + 1),
        ttftBadMs: Math.max(draft.ttftBadMs, draft.ttftGoodMs + 100),
      };
      await saveHealthPolicy(next);
      setDraft(next);
      refresh();
    } catch (e: any) { onError(e?.message ?? "Save failed"); }
    finally { setBusy(false); }
  };

  return (
    <details className="rounded-lg border border-[var(--border-card)] p-3">
      <summary className="text-xs font-extrabold text-[var(--text-primary)] cursor-pointer">
        Health policy — disable below {cfg.threshold}, at risk below {cfg.atRisk}
        {!cfg.autoDisable && <span className="ml-2 text-amber-600 dark:text-amber-400">observe only</span>}
      </summary>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3">
        {field("Disable below", "threshold", 1, 99, "score 0–100")}
        {field("At risk below", "atRisk", 2, 100, "warning band")}
        {field("Min samples", "minSamples", 1, 200, "24 h calls")}
        {field("TPS target", "tpsTarget", 1, 500, "full throughput")}
        {field("TTFT good (ms)", "ttftGoodMs", 50, 30000, "full speed score")}
        {field("TTFT bad (ms)", "ttftBadMs", 100, 60000, "zero speed score")}
        <label className="flex items-center gap-2 text-[11px] font-bold text-[var(--text-primary)] self-end pb-1">
          <input type="checkbox" checked={draft.autoDisable} disabled={busy}
            onChange={(e) => setDraft({ ...draft, autoDisable: e.target.checked })} />
          Auto-disable
        </label>
        <button type="button" disabled={busy} onClick={() => void save()}
          className="self-end px-3 py-2 bg-brand-indigo text-white font-bold text-[11px] rounded-lg cursor-pointer border-0 disabled:opacity-40">
          Save policy
        </button>
      </div>
      <p className="text-[10px] text-[var(--text-tertiary)] mt-2">
        Score = 50% reliability + 30% first-token speed + 20% throughput, over the last 24 h (50 calls/key,
        playground probes excluded). Manual re-enable never auto-recovers.
      </p>
    </details>
  );
}
