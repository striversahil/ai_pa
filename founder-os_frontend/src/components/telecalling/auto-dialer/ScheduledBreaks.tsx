"use client";

// Scheduled breaks editor (part of the DialerSettings draft). Inside a window
// the agent's phone locks the auto dialer; "Everyone" or picked agents.
import type { ScheduledBreak } from "@/telecalling/dialer";
import type { AgentOption } from "./PairRequests";

const input = "rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-xs dark:border-zinc-800 dark:bg-zinc-950";

export function ScheduledBreaks({ breaks, agents, onChange }: {
  breaks: ScheduledBreak[];
  agents: AgentOption[];
  onChange: (next: ScheduledBreak[]) => void;
}) {
  const set = (i: number, patch: Partial<ScheduledBreak>) => onChange(breaks.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  const toggleAgent = (i: number, id: string) => {
    const cur = breaks[i].agents;
    set(i, { agents: cur.includes(id) ? cur.filter((a) => a !== id) : [...cur, id] });
  };
  const add = () => onChange([...breaks, { id: `sb_${Date.now().toString(36)}`, label: "Lunch", start: "13:00", end: "13:45", agents: [] }]);

  return (
    <div className="space-y-2">
      <h5 className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Scheduled breaks (dialer locked)</h5>
      {breaks.length === 0 && <p className="text-[11px] text-zinc-500">None. Agents can dial for the whole shift.</p>}
      {breaks.map((b, i) => (
        <div key={b.id} className="space-y-1.5 rounded-lg border border-zinc-200 p-2 dark:border-zinc-800">
          <div className="flex flex-wrap items-center gap-2">
            <input aria-label="Break name" value={b.label} onChange={(e) => set(i, { label: e.target.value })} className={`${input} w-32`} />
            <input aria-label="Starts" type="time" value={b.start} onChange={(e) => set(i, { start: e.target.value })} className={input} />
            <span className="text-[11px] text-zinc-500">to</span>
            <input aria-label="Ends" type="time" value={b.end} onChange={(e) => set(i, { end: e.target.value })} className={input} />
            <button type="button" onClick={() => onChange(breaks.filter((_, j) => j !== i))} className="text-[11px] text-rose-600 dark:text-rose-400">Remove</button>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
            <label className="inline-flex items-center gap-1 font-semibold">
              <input type="checkbox" checked={b.agents.length === 0} onChange={() => set(i, { agents: [] })} /> Everyone
            </label>
            {agents.map((a) => (
              <label key={a.id} className="inline-flex items-center gap-1">
                <input type="checkbox" checked={b.agents.includes(a.id)} onChange={() => toggleAgent(i, a.id)} /> {a.name}
              </label>
            ))}
          </div>
        </div>
      ))}
      <button type="button" onClick={add} className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400">+ Add scheduled break</button>
      <p className="text-[11px] text-zinc-500">Times are IST. During the window the agent&apos;s phone stops auto-dialing and blocks manual dial until it ends.</p>
    </div>
  );
}
