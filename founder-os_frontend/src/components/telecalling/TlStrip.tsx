"use client";

// TlStrip — Team-Lead reseller targets (founder 2026-11-05): one row per TL1
// with a region pair. Each TL owes ₹1L/working-day of RESELLER accepted ₹
// summed across THEIR TWO regions, same weekly carry-forward ledger as the
// region end-consumer target. Consumer + unset ₹ never counts here.
//
// EVERY reseller sale in the TL's pair counts to the TL total — the split
// below only explains WHO closed it (TL personal vs team telecallers).
// Every figure is server-computed (`tlTargets`) and rendered as-is.

import React, { useState } from "react";
import { ChevronDown, Crown } from "lucide-react";
import type { TlTarget } from "@/telecalling/view-types";
import type { TargetStatus } from "@/telecalling/targets";
import { barWidth, TARGET_STATUS_BG, TARGET_STATUS_CHIP, TARGET_STATUS_LABEL } from "@/telecalling/targets";
import { fmtDate, fmtLakh, fmtNum } from "@/telecalling/format";
import { CARD, LABEL, PILL } from "./surface";

export function TlStrip({ items, periodLabel }: { items: TlTarget[]; periodLabel?: string }) {
  if (!items || items.length === 0) return null;
  return (
    <section className={`${CARD} p-0`}>
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-[var(--border-card)] px-4 py-3 md:px-5">
        <div className="min-w-0">
          <h2 className="font-heading text-sm font-bold tracking-tight text-[var(--text-primary)]">
            Team leads · reseller race{periodLabel ? ` · ${periodLabel}` : ""}
          </h2>
          <p className="mt-0.5 max-w-3xl text-[11px] leading-relaxed text-[var(--text-tertiary)]">
            Each TL1 owes <span className="font-bold text-[var(--text-secondary)]">₹1L per working day</span> of{" "}
            <span className="font-bold text-[var(--text-secondary)]">reseller</span> accepted value across their two
            regions — every reseller sale by their telecallers counts into the TL total. Consumer and unclassified ₹
            never count. Shortfalls carry forward like the region ledger.
          </p>
        </div>
        <span className={`${PILL} border-[var(--border-card)] bg-[var(--surface-sunken)] text-[var(--text-tertiary)]`}>
          <Crown className="h-3 w-3" /> TL1 · two regions each
        </span>
      </div>
      <div className="space-y-3 p-3 md:p-4">
        {items.map((t) => (
          <TlRow key={t.id} tl={t} />
        ))}
      </div>
    </section>
  );
}

