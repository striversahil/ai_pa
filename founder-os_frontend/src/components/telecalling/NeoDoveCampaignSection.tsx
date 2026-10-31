'use client';

// NeoDoveCampaignSection — Controller tab: push a region+state's customer
// master rows into a NeoDove agent campaign.
//
// Flow: pick region → pick state → pick who receives it (one agent, or the
// region's pair split evenly) → review the exact per-agent roster → confirm →
// (live) the client loops the chunk endpoint with a progress bar; the worker
// cron finishes anything a closed tab leaves behind.
//
// Server rules (do not duplicate here):
//   - selection, phone normalization, dedupe and agent assignment live in the
//     worker. The UI only renders the counts the server returns, so the preview
//     can never disagree with what actually sends.
//   - `liveEnabled=false` means every push is a dry run regardless of the label
//   - campaign URLs are never returned; only the host shows on history rows

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, Send, ShieldAlert, XCircle } from 'lucide-react';
import {
  REGION_CODES, SKIP_LABELS, agentSplitLabel, batchDistributionLabel, batchOutcome, batchPct,
  distributionOptions, distributionSummary, formatStamp,
  type CampaignPreview, type CampaignStatesPayload, type Distribution, type PushBatch,
  type PushProgress,
} from '@/telecalling/neodove-campaign';

interface Props {
  /** The Controller is already manager-gated upstream; kept explicit for clarity. */
  canManage: boolean;
}

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as any)?.error || `Request failed (${res.status})`);
  return body as T;
}

