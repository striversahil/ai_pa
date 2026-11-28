"use client";

// ProvidersTab.tsx — the catalog. One card per manifest provider, never a
// hard-coded list; account state and last activity come from the live payload.

import React, { useEffect, useMemo, useState } from "react";
import { ArrowRight, CheckCircle2, CirclePause, Copy, Inbox, KeyRound, Plus, Search, SlidersHorizontal, Sparkles } from "lucide-react";
import { Badge, Button } from "@/components/ui";
import { relAgo } from "@/lib/format";
import type { InstancesPayload, InstanceView, ProviderManifest, SourceStat } from "@/integrations/gateway-types";
import { categoryLabel, countFor, lastActivityFor, sourceFor, webhookUrl } from "@/integrations/gateway-pure";
import { copyText } from "@/integrations/gateway-copy";
import { CategoryBadge, DirectionBadge, EmptyState, ProviderGlyph, inputClass, selectClass } from "./gateway-ui";

type StateFilter = "all" | "configured" | "needs_setup" | "paused";

function providerState(rows: InstanceView[], instanceRequired: boolean): StateFilter {
  if (!rows.length) return instanceRequired ? "needs_setup" : "configured";
  if (!rows.some((row) => row.enabled)) return "paused";
  return "configured";
}

function ProviderCard({
  manifest, rows, categories, sources, origin, onOpen, onViewActivity,
}: {
  manifest: ProviderManifest;
  rows: InstanceView[];
  categories: Record<string, string>;
  sources: SourceStat[];
  origin: string;
  onOpen: () => void;
  onViewActivity: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const state = providerState(rows, manifest.instanceRequired !== false);
  const enabled = rows.filter((row) => row.enabled).length;
  const defaultRow = rows.find((row) => row.isDefault) || rows[0] || null;
  const url = defaultRow ? webhookUrl(manifest, defaultRow.instanceKey, origin) : "";
  const activity = lastActivityFor(sources, manifest.provider);

  return (
    <div className="group flex flex-col rounded-2xl border border-[var(--border-card)] bg-[var(--bg-card)] p-4 shadow-[var(--shadow-soft)] transition hover:border-[var(--color-brand-indigo)]/30 hover:shadow-[var(--shadow-raised)]">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--bg-input)] text-[var(--text-secondary)] group-hover:text-[var(--color-brand-indigo)]">
          <ProviderGlyph provider={manifest.provider} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-1">
            <h3 className="truncate text-sm font-extrabold text-[var(--text-primary)]">{manifest.label}</h3>
            {!manifest.instanceRequired && !rows.length ? <KeyRound size={14} className="shrink-0 text-[var(--color-violet)]" />
              : state === "configured" ? <CheckCircle2 size={14} className="shrink-0 text-[var(--color-success)]" />
              : state === "paused" ? <CirclePause size={14} className="shrink-0 text-[var(--color-warning)]" />
              : <Plus size={14} className="shrink-0 text-[var(--text-tertiary)]" />}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            <CategoryBadge category={manifest.category} label={categoryLabel(categories, manifest.category)} />
            <DirectionBadge direction={manifest.direction} />
          </div>
        </div>
      </div>

      <p className="mt-2.5 line-clamp-2 min-h-[30px] text-[11px] leading-relaxed text-[var(--text-secondary)]">{manifest.description}</p>

      <div className="mt-3 grid grid-cols-2 gap-2 rounded-lg bg-[var(--bg-input)] px-2.5 py-2 text-[10px]">
        <div>
          <p className="text-[var(--text-tertiary)]">Accounts</p>
          <p className="font-bold text-[var(--text-primary)]">{manifest.instanceRequired || rows.length ? `${enabled} active / ${rows.length}` : "global pool"}</p>
        </div>
        <div className="text-right">
          <p className="text-[var(--text-tertiary)]">Last event</p>
          <p className="font-bold text-[var(--text-primary)]">{activity ? relAgo(activity) : "never"}</p>
        </div>
        <div className="col-span-2 flex items-center justify-between border-t border-[var(--border-card)] pt-1.5">
          <span className="text-[var(--text-tertiary)]">{countFor(sources, manifest.provider)} total · {sourceFor(manifest.provider, defaultRow?.instanceKey || "default")}</span>
          {activity ? <button type="button" onClick={onViewActivity} className="font-bold text-[var(--color-brand-indigo)] hover:underline">View</button> : null}
        </div>
      </div>

      <div className="mt-auto flex items-center gap-1.5 pt-3">
        <Button size="sm" variant={state === "needs_setup" ? "primary" : "secondary"} className="flex-1" icon={state === "needs_setup" ? <Plus size={12} /> : <SlidersHorizontal size={12} />} onClick={onOpen}>
          {state === "needs_setup" ? "Set up" : "Manage"}
        </Button>
        {manifest.supportsWebhook && defaultRow && (
          <button type="button" title={copied ? "Copied" : "Copy webhook URL"} aria-label="Copy webhook URL"
            onClick={async () => { if (await copyText(url)) { setCopied(true); setTimeout(() => setCopied(false), 1400); } }}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--border-card)] text-[var(--text-tertiary)] hover:bg-[var(--bg-input)] hover:text-[var(--text-primary)]">
            {copied ? <CheckCircle2 size={13} className="text-[var(--color-success)]" /> : <Copy size={13} />}
          </button>
        )}
      </div>
    </div>
  );
}

