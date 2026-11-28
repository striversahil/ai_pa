"use client";

// Customer push → preview card. Counts only: no full phone number ever renders
// here (the API sends the last four digits).
import { AlertTriangle, Send, Users } from "lucide-react";
import {
  SKIP_LABELS, agentSplitLabel, distributionSummary, pairLabel,
  type CampaignPreview,
} from "@/telecalling/customer-push";

export default function PreviewCard({
  preview, busy, onPush,
}: {
  preview: CampaignPreview;
  busy: boolean;
  onPush: () => void;
}) {
  const skipped = preview.skipped.reduce<Record<string, number>>((acc, s) => {
    acc[s.reason] = (acc[s.reason] ?? 0) + 1;
    return acc;
  }, {});
  const ready = preview.ready;

  return (
    <div className="space-y-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Preview</p>
          <p className="mt-1 text-sm">
            <span className="text-2xl font-bold">{ready}</span>{" "}
            <span className="text-zinc-500 dark:text-zinc-400">leads ready · {distributionSummary(preview.distribution, preview.agents)}</span>
          </p>
          <p className="mt-1 text-[11px] text-zinc-500">{agentSplitLabel(preview.agents)}</p>
        </div>
        <button
          onClick={onPush}
          disabled={busy || ready === 0}
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          <Send className="h-4 w-4" /> {busy ? "Pushing…" : `Push ${ready} to dialer`}
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {Object.entries(skipped).map(([reason, count]) => (
          <span
            key={reason}
            title={SKIP_LABELS[reason as keyof typeof SKIP_LABELS]}
            className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-300"
          >
            <AlertTriangle className="h-3 w-3" /> {count} · {SKIP_LABELS[reason as keyof typeof SKIP_LABELS]}
          </span>
        ))}
        {preview.district && (
          <span className="rounded-full border border-zinc-200 px-2 py-0.5 text-[11px] dark:border-zinc-800">District: {preview.district}</span>
        )}
        {preview.clientType && (
          <span className="rounded-full border border-zinc-200 px-2 py-0.5 text-[11px] dark:border-zinc-800">Type: {preview.clientType}</span>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-zinc-500">
            <Users className="h-3 w-3" /> Receive this push
          </p>
          {preview.agents.map((agent) => (
            <div key={agent.key} className="flex items-center justify-between gap-2 rounded-lg border border-zinc-200 px-2 py-1 text-xs dark:border-zinc-800">
              <span className="truncate">
                <span className="font-semibold">{agent.name || agent.key}</span>
                <span className="ml-1.5 text-[10px] text-zinc-500">{pairLabel(agent)}</span>
              </span>
              <span className="font-bold tabular-nums">{agent.planned}</span>
            </div>
          ))}
        </div>
        <div className="space-y-1.5">
          <p className="text-[11px] font-bold uppercase tracking-wide text-zinc-500">First leads</p>
          {preview.sample.length === 0 && <p className="text-xs text-zinc-500">Nothing to send.</p>}
          {preview.sample.map((lead, i) => (
            <div key={`${lead.name}-${i}`} className="flex items-center justify-between gap-2 rounded-lg border border-zinc-200 px-2 py-1 text-xs dark:border-zinc-800">
              <span className="truncate">{lead.name}</span>
              <span className="font-mono text-[11px] text-zinc-500">{lead.mobileMasked}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
