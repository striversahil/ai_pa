"use client";

// Controller-owned dialer settings: timers, shift, retries, the disposition
// list, break reasons, scheduled breaks and phone-dialer tracking. Edited as a draft, saved explicitly; phones pick
// the new version up on their next sync.
import { useEffect, useState } from "react";
import { toKey, type BreakReason, type DialerConfig, type Disposition } from "@/telecalling/dialer";
import { ScheduledBreaks } from "./ScheduledBreaks";
import type { AgentOption } from "./PairRequests";

const input = "rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-xs dark:border-zinc-800 dark:bg-zinc-950";

function NumberField({ id, label, value, min, max, suffix, onChange }: {
  id: string; label: string; value: number; min: number; max: number; suffix: string; onChange: (v: number) => void;
}) {
  return (
    <label htmlFor={id} className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">{label}</span>
      <span className="flex items-center gap-1">
        <input id={id} type="number" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} className={`${input} w-20`} />
        <span className="text-[11px] text-zinc-500">{suffix}</span>
      </span>
    </label>
  );
}

function Check({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="inline-flex items-center gap-1 text-[11px]">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /> {label}
    </label>
  );
}

export function DialerSettings({ config, agents, onSave }: { config: DialerConfig; agents: AgentOption[]; onSave: (cfg: DialerConfig) => Promise<void> }) {
  const withDefaults = (c: DialerConfig): DialerConfig => ({ ...c, scheduledBreaks: c.scheduledBreaks ?? [], trackPhoneCalls: c.trackPhoneCalls ?? true, connectedMinSec: c.connectedMinSec ?? 15, leadTimeMin: c.leadTimeMin ?? 10, followUpMaxDays: c.followUpMaxDays ?? 30 });
  const [draft, setDraft] = useState<DialerConfig>(withDefaults(config));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { setDraft(withDefaults(config)); }, [config]);

  const set = <K extends keyof DialerConfig>(k: K, v: DialerConfig[K]) => { setDraft((d) => ({ ...d, [k]: v })); setMsg(null); };
  const setDispo = (i: number, patch: Partial<Disposition>) =>
    set("dispositions", draft.dispositions.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  const setBreak = (i: number, patch: Partial<BreakReason>) =>
    set("breakReasons", draft.breakReasons.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  const dirty = JSON.stringify(draft) !== JSON.stringify(withDefaults(config));

  const save = async () => {
    setBusy(true);
    try {
      await onSave({
        ...draft,
        dispositions: draft.dispositions.map((d) => ({ ...d, key: d.key || toKey(d.label) })),
        breakReasons: draft.breakReasons.map((b) => ({ ...b, key: b.key || toKey(b.label) })),
      });
      setMsg({ ok: true, text: "Saved. Phones pick this up on their next sync." });
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message ?? "Save failed" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-4">
        <NumberField id="dl-dispo" label="Disposition window" value={draft.dispositionSec} min={5} max={120} suffix="sec" onChange={(v) => set("dispositionSec", v)} />
        <NumberField id="dl-next" label="Next call after" value={draft.nextCallSec} min={0} max={30} suffix="sec" onChange={(v) => set("nextCallSec", v)} />
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Shift (IST)</span>
          <span className="flex items-center gap-1">
            <input id="dl-shift-start" type="time" value={draft.shiftStart} onChange={(e) => set("shiftStart", e.target.value)} className={input} />
            <span className="text-[11px] text-zinc-500">to</span>
            <input id="dl-shift-end" type="time" value={draft.shiftEnd} onChange={(e) => set("shiftEnd", e.target.value)} className={input} />
          </span>
        </label>
        <NumberField id="dl-gap" label="Retry busy / no answer after" value={draft.retryGapMin} min={5} max={1440} suffix="min" onChange={(v) => set("retryGapMin", v)} />
        <NumberField id="dl-max" label="Stop re-queuing after" value={draft.retryMax} min={1} max={10} suffix="not-connected tries" onChange={(v) => set("retryMax", v)} />
        <NumberField id="dl-talk" label="Never re-dial calls with talk time ≥" value={draft.connectedMinSec} min={0} max={600} suffix="sec (0 = off)" onChange={(v) => set("connectedMinSec", v)} />
        <NumberField id="dl-lead" label="Lead time after a call" value={draft.leadTimeMin} min={0} max={120} suffix="min (0 = off)" onChange={(v) => set("leadTimeMin", v)} />
        <NumberField id="dl-followup" label="Follow-ups up to" value={draft.followUpMaxDays} min={1} max={365} suffix="days ahead" onChange={(v) => set("followUpMaxDays", v)} />
      </div>
      <p className="text-[11px] text-zinc-500">
        Lead time: after a call the agent can tap <b>Lead time</b> once to stop auto-dialing for this long; the disposition continues when it ends. It shows on the live board and in the report as a &quot;Lead time&quot; break.
        Follow-ups: the phone&apos;s date picker stops at this many days ahead (app 1.2.5+), and later dates sent by older apps are cut to the limit.
      </p>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-1.5">
          <h5 className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Dispositions</h5>
          {draft.dispositions.map((d, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <input aria-label="Disposition label" value={d.label} onChange={(e) => setDispo(i, { label: e.target.value })} className={`${input} w-40`} />
              <Check checked={d.connected} onChange={(v) => setDispo(i, { connected: v })} label="reached" />
              <Check checked={d.retry} onChange={(v) => setDispo(i, { retry: v })} label="retry" />
              <Check checked={d.callback} onChange={(v) => setDispo(i, { callback: v })} label="asks time" />
              <button type="button" onClick={() => set("dispositions", draft.dispositions.filter((_, j) => j !== i))} className="text-[11px] text-rose-600 dark:text-rose-400">Remove</button>
            </div>
          ))}
          <button type="button" onClick={() => set("dispositions", [...draft.dispositions, { key: "", label: "", connected: false, retry: false, callback: false }])} className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400">+ Add disposition</button>
        </div>
        <div className="space-y-1.5">
          <h5 className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Break reasons</h5>
          {draft.breakReasons.map((b, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <input aria-label="Break reason" value={b.label} onChange={(e) => setBreak(i, { label: e.target.value })} className={`${input} w-40`} />
              <span className="flex items-center gap-1 text-[11px]">
                limit <input aria-label="Limit in minutes" type="number" min={0} max={240} value={b.maxMin} onChange={(e) => setBreak(i, { maxMin: Number(e.target.value) })} className={`${input} w-16`} /> min
              </span>
              <Check checked={b.needsNote} onChange={(v) => setBreak(i, { needsNote: v })} label="needs note" />
              <button type="button" onClick={() => set("breakReasons", draft.breakReasons.filter((_, j) => j !== i))} className="text-[11px] text-rose-600 dark:text-rose-400">Remove</button>
            </div>
          ))}
          <button type="button" onClick={() => set("breakReasons", [...draft.breakReasons, { key: "", label: "", maxMin: 0, needsNote: false }])} className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400">+ Add break reason</button>
          <p className="text-[11px] text-zinc-500">Limit 0 = no limit. Overruns show in red on the live board.</p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ScheduledBreaks breaks={draft.scheduledBreaks} agents={agents} onChange={(v) => set("scheduledBreaks", v)} />
        <div className="space-y-1.5">
          <h5 className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Phone dialer calls</h5>
          <Check checked={draft.trackPhoneCalls} onChange={(v) => set("trackPhoneCalls", v)} label="Also report calls agents make or receive in the phone's own dialer" />
          <p className="text-[11px] text-zinc-500">Read from the paired phone's call log (app 1.2.0+) and counted in the report as "Phone dialer". After the try limit above, a busy / not-answered lead is marked not reachable and never comes back.</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" disabled={!dirty || busy} onClick={() => void save()} className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-bold text-white hover:bg-indigo-500 disabled:opacity-50">
          {busy ? "Saving…" : "Save dialer settings"}
        </button>
        {dirty && <button type="button" onClick={() => setDraft(withDefaults(config))} className="text-xs text-zinc-500">Discard changes</button>}
        {msg && <span className={`text-xs ${msg.ok ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>{msg.text}</span>}
        {config.updatedAt && <span className="text-[11px] text-zinc-500">Last saved by {config.updatedBy || "—"}</span>}
      </div>
    </div>
  );
}