export function ProvidersTab({
  data, onOpen, onViewActivity,
}: {
  data: InstancesPayload;
  onOpen: (provider: string) => void;
  onViewActivity: (provider: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [state, setState] = useState<StateFilter>("all");
  const [direction, setDirection] = useState("all");
  const [origin, setOrigin] = useState("");
  useEffect(() => { setOrigin(window.location.origin); }, []);

  const counts = useMemo(() => {
    const map = new Map<string, InstanceView[]>();
    for (const manifest of data.providers) map.set(manifest.provider, []);
    for (const row of data.instances) map.get(row.provider)?.push(row);
    return map;
  }, [data.instances, data.providers]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return data.providers.filter((manifest) => {
      const rows = counts.get(manifest.provider) || [];
      if (category !== "all" && manifest.category !== category) return false;
      if (direction !== "all" && manifest.direction !== direction) return false;
      if (state !== "all" && providerState(rows, manifest.instanceRequired !== false) !== state) return false;
      if (!term) return true;
      return [manifest.label, manifest.provider, manifest.description || "", categoryLabel(data.categories, manifest.category),
        ...rows.flatMap((row) => [row.label, row.instanceKey])]
        .some((value) => value.toLowerCase().includes(term));
    });
  }, [data.providers, data.categories, counts, category, direction, state, search]);

  const needsSetup = data.providers.filter(
    (manifest) => manifest.instanceRequired !== false && !(counts.get(manifest.provider) || []).length,
  ).length;
  const filtersActive = category !== "all" || direction !== "all" || state !== "all" || !!search.trim();

  const reset = () => { setSearch(""); setCategory("all"); setDirection("all"); setState("all"); };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-base font-extrabold text-[var(--text-primary)]">Provider catalog</h2>
          <p className="text-[11px] text-[var(--text-secondary)]">{data.providers.length} providers from manifest v{data.version}{needsSetup ? ` · ${needsSetup} waiting for their first account` : ""}.</p>
        </div>
        {filtersActive && <Button size="sm" variant="ghost" onClick={reset}>Clear filters</Button>}
      </div>

      <div className="grid gap-2 rounded-xl border border-[var(--border-card)] bg-[var(--bg-card)] p-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="relative sm:col-span-2 xl:col-span-1">
          <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" />
          <input className={`${inputClass} pl-8`} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search providers…" />
        </div>
        <select className={selectClass} value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Filter by category">
          <option value="all">All categories</option>
          {Object.entries(data.categories).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
        <select className={selectClass} value={state} onChange={(e) => setState(e.target.value as StateFilter)} aria-label="Filter by state">
          <option value="all">Any state</option>
          <option value="configured">Configured</option>
          <option value="needs_setup">Needs setup</option>
          <option value="paused">Paused</option>
        </select>
        <select className={selectClass} value={direction} onChange={(e) => setDirection(e.target.value)} aria-label="Filter by direction">
          <option value="all">Any direction</option>
          <option value="inbound">Inbound</option>
          <option value="outbound">Outbound</option>
          <option value="both">Two-way</option>
        </select>
      </div>

      <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">{filtered.length} of {data.providers.length} providers</p>

      {!filtered.length ? (
        <EmptyState icon={<Sparkles size={18} />} title="No provider matches" body="Clear a filter or search for a different service." action={<Button size="sm" onClick={reset}>Clear filters</Button>} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((manifest) => (
            <ProviderCard key={manifest.provider} manifest={manifest} rows={counts.get(manifest.provider) || []}
              categories={data.categories} sources={data.stats.sources} origin={origin}
              onOpen={() => onOpen(manifest.provider)} onViewActivity={() => onViewActivity(manifest.provider)} />
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 rounded-xl border border-dashed border-[var(--border-card)] px-3 py-2.5 text-[10px] text-[var(--text-tertiary)]">
        <Inbox size={13} /> A provider with no account still appears here: the manifest is the catalog, not a list of already-connected services.
        <ArrowRight size={12} className="ml-auto" />
      </div>
    </div>
  );
}
