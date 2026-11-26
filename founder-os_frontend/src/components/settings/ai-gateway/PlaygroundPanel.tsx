"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { AiProviderInfo, ProbeMetrics } from "@/ai-gateway/types";
import { streamProbe } from "@/ai-gateway/api";
import { fmtMs, fmtTps } from "@/ai-gateway/metrics";

const INPUT = "px-3 py-2 bg-[var(--bg-input)] border border-[var(--border-card)] rounded-lg outline-none focus:border-brand-indigo text-[11px] text-[var(--text-primary)] disabled:opacity-50";

/** Live key probe: pinned key, streamed answer, TTFT / latency / TPS metrics.
 *  Transcript stays in this component (client-only) — nothing is persisted. */
export function PlaygroundPanel({ providers }: { providers: AiProviderInfo[] }) {
  const options = useMemo(
    () => providers.flatMap((p) => p.keys.map((k) => ({
      provider: p, key: k,
      label: `${p.id} · ${k.label?.trim() || k.last4}${k.enabled ? "" : " (disabled)"}`,
    }))),
    [providers],
  );
  const [selectedId, setSelectedId] = useState("");
  const [prompt, setPrompt] = useState("Reply with exactly: hello from the gateway.");
  const [system, setSystem] = useState("");
  const [maxTokens, setMaxTokens] = useState(256);
  const [output, setOutput] = useState("");
  const [metrics, setMetrics] = useState<ProbeMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [firstTokenMs, setFirstTokenMs] = useState<number | null>(null);
  const startedAt = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (options.length === 0) { setSelectedId(""); return; }
    if (!options.some((o) => o.key.id === selectedId)) setSelectedId(options[0].key.id);
  }, [options, selectedId]);

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setElapsed(Date.now() - startedAt.current), 100);
    return () => clearInterval(t);
  }, [running]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const selected = options.find((o) => o.key.id === selectedId);
  const canRun = !!selected && prompt.trim() !== "" && !running;
  // Live throughput estimate while tokens arrive (~4 chars/token); the server's
  // exact usage-based TPS replaces it on done.
  const liveTps = running && firstTokenMs != null && elapsed > firstTokenMs
    ? (output.length / 4) / ((elapsed - firstTokenMs) / 1000)
    : null;

  const run = async () => {
    if (!selected) return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setRunning(true); setError(null); setOutput(""); setMetrics(null);
    setFirstTokenMs(null); setElapsed(0);
    startedAt.current = Date.now();
    let ttft: number | null = null;
    try {
      await streamProbe(
        {
          provider: selected.provider.id, keyId: selected.key.id,
          prompt: prompt.trim(), system: system.trim() || undefined, maxTokens,
        },
        {
          onDelta: (text) => {
            if (ttft == null) { ttft = Date.now() - startedAt.current; setFirstTokenMs(ttft); }
            setOutput((prev) => prev + text);
          },
          onDone: (result) => { setOutput(result.content); setMetrics(result.metrics); },
          onError: (message) => setError(message),
        },
        ctrl.signal,
      );
    } catch (e: any) {
      if (e?.name !== "AbortError") setError(e?.message ?? "Probe failed");
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  };

  return (
    <div className="rounded-lg border border-[var(--border-card)] p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs font-extrabold text-[var(--text-primary)] flex-1">Test a key (live)</p>
        <span className="text-[10px] text-[var(--text-tertiary)]">pinned key · streamed · not saved</span>
      </div>

      {options.length === 0 ? (
        <p className="text-[11px] text-[var(--text-tertiary)]">Add at least one key above to run a probe.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <select value={selectedId} disabled={running} onChange={(e) => setSelectedId(e.target.value)}
              className={`${INPUT} flex-1 min-w-[14rem]`}>
              {options.map((o) => <option key={o.key.id} value={o.key.id}>{o.label}</option>)}
            </select>
            <label className="flex items-center gap-1 text-[10px] text-[var(--text-tertiary)]">
              max tokens
              <input type="number" min={1} max={1024} value={maxTokens} disabled={running}
                onChange={(e) => setMaxTokens(Math.max(1, Math.min(1024, Number(e.target.value) || 256)))}
                className={`${INPUT} w-20`} />
            </label>
            {running ? (
              <button type="button" onClick={() => abortRef.current?.abort()}
                className="px-3 py-2 bg-red-500/10 text-red-500 font-bold text-[11px] rounded-lg cursor-pointer border-0">
                Stop
              </button>
            ) : (
              <button type="button" disabled={!canRun} onClick={() => void run()}
                className="px-3 py-2 bg-brand-indigo text-white font-bold text-[11px] rounded-lg cursor-pointer border-0 disabled:opacity-40">
                Run probe
              </button>
            )}
          </div>

          {selected && !selected.key.enabled && (
            <p className="text-[10px] font-bold text-amber-600 dark:text-amber-400">
              This key is currently disabled — the probe still calls the provider once, but it stays out of the pool.
            </p>
          )}

          <input value={system} disabled={running} onChange={(e) => setSystem(e.target.value)} spellCheck={false}
            placeholder="Optional system prompt…" className={`${INPUT} w-full`} />
          <textarea value={prompt} disabled={running} onChange={(e) => setPrompt(e.target.value)} rows={3}
            className={`${INPUT} w-full resize-y font-mono`} />

          <div className="flex flex-wrap gap-2 text-[10px] font-mono">
            <Chip label="TTFT" value={fmtMs(metrics?.ttftMs ?? firstTokenMs)} running={running && firstTokenMs == null} />
            <Chip label="Latency" value={fmtMs(metrics?.latencyMs ?? (running ? elapsed : null))} running={running} />
            <Chip label="TPS" value={metrics?.tps != null ? fmtTps(metrics.tps) : liveTps != null ? `~${fmtTps(liveTps)}` : "—"} running={running} />
            <Chip label="Tokens" value={metrics ? String(metrics.completionTokens) : "—"} running={running} />
          </div>

          {error && <p className="text-[11px] font-bold text-red-500">{error}</p>}

          <div className="rounded-md bg-[var(--bg-input)] border border-[var(--border-card)] p-2 min-h-[3rem] max-h-64 overflow-auto">
            {output ? (
              <pre className="text-[11px] whitespace-pre-wrap break-words text-[var(--text-primary)] font-sans m-0">{output}</pre>
            ) : (
              <p className="text-[10px] text-[var(--text-tertiary)]">
                {running ? "Waiting for the first token…" : "Response appears here as it streams."}
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Chip({ label, value, running }: { label: string; value: string; running: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-md border border-[var(--border-card)] bg-[var(--bg-input)] ${running ? "animate-pulse" : ""}`}>
      <span className="text-[var(--text-tertiary)]">{label}</span>
      <span className="font-bold text-[var(--text-primary)]">{value}</span>
    </span>
  );
}
