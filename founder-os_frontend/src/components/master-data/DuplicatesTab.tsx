"use client";

// DuplicatesTab — review-only duplicate clusters (no merging in this phase).
// The extract already grouped the rows; this view is where the sales team
// records the decision (keep this master / ignore the group).
import { useMemo, useState } from "react";
import type { DuplicateReview, MasterCustomer } from "@/master-data/types";
import { groupDuplicates } from "@/master-data/filters";
import { setDuplicateReview } from "@/master-data/api";
import {
  REVIEW_LABELS, duplicateTone, formatPhone, regionLabel, regionTone, reviewTone, shortDate,
} from "@/master-data/normalize";
import { Badge, EmptyState } from "@/components/ui";
import { Chip, GhostButton } from "./ui";

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
      <EmptyState
        icon={<span className="text-xl">✅</span>}
        title="No duplicates in this region"
        description="Every customer row in the current region is unique — nothing to review."
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
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

      <p className="text-caption text-[var(--text-secondary)]">
        Duplicates are grouped by the extract — the review records a decision only. No rows are merged or deleted in this phase.
      </p>

      {error && (
        <p className="rounded-[var(--radius-control)] bg-[color-mix(in_srgb,var(--color-danger)_10%,transparent)] px-3 py-2 text-label text-[var(--color-danger)]">{error}</p>
      )}

      {visible.length === 0 ? (
        <EmptyState title="Nothing matches this filter" description="Switch back to “Needs review” or clear the confidence filter." />
      ) : (
        <div className="space-y-3">
          {visible.map((g) => {
            const members = g.members;
            const lead = members[0];
            return (
              <div key={g.group} className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--border-card)] bg-[var(--bg-card)]">
                <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border-card)] bg-[var(--surface-soft)] px-4 py-2.5">
                  <span className="font-heading text-label font-semibold text-[var(--text-primary)]">Group {g.group}</span>
                  <Badge tone={duplicateTone(g.confidence)}>{g.confidence || "Unrated"}</Badge>
                  <Badge tone={reviewTone(g.review)}>{REVIEW_LABELS[g.review]}</Badge>
                  <span className="text-[11px] text-[var(--text-secondary)]">
                    {members.length} rows{g.action ? ` · ${g.action}` : ""}
                  </span>
                  <div className="flex-1" />
                  {canEdit && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        disabled={busy === g.group}
                        onClick={() => void decide(g.group, "keep-master")}
                        className="rounded-[var(--radius-control)] bg-[var(--color-brand-indigo)] px-2.5 py-1.5 text-[11px] font-semibold text-white disabled:opacity-50"
                        title="Mark the suggested master row as the kept record"
                      >
                        Keep master
                      </button>
                      <button
                        type="button"
                        disabled={busy === g.group}
                        onClick={() => void decide(g.group, "ignored")}
                        className="rounded-[var(--radius-control)] border border-[var(--border-card)] bg-[var(--bg-card)] px-2.5 py-1.5 text-[11px] font-semibold text-[var(--text-secondary)] disabled:opacity-50"
                      >
                        Ignore
                      </button>
                      <button
                        type="button"
                        disabled={busy === g.group}
                        onClick={() => void decide(g.group, "open")}
                        className="rounded-[var(--radius-control)] px-2 py-1.5 text-[11px] font-semibold text-[var(--text-tertiary)] hover:text-[var(--text-primary)] disabled:opacity-50"
                        title="Reopen the review"
                      >
                        Reopen
                      </button>
                    </div>
                  )}
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] border-collapse text-sm">
                    <thead>
                      <tr className="text-[10px] uppercase tracking-wide text-[var(--text-tertiary)]">
                        <th className="px-4 py-2 text-left font-semibold">Customer</th>
                        <th className="px-3 py-2 text-left font-semibold">Contact</th>
                        <th className="px-3 py-2 text-left font-semibold">Location</th>
                        <th className="px-3 py-2 text-left font-semibold">Region</th>
                        <th className="px-3 py-2 text-right font-semibold">Est. / SO</th>
                        <th className="px-3 py-2 text-left font-semibold">Suggested action</th>
                        <th className="px-3 py-2 text-left font-semibold">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {members.map((m) => (
                        <tr
                          key={m.id}
                          onClick={() => onOpen(m)}
                          className={`cursor-pointer border-t border-[var(--border-card)] transition-colors hover:bg-[var(--surface-soft)] ${m.id === lead.id ? "bg-[color-mix(in_srgb,var(--color-brand-indigo)_4%,transparent)]" : ""}`}
                        >
                          <td className="px-4 py-2">
                            <p className="font-semibold text-[var(--text-primary)]">{m.name}</p>
                            <p className="text-[10px] text-[var(--text-tertiary)]">Zoho #{m.zohoCustomerId}</p>
                          </td>
                          <td className="px-3 py-2">
                            {m.phones[0] ? (
                              <a
                                href={`tel:${m.phones[0].replace(/[^\d+]/g, "")}`}
                                onClick={(e) => e.stopPropagation()}
                                className="text-[11px] font-semibold text-[var(--color-brand-indigo)] hover:underline"
                              >
                                {formatPhone(m.phones[0])}
                              </a>
                            ) : (
                              <span className="text-[11px] text-[var(--color-danger)]">No phone</span>
                            )}
                            {m.contact && <p className="truncate text-[10px] text-[var(--text-secondary)]">{m.contact}</p>}
                          </td>
                          <td className="px-3 py-2 text-[11px] text-[var(--text-secondary)]">
                            {[m.city, m.state, m.pincode].filter(Boolean).join(" · ") || "—"}
                          </td>
                          <td className="px-3 py-2">
                            <Badge tone={regionTone(m.region)}>{regionLabel(m.region)}</Badge>
                          </td>
                          <td className="px-3 py-2 text-right text-[11px] text-[var(--text-secondary)]">
                            {m.estCount} / {m.soCount}
                            <p className="text-[10px] text-[var(--text-tertiary)]">
                              {m.lastSalesOrderDate ? shortDate(m.lastSalesOrderDate) : m.lastEstimateDate ? shortDate(m.lastEstimateDate) : "never"}
                            </p>
                          </td>
                          <td className="max-w-[200px] px-3 py-2 text-[11px] text-[var(--text-secondary)]">{m.duplicateAction || "—"}</td>
                          <td className="px-3 py-2 text-[11px] text-[var(--text-secondary)]">{m.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {filtered.length > visible.length && (
        <div className="flex justify-center">
          <GhostButton onClick={() => setLimit((n) => n + PAGE)}>
            Show {Math.min(PAGE, filtered.length - visible.length)} more groups
          </GhostButton>
        </div>
      )}
    </div>
  );
}
