"use client";

// Controller → Customer push: send a region's customer book into the Founder
// OS auto dialer. Pick region → state (→ district) → type, choose who receives
// it, check the exact queue, push. NeoDove is retired; only dialer pushes run.
//
// Live: a push writes DialerQueue rows, which emit `device-calls`, so the
// preview and the history refresh on their own after a push.
import { useMemo, useState } from "react";
import { Send, Users } from "lucide-react";
import { ConfirmDialog } from "@/components/ui";
import { useLiveQuery } from "@/hooks/useLiveData";
import {
  CUSTOMER_PUSH_EVENTS, REGION_CODES, customerPushApi, distributionOptions,
  formatStamp, type Distribution, type PreviewQuery, type PushBatch,
} from "@/telecalling/customer-push";
import PreviewCard from "./customer-push/PreviewCard";

/** useLiveQuery keeps `error` as unknown; render its message when it has one. */
function errText(e: unknown): string {
  return (e as any)?.message ?? "Request failed";
}
import HistoryTable from "./customer-push/HistoryTable";

export default function CustomerPushSection() {
  const [region, setRegion] = useState<string>(REGION_CODES[0]);
  const [clientType, setClientType] = useState("");
  const [state, setState] = useState("");
  const [district, setDistrict] = useState("");
  const [optionId, setOptionId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const states = useLiveQuery(
    () => customerPushApi.states(region, clientType),
    { events: CUSTOMER_PUSH_EVENTS, deps: [region, clientType] },
  );
  const districts = useLiveQuery(
    async () => (state ? customerPushApi.districts(region, state, clientType) : null),
    { events: CUSTOMER_PUSH_EVENTS, deps: [region, state, clientType] },
  );

  const agents = states.data?.agents ?? [];
  const teamLeads = states.data?.teamLeads ?? [];
  const stateName = state;
  const options = useMemo(
    () => distributionOptions(agents, teamLeads, stateName),
    [agents, teamLeads, stateName],
  );
  const option = options.find((o) => o.id === optionId) ?? options[0] ?? null;

  const query: PreviewQuery | null = state && option
    ? {
        region, state, district, clientType,
        distribution: option.distribution,
        agentKey: option.distribution === "single" ? option.agentKey : undefined,
      }
    : null;
  const preview = useLiveQuery(
    async () => (query ? customerPushApi.preview(query) : null),
    { events: CUSTOMER_PUSH_EVENTS, deps: [region, state, district, clientType, option?.id ?? ""] },
  );
  const history = useLiveQuery(
    () => customerPushApi.batches(region),
    { events: CUSTOMER_PUSH_EVENTS, deps: [region] },
  );

  const pickRegion = (code: string) => {
    setRegion(code); setState(""); setDistrict(""); setClientType(""); setNotice(null);
  };
  const pickState = (name: string) => {
    setState(name); setDistrict(""); setNotice(null);
  };
  const pickType = (value: string) => {
    setClientType(value); setDistrict(""); setNotice(null);
  };

  const doPush = async () => {
    if (!query) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const res = await customerPushApi.push(query);
      const batch: PushBatch = res.batch;
      setNotice(`Queued ${batch.sent} lead${batch.sent === 1 ? "" : "s"} to the dialer${batch.skipped ? ` · ${batch.skipped} skipped` : ""}.`);
      preview.refresh(); history.refresh();
    } catch (e: any) {
      setError(e?.message ?? "Push failed");
    } finally {
      setBusy(false);
      setConfirmOpen(false);
    }
  };

  const stateRows = states.data?.states ?? [];
  const types = states.data?.types ?? [];
  const stateDistricts = districts.data?.districts ?? [];

  return (
    <section className="space-y-5 rounded-xl border border-zinc-200 bg-zinc-50 p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-lg font-bold">
            <Send className="h-4 w-4 text-indigo-500" /> Customer push
          </h3>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            Send every customer of a state (or one district) into the agents&apos; Auto Dialer queue.
            Numbers already waiting for an agent are skipped, never repeated.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-zinc-200 bg-white p-0.5 dark:border-zinc-800 dark:bg-zinc-950">
            {REGION_CODES.map((code) => (
              <button
                key={code}
                onClick={() => pickRegion(code)}
                className={`rounded-md px-2.5 py-1 text-xs font-semibold ${region === code ? "bg-indigo-600 text-white" : "text-zinc-600 dark:text-zinc-300"}`}
              >
                {code}
              </button>
            ))}
          </div>
          <select
            aria-label="Client type"
            value={clientType}
            onChange={(e) => pickType(e.target.value)}
            className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-800 dark:bg-zinc-950"
          >
            <option value="">All client types</option>
            {types.map((t) => (
              <option key={t.base} value={t.base === "Unspecified" ? "" : t.base}>
                {t.base} ({t.withPhone})
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && <p className="rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-600 dark:text-rose-400">{error}</p>}
      {notice && <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-400">{notice}</p>}
      {states.error != null && <p className="rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-600 dark:text-rose-400">{errText(states.error)}</p>}

      {agents.length === 0 && !states.loading && (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          No telecaller is seated in {region} yet — seat them on a Sales position in the org chart above, then come back.
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <div className="space-y-2">
          <h4 className="text-xs font-bold uppercase tracking-wide text-zinc-500">States in {region}</h4>
          {states.loading && <p className="text-[11px] text-zinc-500">Loading states…</p>}
          {!states.loading && stateRows.length === 0 && (
            <p className="text-[11px] text-zinc-500">No customer in {region} for this filter.</p>
          )}
          {stateRows.length > 0 && (
            <div className="max-h-80 space-y-1 overflow-y-auto pr-1">
              {stateRows.map((row) => {
                const selected = row.state === state;
                return (
                  <button
                    key={row.state}
                    onClick={() => pickState(row.state)}
                    className={`flex w-full items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-xs ${
                      selected
                        ? "border-indigo-500 bg-indigo-500/10"
                        : "border-zinc-200 bg-white hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-950"
                    }`}
                  >
                    <span className="truncate font-semibold">{row.state || "(unplaced)"}</span>
                    <span className="whitespace-nowrap text-[10px] text-zinc-500">
                      {row.withPhone}/{row.total} with phone
                      {row.lastPushedAt ? ` · last ${formatStamp(row.lastPushedAt)}` : ""}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="space-y-3">
          {!state && (
            <div className="rounded-xl border border-dashed border-zinc-300 px-4 py-8 text-center text-xs text-zinc-500 dark:border-zinc-700">
              Pick a state on the left to see exactly what would be pushed.
            </div>
          )}

          {state && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="text-xs font-bold uppercase tracking-wide text-zinc-500">{state}</h4>
                {stateDistricts.length > 0 && (
                  <select
                    aria-label="District"
                    value={district}
                    onChange={(e) => { setDistrict(e.target.value); setNotice(null); }}
                    className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-[11px] dark:border-zinc-800 dark:bg-zinc-950"
                  >
                    <option value="">Whole state</option>
                    {stateDistricts.map((d) => (
                      <option key={d.district} value={d.district}>
                        {d.district} ({d.withPhone})
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {options.length > 0 && (
                <div className="space-y-1.5">
                  <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-zinc-500">
                    <Users className="h-3 w-3" /> Who receives it
                  </p>
                  {options.map((opt) => (
                    <label
                      key={opt.id}
                      className={`block cursor-pointer rounded-lg border px-2.5 py-1.5 text-xs ${
                        option?.id === opt.id
                          ? "border-indigo-500 bg-indigo-500/10"
                          : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950"
                      }`}
                    >
                      <input
                        type="radio"
                        name="customer-push-target"
                        className="mr-2 accent-indigo-600"
                        checked={option?.id === opt.id}
                        onChange={() => { setOptionId(opt.id); setNotice(null); }}
                      />
                      <span className="font-semibold">{opt.label}</span>
                      {opt.teamLead && <span className="ml-1.5 rounded bg-indigo-500/10 px-1 py-0.5 text-[9px] font-bold uppercase text-indigo-600 dark:text-indigo-300">TL</span>}
                      <span className="mt-0.5 block pl-6 text-[10px] text-zinc-500">{opt.hint}</span>
                    </label>
                  ))}
                </div>
              )}

              {preview.error != null && (
                <p className="rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-600 dark:text-rose-400">{errText(preview.error)}</p>
              )}
              {preview.loading && !preview.data && <p className="text-[11px] text-zinc-500">Counting leads…</p>}
              {preview.data?.preview && (
                <PreviewCard
                  preview={preview.data.preview}
                  busy={busy}
                  onPush={() => { setError(null); setConfirmOpen(true); }}
                />
              )}
            </>
          )}
        </div>
      </div>

      <HistoryTable batches={history.data?.batches ?? []} loading={history.loading} />

      <ConfirmDialog
        open={confirmOpen}
        danger={false}
        title="Push to the dialer?"
        confirmLabel={busy ? "Pushing…" : "Push leads"}
        busy={busy}
        message={
          preview.data?.preview
            ? `${preview.data.preview.ready} lead${preview.data.preview.ready === 1 ? "" : "s"} from ${state}${district ? ` · ${district}` : ""} will appear in the agents' Auto Dialer queue now. Numbers already waiting are skipped.`
            : "This push will land in the Auto Dialer queue."
        }
        onConfirm={() => void doPush()}
        onCancel={() => setConfirmOpen(false)}
      />
    </section>
  );
}
