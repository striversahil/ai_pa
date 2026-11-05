"use client";

// DuplicatesTab — review-only duplicate clusters (no merging in this phase).
// The extract already grouped the rows; this view is where the sales team
// records the decision (keep this master / ignore the group).
import { useMemo, useState } from "react";
import type { DuplicateReview, MasterCustomer } from "@/master-data/types";
import { groupDuplicates } from "@/master-data/filters";
import { setDuplicateReview } from "@/master-data/api";
import {
  REVIEW_LABELS, formatPhone, regionLabel, shortDate,
} from "@/master-data/normalize";
import { Chip, GhostButton, PrimaryButton } from "./ui";

const PAGE = 12;

export default function DuplicatesTab({
  rows, canEdit, onOpen, onChanged,
}: {
  rows: MasterCustomer[];
  canEdit: boolean;
  onOpen: (row: MasterCustomer) => void;
  onChanged: () => void;
}) {
  const [status, setStatus] = useState<"" | "open" | "reviewed">("open");
  const [confidence, setConfidence] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState<string | null>(null);

  const groups = useMemo(() => groupDuplicates(rows), [rows]);
  const openCount = groups.filter((g) => g.review === "open").length;
  const reviewedCount = groups.length - openCount;

  const filtered = useMemo(() => {
    return groups.filter((g) => {
      if (status === "open" && g.review !== "open") return false;
      if (status === "reviewed" && g.review === "open") return false;
      if (confidence && g.confidence !== confidence) return false;
      return true;
    });
  }, [groups, status, confidence]);

  const visible = filtered.slice(0, limit);

  const decide = async (group: string, review: DuplicateReview) => {
    setBusy(group);
    setError(null);
    try {
      await setDuplicateReview(group, review);
      onChanged();
    } catch (e: any) {
      setError(e?.message || "Could not update this duplicate group");
    } finally {
      setBusy("");
    }
  };

  if (groups.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-zinc-300 p-10 text-center text-sm text-zinc-500 dark:border-zinc-700">
        No duplicates in this region. Every customer row here is unique — nothing to review.
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <Chip active={status === ""} onClick={() => { setStatus(""); setLimit(PAGE); }}>All ({groups.length})</Chip>
        <Chip active={status === "open"} onClick={() => { setStatus("open"); setLimit(PAGE); }} tone="danger">Needs review ({openCount})</Chip>
        <Chip active={status === "reviewed"} onClick={() => { setStatus("reviewed"); setLimit(PAGE); }}>Reviewed ({reviewedCount})</Chip>
        <div className="flex-1" />
        {["High", "Medium", "Review"].map((c) => (
          <Chip
            key={c}
            active={confidence === c}
            onClick={() => { setConfidence((v) => (v === c ? "" : c)); setLimit(PAGE); }}
          >
            {c}
          </Chip>
        ))}
      </div>

      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        Duplicates are grouped by the extract — the review records a decision only. No rows are merged or deleted in this phase.
      </p>

      {error && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-700 dark:text-rose-300">
          {error}
        </div>
      )}

      {visible.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-300 p-10 text-center text-sm text-zinc-500 dark:border-zinc-700">
          Nothing matches this filter. Switch back to “Needs review” or clear the confidence filter.
        </div>
      ) : (
        visible.map((g) => {
          const members = g.members;
          const lead = members[0];
          return (
            <div key={g.group} className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900/60">
              <div className="flex flex-wrap items-center gap-2 border-b border-zinc-100 bg-zinc-50/60 px-3.5 py-2.5 dark:border-zinc-800 dark:bg-zinc-900/40">
                <span className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">Group {g.group}</span>
                <Pill tone={g.confidence === "High" ? "rose" : g.confidence === "Medium" ? "amber" : "zinc"} label={g.confidence || "Unrated"} />
                <Pill tone={g.review === "open" ? "indigo" : "emerald"} label={REVIEW_LABELS[g.review]} />
                <span className="text-[11px] text-zinc-500">
                  {members.length} rows{g.action ? ` · ${g.action}` : ""}
                </span>
                <div className="flex-1" />
                {canEdit && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <PrimaryButton disabled={busy === g.group} onClick={() => void decide(g.group, "keep-master")}>
                      Keep master
                    </PrimaryButton>
                    <GhostButton disabled={busy === g.group} onClick={() => void decide(g.group, "ignored")}>
                      Ignore
                    </GhostButton>
                    <button
                      type="button"
                      disabled={busy === g.group}
                      onClick={() => void decide(g.group, "open")}
                      className="rounded-lg px-2 py-1.5 text-[11px] font-semibold text-zinc-400 transition-colors hover:text-zinc-700 disabled:opacity-50 dark:hover:text-zinc-200"
                      title="Reopen the review"
                    >
                      Reopen
                    </button>
                  </div>
                )}
              </div>
              <div>
                {members.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => onOpen(m)}
                    className={`block w-full cursor-pointer border-t border-zinc-100 px-3.5 py-2.5 text-left transition-colors first:border-t-0 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/50 ${
                      m.id === lead.id ? "bg-indigo-500/[0.04]" : ""
                    }`}
                    title="Open the full record"
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                        {m.name}
                        {m.id === lead.id && <span className="ml-2 text-[10px] font-bold uppercase tracking-wide text-indigo-500">suggested master</span>}
                      </span>
                      <span className="text-[11px] tabular-nums text-zinc-500">
                        E{m.estCount} · S{m.soCount}
                        {" · "}
                        {m.lastSalesOrderDate ? shortDate(m.lastSalesOrderDate) : m.lastEstimateDate ? shortDate(m.lastEstimateDate) : "never"}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                      <span>Zoho #{m.zohoCustomerId}</span>
                      <span>{[m.city, m.state].filter(Boolean).join(" · ") || "no location"}</span>
                      <span>{regionLabel(m.region)}</span>
                      {m.phones[0] ? <span className="font-semibold text-indigo-600 dark:text-indigo-400">{formatPhone(m.phones[0])}</span> : <span className="text-rose-500">no phone</span>}
                      {m.contact && <span>{m.contact}</span>}
                      {m.duplicateAction && <span className="truncate">suggests: {m.duplicateAction}</span>}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          );
        })
      )}

      {filtered.length > visible.length && (
        <div className="flex justify-center pt-1">
          <GhostButton onClick={() => setLimit((n) => n + PAGE)}>
            Show more ({filtered.length - visible.length} left)
          </GhostButton>
        </div>
      )}
    </div>
  );
}

function Pill({ tone, label }: { tone: "rose" | "amber" | "zinc" | "indigo" | "emerald"; label: string }) {
  const tones = {
    rose: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
    amber: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    zinc: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400",
    indigo: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
    emerald: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  } as const;
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${tones[tone]}`}>{label}</span>;
}
