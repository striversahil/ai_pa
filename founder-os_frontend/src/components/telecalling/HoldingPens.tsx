"use client";

// HoldingPens — the two accepted buckets that can never win a region target.
//
//   • Direct   — the Sales Head / HQ closes. Permanent carve-out (founder
//                decision), counted in the company total but never against R1–R4.
//   • Unlinked — accepted with no roster creator. Needs an EST → region mapping.
//
// They sit BELOW the podium on purpose: real Zoho revenue that must reconcile,
// but not part of the race.

import React from "react";
import { Compass, Crown, MoveRight } from "lucide-react";
import type { BoardBucket } from "@/telecalling/view-types";
import { fmtDate, fmtLakh, fmtNum } from "@/telecalling/format";
import { BUCKET_TONE } from "@/telecalling/tone";
import { CARD, FOCUS, LABEL, PILL, WELL } from "./surface";

export interface HoldingPensProps {
  direct?: BoardBucket | null;
  unlinked?: BoardBucket | null;
  /** Send the viewer to the unmapped/mapping surface. */
  onOpenUnlinked?: () => void;
}

function Pen({
  bucket, kind, onOpenUnlinked,
}: {
  bucket: BoardBucket;
  kind: "direct" | "unlinked";
  onOpenUnlinked?: () => void;
}) {
  const tone = kind === "direct" ? BUCKET_TONE.direct : BUCKET_TONE.unlinked;
  const Icon = kind === "direct" ? Crown : Compass;
  const label = bucket.label ?? (kind === "direct" ? "Sales Head — Direct" : "Needs region mapping");
  const items = bucket.items ?? [];
  const shown = items.slice(0, kind === "direct" ? 6 : 8);
  const more = Math.max(0, bucket.count - shown.length);

  return (
    <div className={`${CARD} ring-1 ring-inset ${tone.ring}`}>
      <span className={`pointer-events-none absolute -right-10 -top-10 h-24 w-24 rounded-full blur-2xl ${tone.wash}`} aria-hidden="true" />
      <div className="relative p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className={`grid h-8 w-8 place-items-center rounded-lg ${tone.chip}`}>
              <Icon className="h-4 w-4" aria-hidden="true" />
            </span>
            <div>
              <div className="font-heading text-[13px] font-bold text-[var(--text-primary)]">{label}</div>
              <div className="text-[10px] font-semibold text-[var(--text-tertiary)]">
                {kind === "direct"
                  ? "Counted in the total · never against a region target"
                  : "Accepted with no roster creator — map it to a region to make it count"}
              </div>
            </div>
          </div>
          <div className="text-right">
            <div className="font-mono text-[13px] font-extrabold text-[var(--text-primary)]">{fmtLakh(bucket.value)}</div>
            <div className="text-[10px] font-semibold text-[var(--text-tertiary)]">
              {bucket.count} est · {fmtNum(bucket.points)} pts
            </div>
          </div>
        </div>

        {shown.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {shown.map((it) => {
              const title = [
                it.customerName || it.estimateNumber || it.estimateId,
                it.acceptedAt ? `accepted ${fmtDate(it.acceptedAt)}` : null,
                it.total ? fmtLakh(Number(it.total)) : null,
              ].filter(Boolean).join(" · ");
              return (
                <span
                  key={it.estimateId}
                  title={title}
                  className={`${PILL} border-[var(--border-card)] bg-[var(--surface-sunken)] font-mono font-semibold text-[var(--text-secondary)]`}
                >
                  {it.estimateNumber ?? it.estimateId}
                  <span className={tone.text}>{fmtLakh(Number(it.total ?? 0))}</span>
                </span>
              );
            })}
            {more > 0 && (
              <span className={`${PILL} border-[var(--border-card)] bg-transparent text-[var(--text-tertiary)]`}>+{more} more</span>
            )}
          </div>
        )}

        {kind === "unlinked" && onOpenUnlinked && (
          <button
            type="button"
            onClick={onOpenUnlinked}
            className={`mt-2 inline-flex items-center gap-1 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[10px] font-bold text-amber-700 transition-colors hover:bg-amber-500/20 dark:text-amber-300 ${FOCUS}`}
          >
            Map in Controller
            <MoveRight className="h-3 w-3" aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}

export function HoldingPens({ direct, unlinked, onOpenUnlinked }: HoldingPensProps) {
  const hasDirect = (direct?.count ?? 0) > 0;
  const hasUnlinked = (unlinked?.count ?? 0) > 0;
  if (!hasDirect && !hasUnlinked) return null;

  return (
    <div className={`${WELL} p-1.5`}>
      <div className="mb-1.5 flex items-center justify-between px-1">
        <span className={LABEL}>Outside the race</span>
        <span className="text-[10px] font-semibold text-[var(--text-tertiary)]">
          reconciles with Zoho, cannot win a region target
        </span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {hasDirect && direct && <Pen bucket={direct} kind="direct" />}
        {hasUnlinked && unlinked && <Pen bucket={unlinked} kind="unlinked" onOpenUnlinked={onOpenUnlinked} />}
      </div>
    </div>
  );
}

export default HoldingPens;