export default function NeoDoveCampaignSection({ canManage }: Props) {
  const [region, setRegion] = useState<string>('R1');
  const [states, setStates] = useState<CampaignStatesPayload | null>(null);
  const [stateName, setStateName] = useState<string>('');
  const [distribution, setDistribution] = useState<Distribution>('split');
  const [agentKey, setAgentKey] = useState<string>('');
  const [preview, setPreview] = useState<CampaignPreview | null>(null);
  const [batch, setBatch] = useState<PushBatch | null>(null);
  const [progress, setProgress] = useState<PushProgress | null>(null);
  const [history, setHistory] = useState<PushBatch[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [loadingStates, setLoadingStates] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const cancelled = useRef(false);

  useEffect(() => () => { cancelled.current = true; }, []);

  const loadStates = useCallback(async (code: string) => {
    setLoadingStates(true);
    setError(null);
    try {
      const payload = await jsonFetch<CampaignStatesPayload>(
        `/api/neodove/campaign/states?region=${encodeURIComponent(code)}`,
      );
      if (cancelled.current) return;
      setStates(payload);
      setStateName((prev) => (payload.states.some((s) => s.state === prev) ? prev : ''));
      // Drop an agent choice that does not belong to this region.
      setAgentKey((prev) => (payload.agents.some((a) => a.key === prev) ? prev : ''));
      setDistribution((prev) => (prev === 'single' && !payload.agents.length ? 'split' : prev));
    } catch (e: any) {
      if (!cancelled.current) setError(e?.message ?? 'Failed to load states');
    } finally {
      if (!cancelled.current) setLoadingStates(false);
    }
  }, []);

  const loadHistory = useCallback(async (code: string) => {
    try {
      const payload = await jsonFetch<{ batches: PushBatch[] }>(
        `/api/neodove/campaign/batches?region=${encodeURIComponent(code)}&limit=10`,
      );
      if (!cancelled.current) setHistory(payload.batches ?? []);
    } catch {
      if (!cancelled.current) setHistory([]);
    }
  }, []);

  useEffect(() => {
    void loadStates(region);
    void loadHistory(region);
  }, [region, loadStates, loadHistory]);

  const options = useMemo(
    () => distributionOptions(states?.agents ?? [], stateName),
    [states, stateName],
  );

  // Keep the selection valid whenever the region's agent list changes.
  useEffect(() => {
    if (options.length === 0) return;
    const stillValid = options.some(
      (o) => !o.disabled && o.distribution === distribution && o.agentKey === agentKey,
    );
    if (!stillValid) {
      const fallback = options.find((o) => !o.disabled) ?? options[0];
      setDistribution(fallback.distribution);
      setAgentKey(fallback.agentKey);
    }
  }, [options, distribution, agentKey]);

  useEffect(() => {
    setPreview(null);
    setConfirming(false);
    setBatch(null);
    setProgress(null);
    if (!stateName) return;
    let alive = true;
    setLoadingPreview(true);
    setError(null);
    const params = new URLSearchParams({ region, state: stateName, distribution });
    if (distribution === 'single' && agentKey) params.set('agent', agentKey);
    jsonFetch<{ preview: CampaignPreview }>(`/api/neodove/campaign/preview?${params.toString()}`)
      .then((r) => { if (alive) setPreview(r.preview); })
      .catch((e: any) => { if (alive) setError(e?.message ?? 'Failed to preview'); })
      .finally(() => { if (alive) setLoadingPreview(false); });
    return () => { alive = false; };
  }, [region, stateName, distribution, agentKey]);

  const selectedState = useMemo(
    () => states?.states.find((s) => s.state === stateName) ?? null,
    [states, stateName],
  );

  const selectedOption = useMemo(
    () => options.find((o) => o.distribution === distribution && o.agentKey === agentKey) ?? null,
    [options, distribution, agentKey],
  );

  const chooseOption = useCallback((optionId: string) => {
    const option = options.find((o) => o.id === optionId);
    if (!option) return;
    setDistribution(option.distribution);
    setAgentKey(option.agentKey);
    setConfirming(false);
  }, [options]);

  const runRemaining = useCallback(async (batchId: string) => {
    // Serial chunk loop — the server caps each call at 25 leads. Bounded so a
    // pathological batch can never spin forever in one tab.
    for (let i = 0; i < 400; i++) {
      const r = await jsonFetch<{ progress: PushProgress }>(
        `/api/neodove/campaign/push/${encodeURIComponent(batchId)}/run`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chunk: 20 }) },
      );
      if (cancelled.current) return r.progress;
      setProgress(r.progress);
      setBatch(r.progress);
      if (r.progress.complete) return r.progress;
    }
    return null;
  }, []);

  const doPush = useCallback(async () => {
    if (!canManage || !stateName || pushing) return;
    setPushing(true);
    setError(null);
    setNotice(null);
    setConfirming(false);
    try {
      const created = await jsonFetch<{ batch: PushBatch }>('/api/neodove/campaign/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ region, state: stateName, distribution, agentKey }),
      });
      setBatch(created.batch);
      if (created.batch.mode === 'dry-run') {
        setNotice(
          `Dry run recorded: ${created.batch.planned} leads validated, nothing was sent. ` +
          'Switch on live sending to push for real.',
        );
      } else {
        const done = await runRemaining(created.batch.id);
        if (done) {
          setNotice(
            done.failed > 0
              ? `Finished with ${done.failed} failure${done.failed === 1 ? '' : 's'} — see the list below.`
              : `Sent ${done.sent} leads to NeoDove.`,
          );
        }
      }
      void loadHistory(region);
      void loadStates(region);
    } catch (e: any) {
      if (!cancelled.current) setError(e?.message ?? 'Push failed');
    } finally {
      if (!cancelled.current) setPushing(false);
    }
  }, [canManage, stateName, pushing, region, distribution, agentKey, runRemaining, loadHistory, loadStates]);

  if (!canManage) return null;

  const liveOn = states?.liveEnabled ?? false;
  const configured = states?.configured ?? false;
  const agents = states?.agents ?? [];
  const activeBatch = progress ?? batch;

  return (
    <section className="bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-lg font-bold flex items-center gap-2">
            <Send className="w-4 h-4 text-indigo-500" />
            NeoDove campaign
          </h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            Push a region&apos;s customers, state by state, into the live NeoDove calling campaign —
            to one agent, or split across the region&apos;s pair.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wide ${
            liveOn
              ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
              : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
          }`}>
            {liveOn ? 'Live sending on' : 'Dry-run mode'}
          </span>
          <button
            type="button"
            onClick={() => { void loadStates(region); void loadHistory(region); }}
            className="p-1.5 rounded-lg text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-800"
            title="Refresh states and history"
          >
            <RefreshCw className={`w-4 h-4 ${loadingStates ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Region strip */}
      <div className="flex flex-wrap items-center gap-1.5">
        {REGION_CODES.map((code) => (
          <button
            key={code}
            type="button"
            onClick={() => { setRegion(code); setStateName(''); setAgentKey(''); setDistribution('split'); }}
            className={`px-3 py-1.5 text-xs font-bold rounded-lg border transition-colors ${
              region === code
                ? 'bg-indigo-600 text-white border-indigo-600'
                : 'bg-white dark:bg-zinc-950 border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-300 hover:border-indigo-400'
            }`}
          >
            {code}
          </button>
        ))}
        <span className="ml-1 text-[11px] text-zinc-500 dark:text-zinc-400">
          {agents.length === 0
            ? `No agents registered for ${region}`
            : `${agents.filter((a) => a.configured).length}/${agents.length} agent URLs configured`}
        </span>
        {!configured && agents.length > 0 && (
          <span className="text-[11px] text-amber-600 dark:text-amber-400">
            · pushes blocked until every agent has a URL
          </span>
        )}
      </div>

      {/* Agent URL mapping — paste a URL or a full curl command per agent */}
      <div className="space-y-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
          Agent campaign URLs
        </span>
        <div className="flex flex-col gap-1.5">
          {agents.map((agent) => (
            <AgentUrlRow
              key={agent.key}
              agentKey={agent.key}
              name={agent.name}
              configured={agent.configured}
              source={agent.source}
              onSaved={() => { void loadStates(region); }}
              onError={setError}
            />
          ))}
          {agents.length === 0 && (
            <p className="text-[11px] text-zinc-500">No agents registered for {region}.</p>
          )}
        </div>
      </div>

      {/* State picker */}
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-[220px] flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">State</span>
          <select
            value={stateName}
            onChange={(e) => { setStateName(e.target.value); setConfirming(false); }}
            disabled={loadingStates}
            className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3 py-2 text-sm"
          >
            <option value="">{loadingStates ? 'Loading states…' : `Select a state in ${region}`}</option>
            {(states?.states ?? []).map((s) => (
              <option key={s.state} value={s.state}>
                {s.state} — {s.withPhone} with phone
              </option>
            ))}
          </select>
        </label>

        {selectedState && (
          <p className="text-[11px] text-zinc-500 dark:text-zinc-400 pb-2">
            {selectedState.total} customers in {selectedState.state}
            {selectedState.lastPushedAt
              ? ` · last live push ${formatStamp(selectedState.lastPushedAt)} (${selectedState.lastPushedCount} sent)`
              : ' · never pushed'}
          </p>
        )}
      </div>

      {/* Who receives it */}
      {stateName && options.length > 0 && (
        <div className="space-y-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
            Assign to
          </span>
          <div className="flex flex-col gap-1.5">
            {options.map((option) => {
              const selected = option.distribution === distribution && option.agentKey === agentKey;
              return (
                <label
                  key={option.id}
                  className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs transition-colors ${
                    option.disabled
                      ? 'border-zinc-200 dark:border-zinc-800 opacity-50 cursor-not-allowed'
                      : selected
                        ? 'border-indigo-500 bg-indigo-500/5 cursor-pointer'
                        : 'border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 hover:border-indigo-400 cursor-pointer'
                  }`}
                >
                  <input
                    type="radio"
                    name="neodove-distribution"
                    className="mt-0.5"
                    checked={selected}
                    disabled={option.disabled || pushing}
                    onChange={() => chooseOption(option.id)}
                  />
                  <span className="flex-1">
                    <span className="font-semibold block">{option.label}</span>
                    <span className="text-[11px] text-zinc-500 dark:text-zinc-400">{option.hint}</span>
                  </span>
                  {selected && preview && !loadingPreview && (
                    <span className="font-mono text-[11px] text-indigo-600 dark:text-indigo-400 shrink-0">
                      {agentSplitLabel(preview.agents)}
                    </span>
                  )}
                </label>
              );
            })}
          </div>
        </div>
      )}

      {error && (
        <p className="rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-600 dark:text-rose-400">
          {error}
        </p>
      )}
      {notice && (
        <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-400">
          {notice}
        </p>
      )}

      {/* Preview */}
      {stateName && (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-4 space-y-3">
          {loadingPreview ? (
            <p className="text-xs text-zinc-500">Resolving leads…</p>
          ) : preview ? (
            <>
              <div className="flex flex-wrap items-center gap-4">
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-zinc-500">Ready to send</p>
                  <p className="text-2xl font-bold font-mono">{preview.ready}</p>
                </div>
                {preview.agents.map((agent) => (
                  <div key={agent.key}>
                    <p className="text-[10px] uppercase tracking-wide text-zinc-500">{agent.name}</p>
                    <p className="text-sm font-semibold font-mono">
                      {agent.planned}
                      {!agent.configured && (
                        <span className="ml-1 text-[10px] font-normal text-amber-600 dark:text-amber-400">no URL</span>
                      )}
                    </p>
                  </div>
                ))}
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-zinc-500">Skipped</p>
                  <p className="text-sm font-semibold font-mono">{preview.skipped.length}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-zinc-500">detail1 / detail2</p>
                  <p className="text-sm font-semibold">{preview.detail1} / {preview.detail2}</p>
                </div>
              </div>

              {preview.skipped.length > 0 && (
                <details className="text-[11px]">
                  <summary className="cursor-pointer text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">
                    Why {preview.skipped.length} row{preview.skipped.length === 1 ? '' : 's'} will be skipped
                  </summary>
                  <ul className="mt-2 space-y-1 max-h-32 overflow-auto">
                    {preview.skipped.slice(0, 30).map((s) => (
                      <li key={s.customerId} className="flex justify-between gap-3">
                        <span className="truncate">{s.name}</span>
                        <span className="text-zinc-500 shrink-0">{SKIP_LABELS[s.reason] ?? s.reason}</span>
                      </li>
                    ))}
                  </ul>
                  {preview.skipped.length > 30 && (
                    <p className="mt-1 text-zinc-500">+{preview.skipped.length - 30} more…</p>
                  )}
                </details>
              )}

              {preview.sample.length > 0 && (
                <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
                  <table className="w-full text-[11px]">
                    <thead className="bg-zinc-50 dark:bg-zinc-900 text-zinc-500">
                      <tr>
                        <th className="text-left font-semibold px-2 py-1">Name</th>
                        <th className="text-left font-semibold px-2 py-1">Mobile</th>
                        <th className="text-left font-semibold px-2 py-1">Email</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.sample.map((row, i) => (
                        <tr key={`${row.mobileMasked}-${i}`} className="border-t border-zinc-100 dark:border-zinc-800">
                          <td className="px-2 py-1 truncate max-w-[220px]">{row.name}</td>
                          <td className="px-2 py-1 font-mono">{row.mobileMasked}</td>
                          <td className="px-2 py-1 truncate max-w-[200px] text-zinc-500">{row.email || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {!preview.configured ? (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  At least one agent in {preview.region} has no campaign URL — the push is blocked until
                  every participating agent is configured.
                </p>
              ) : confirming ? (
                <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-3 space-y-2">
                  <p className="text-xs text-rose-700 dark:text-rose-300 flex items-start gap-2">
                    <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0" />
                    <span>
                      This sends <b>{preview.ready} leads</b> {distributionSummary(preview.distribution, preview.agents)}
                      {' '}in the live {preview.region} campaign
                      {selectedState?.lastPushedAt
                        ? ` — ${selectedState.state} was already pushed on ${formatStamp(selectedState.lastPushedAt)} and will be duplicated.`
                        : '.'}
                    </span>
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => void doPush()}
                      disabled={pushing}
                      className="px-3 py-1.5 text-xs rounded-lg font-bold text-white bg-rose-600 hover:bg-rose-500 disabled:opacity-50"
                    >
                      {pushing ? 'Working…' : `Yes, push ${preview.ready} leads`}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirming(false)}
                      className="px-3 py-1.5 text-xs rounded-lg font-semibold bg-zinc-100 dark:bg-zinc-800"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirming(true)}
                    disabled={pushing || preview.ready === 0 || selectedOption?.disabled}
                    className="inline-flex items-center gap-2 px-4 py-2 text-xs rounded-lg font-bold text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50"
                  >
                    <Send className="w-3.5 h-3.5" />
                    {preview.liveEnabled ? `Push ${preview.ready} leads` : `Dry run ${preview.ready} leads`}
                  </button>
                  {!preview.liveEnabled && (
                    <span className="text-[11px] text-amber-600 dark:text-amber-400">
                      Live sending is off — this records the batch without contacting NeoDove.
                    </span>
                  )}
                </div>
              )}
            </>
          ) : (
            <p className="text-xs text-zinc-500">Select a state to see the lead roster.</p>
          )}
        </div>
      )}

      {/* Progress */}
      {activeBatch && activeBatch.mode === 'live' && (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-4 space-y-2">
          <div className="flex items-center justify-between text-[11px] font-semibold">
            <span>{activeBatch.state} · {activeBatch.status}</span>
            <span className="font-mono">
              {`${activeBatch.sent} sent · ${activeBatch.failed} failed · ${activeBatch.pending} left`}
            </span>
          </div>
          <div className="h-2 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
            <div className="h-full bg-indigo-500 transition-all" style={{ width: `${batchPct(activeBatch)}%` }} />
          </div>
          {progress && progress.agentTallies.length > 0 && (
            <div className="flex flex-wrap gap-3 text-[11px] text-zinc-600 dark:text-zinc-300">
              {progress.agentTallies.map((tally) => (
                <span key={tally.agentKey} className="font-mono">
                  {tally.name || tally.agentKey}: {tally.sent}/{tally.planned}
                </span>
              ))}
            </div>
          )}
          {progress && progress.failures.length > 0 && (
            <details className="text-[11px]" open>
              <summary className="cursor-pointer text-rose-600 dark:text-rose-400 flex items-center gap-1">
                <XCircle className="w-3.5 h-3.5" />
                {progress.failures.length} failed lead{progress.failures.length === 1 ? '' : 's'}
              </summary>
              <ul className="mt-1 space-y-1 max-h-32 overflow-auto">
                {progress.failures.map((f, i) => (
                  <li key={`${f.mobileMasked}-${i}`} className="flex justify-between gap-2">
                    <span className="truncate">{f.name} · {f.mobileMasked}</span>
                    <span className="text-zinc-500 shrink-0">
                      {f.httpStatus ? `HTTP ${f.httpStatus}` : 'network'} {f.error ? `— ${f.error}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {/* History */}
      <div>
        <h4 className="text-xs font-bold uppercase tracking-wide text-zinc-500 mb-2">Recent pushes · {region}</h4>
        {history.length === 0 ? (
          <p className="text-[11px] text-zinc-500">No pushes for {region} yet.</p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-[11px]">
              <thead className="bg-zinc-50 dark:bg-zinc-900 text-zinc-500">
                <tr>
                  <th className="text-left font-semibold px-2 py-1">When</th>
                  <th className="text-left font-semibold px-2 py-1">State</th>
                  <th className="text-left font-semibold px-2 py-1">Mode</th>
                  <th className="text-left font-semibold px-2 py-1">Assign</th>
                  <th className="text-left font-semibold px-2 py-1">Result</th>
                  <th className="text-left font-semibold px-2 py-1">By</th>
                </tr>
              </thead>
              <tbody>
                {history.map((row) => (
                  <tr key={row.id} className="border-t border-zinc-100 dark:border-zinc-800">
                    <td className="px-2 py-1 text-zinc-500">{formatStamp(row.createdAt)}</td>
                    <td className="px-2 py-1 font-semibold">{row.state}</td>
                    <td className="px-2 py-1">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                        row.mode === 'live'
                          ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                          : 'bg-zinc-500/10 text-zinc-500'
                      }`}>
                        {row.mode}
                      </span>
                    </td>
                    <td className="px-2 py-1 text-zinc-500">{batchDistributionLabel(row)}</td>
                    <td className="px-2 py-1">{batchOutcome(row)}</td>
                    <td className="px-2 py-1 text-zinc-500 truncate max-w-[140px]">{row.requestedByName || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * Per-agent campaign URL row. Paste a bare URL or a full curl command — the
 * server extracts and validates it (https NeoDove custom-integration only).
 * The URL itself is never displayed back: only configured/not + which value
 * wins (Controller-mapped vs Worker secret).
 */
function AgentUrlRow({
  agentKey, name, configured, source, onSaved, onError,
}: {
  agentKey: string;
  name: string;
  configured: boolean;
  source: string;
  onSaved: () => void;
  onError: (e: string | null) => void;
}) {
  const [value, setValue] = useState('');
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const save = async (raw: string) => {
    setSaving(true);
    onError(null);
    try {
      const res = await fetch(
        `/api/neodove/campaign/agents/${encodeURIComponent(agentKey)}/url`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: raw }),
        },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || `Save failed (${res.status})`);
      setValue('');
      setOpen(false);
      onSaved();
    } catch (e: any) {
      onError(e?.message ?? 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3 py-2 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-semibold truncate">{name}</span>
          <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wide shrink-0 ${
            configured
              ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
              : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
          }`}>
            {configured ? `mapped · ${source === 'db' ? 'controller' : 'secret'}` : 'no URL'}
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {configured && source === 'db' && (
            <button
              type="button"
              onClick={() => void save('')}
              disabled={saving}
              title="Clear the Controller mapping (Worker secret takes over)"
              className="text-[11px] font-semibold text-zinc-500 hover:text-rose-500 disabled:opacity-50"
            >
              Clear
            </button>
          )}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 hover:underline"
          >
            {open ? 'Cancel' : configured ? 'Replace' : 'Map URL'}
          </button>
        </div>
      </div>
      {open && (
        <div className="flex flex-col gap-1.5">
          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Paste the campaign URL or the full curl command here"
            rows={3}
            spellCheck={false}
            className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-2 py-1.5 text-[11px] font-mono"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void save(value)}
              disabled={saving || !value.trim()}
              className="px-3 py-1 text-[11px] rounded-lg font-bold text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save URL'}
            </button>
            <span className="text-[10px] text-zinc-500">https NeoDove integration URL only — anything else is rejected.</span>
          </div>
        </div>
      )}
    </div>
  );
}