function TlRow({ tl }: { tl: TlTarget }) {
  const [open, setOpen] = useState(false);
  const t = tl.target;
  const pt = tl.periodTarget;
  const status: TargetStatus = t?.status ?? "critical";
  const pair = tl.regions.join(" + ") || "—";
  const personal = tl.personal ?? { count: 0, value: 0 };
  const team = tl.team ?? { count: 0, value: 0 };
  const items = tl.items ?? [];
  return (
    <div className="rounded-xl border border-[var(--border-card)] bg-[var(--bg-card)] px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-indigo-500/15 text-[11px] font-extrabold text-indigo-500 dark:text-indigo-300">
            {initials(tl.name)}
          </span>
          <div className="min-w-0">
            <div className="truncate text-[13px] font-bold tracking-tight text-[var(--text-primary)]">{tl.name}</div>
            <div className="text-[10px] font-semibold text-[var(--text-tertiary)]">TL1 · {pair}</div>
          </div>
        </div>
        <span className={`${PILL} ${TARGET_STATUS_CHIP[status]}`}>{TARGET_STATUS_LABEL[status]}</span>
      </div>

      {/* Filter-period reseller bar (no carry-in) */}
      <div className="mt-2">
        <div className="flex items-baseline justify-between gap-2">
          <span className={LABEL}>Reseller · this filter</span>
          <span className="font-mono text-[11px] font-bold tabular-nums text-[var(--text-primary)]">
            ₹{fmtNum(pt.accepted)} <span className="font-semibold text-[var(--text-tertiary)]">/ ₹{fmtNum(pt.target)}</span>
            <span className={`ml-1.5 ${pt.met ? "text-emerald-500 dark:text-emerald-400" : "text-[var(--text-tertiary)]"}`}>
              {pt.pct}%
            </span>
          </span>
        </div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--surface-sunken)]">
          <div
            className={`h-full rounded-full ${TARGET_STATUS_BG[pt.met ? "ontrack" : status]}`}
            style={{ width: `${barWidth(pt.pct)}%` }}
          />
        </div>
        {/* Who closed it: TL personal vs team — both count to the bar above. */}
        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[10px] font-semibold">
          <span className="text-[var(--text-tertiary)]" title={`Reseller sales ${tl.name} closed themselves`}>
            TL personal <span className="font-mono tabular-nums text-[var(--text-secondary)]">{personal.count} · ₹{fmtLakh(personal.value)}</span>
          </span>
          <span className="text-[var(--text-tertiary)]" title="Reseller sales by this TL's telecallers — each one counts into the TL total above">
            Team <span className="font-mono tabular-nums text-violet-600 dark:text-violet-300">{team.count} · ₹{fmtLakh(team.value)}</span>
            <span className="font-normal"> → TL</span>
          </span>
        </div>
      </div>

      {/* Weekly ledger position (carry-in included) */}
      {t ? (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] font-semibold text-[var(--text-tertiary)]">
          <span>
            Week <span className="font-mono tabular-nums text-[var(--text-secondary)]">₹{fmtLakh(t.weekAccepted)} / ₹{fmtLakh(t.weekDue)}</span>
            <span className="font-mono tabular-nums"> ({t.weekPct}%)</span>
          </span>
          {t.carryIn > 0 && (
            <span>
              backlog <span className="font-mono tabular-nums text-amber-500 dark:text-amber-400">₹{fmtLakh(t.carryIn)}</span>
            </span>
          )}
          {t.carryOut > 0 ? (
            <span>
              carries <span className="font-mono tabular-nums text-rose-500 dark:text-rose-400">₹{fmtLakh(t.carryOut)}</span> forward
            </span>
          ) : (
            <span className="text-emerald-500 dark:text-emerald-400">ledger clear</span>
          )}
        </div>
      ) : (
        <p className="mt-2 text-[10px] text-[var(--text-tertiary)]">Ledger builds on the next dashboard compute.</p>
      )}

      {/* Deal list: every reseller sale counting to this TL. */}
      {items.length > 0 && (
        <div className="mt-2 border-t border-[var(--border-card)] pt-2">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="inline-flex items-center gap-1 text-[10px] font-bold text-indigo-600 dark:text-indigo-300"
          >
            <ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} />
            {open ? "Hide" : "Show"} {items.length} reseller deal{items.length === 1 ? "" : "s"} counting to {tl.name}
          </button>
          {open && (
            <ul className="mt-1.5 space-y-1">
              {items.map((it) => (
                <li
                  key={it.estimateId}
                  className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg bg-[var(--surface-sunken)] px-2 py-1 text-[10px]"
                >
                  <span className="font-mono font-bold text-[var(--text-secondary)]">{it.estimateNumber || it.estimateId}</span>
                  <span className="min-w-0 max-w-[12rem] truncate font-semibold text-[var(--text-primary)]" title={it.customerName ?? undefined}>
                    {it.customerName || "—"}
                  </span>
                  {it.region && (
                    <span className="rounded-full border border-[var(--border-card)] px-1.5 font-bold text-[var(--text-tertiary)]">{it.region}</span>
                  )}
                  <span className={`rounded-full border px-1.5 font-bold ${it.isPersonal ? "border-indigo-500/30 bg-indigo-500/10 text-indigo-600 dark:text-indigo-300" : "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300"}`}>
                    {it.isPersonal ? "TL personal" : `Team · ${it.createdByName || "—"} → TL`}
                  </span>
                  {it.viaSalesHead && (
                    <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 font-bold text-amber-700 dark:text-amber-300" title="Sales-head direct close re-homed to this TL's home region">
                      via SH
                    </span>
                  )}
                  <span className="ml-auto font-mono font-bold tabular-nums text-[var(--text-primary)]">₹{fmtLakh(Number(it.total ?? 0))}</span>
                  {it.acceptedAt && (
                    <span className="font-mono tabular-nums text-[var(--text-tertiary)]">{fmtDate(it.acceptedAt)}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function initials(name: string): string {
  const parts = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "–";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
