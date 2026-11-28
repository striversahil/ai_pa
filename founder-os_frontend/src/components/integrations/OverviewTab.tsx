"use client";

// OverviewTab.tsx — the operator landing view: gateway health, coverage,
// attention list and the newest source activity. All numbers derive from the
// same /instances payload the other tabs use.

import React, { useMemo } from "react";
import {
  Activity, AlertTriangle, ArrowRight, ArrowUpRight, CheckCircle2, Clock3,
  Inbox, Layers, Radio, ShieldAlert, Sparkles, Unplug, Users,
} from "lucide-react";
import { Badge, Button, Card, KpiCard } from "@/components/ui";
import { relAgo } from "@/lib/format";
import type { InstancesPayload, ProviderManifest } from "@/integrations/gateway-types";
import { categoryLabel, countFor } from "@/integrations/gateway-pure";
import { CategoryBadge, ProviderGlyph } from "./gateway-ui";

function Bar({ value, tone = "brand" }: { value: number; tone?: "brand" | "success" | "warning" | "danger" | "info" }) {
  const color = tone === "success" ? "var(--color-success)" : tone === "warning" ? "var(--color-warning)" : tone === "danger" ? "var(--color-danger)" : tone === "info" ? "var(--color-info)" : "var(--color-brand-indigo)";
  return <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--bg-input)]"><div className="h-full rounded-full transition-all" style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: color }} /></div>;
}

export function OverviewTab({
  data, onBrowse, onOpenProvider, onViewActivity,
}: {
  data: InstancesPayload;
  onBrowse: () => void;
  onOpenProvider: (provider: string) => void;
  onViewActivity: (provider?: string) => void;
}) {
  const counts = data.stats.counts || {};
  const pending = Number(counts.pending || 0);
  const processing = Number(counts.processing || 0);
  const processed = Number(counts.processed || 0);
  const dead = Number(counts.dead_letter || 0);
  const totalEvents = pending + processing + processed + dead;

  const rowsByProvider = useMemo(() => {
    const map = new Map<string, typeof data.instances>();
    for (const row of data.instances) {
      if (!map.has(row.provider)) map.set(row.provider, []);
      map.get(row.provider)!.push(row);
    }
    return map;
  }, [data.instances]);

  const configured = data.providers.filter(
    (manifest) => manifest.instanceRequired === false || (rowsByProvider.get(manifest.provider) || []).length > 0,
  );
  const coverage = data.providers.length ? Math.round((configured.length / data.providers.length) * 100) : 0;
  const enabledAccounts = data.instances.filter((row) => row.enabled).length;
  const pausedAccounts = data.instances.length - enabledAccounts;
  const attention = data.providers.filter(
    (manifest) => manifest.instanceRequired !== false && !(rowsByProvider.get(manifest.provider) || []).length,
  );
  const recentSources = [...(data.stats.sources || [])].sort((a, b) => String(b.lastAt).localeCompare(String(a.lastAt))).slice(0, 6);

  const categoryRows = useMemo(() => {
    const map = new Map<string, { total: number; configured: number; accounts: number }>();
    for (const manifest of data.providers) {
      const row = map.get(manifest.category) || { total: 0, configured: 0, accounts: 0 };
      row.total += 1;
      const accounts = (rowsByProvider.get(manifest.provider) || []).length;
      if (accounts || manifest.instanceRequired === false) row.configured += 1;
      row.accounts += accounts;
      map.set(manifest.category, row);
    }
    return [...map.entries()].sort((a, b) => categoryLabel(data.categories, a[0]).localeCompare(categoryLabel(data.categories, b[0])));
  }, [data.providers, data.categories, rowsByProvider]);

  const health = dead > 0 ? { tone: "danger" as const, label: `${dead} dead letter${dead === 1 ? "" : "s"}`, icon: <ShieldAlert size={13} /> }
    : pending + processing > 0 ? { tone: "warning" as const, label: `${pending + processing} in queue`, icon: <Clock3 size={13} /> }
    : { tone: "success" as const, label: "Gateway healthy", icon: <CheckCircle2 size={13} /> };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-base font-extrabold text-[var(--text-primary)]">Gateway overview</h2>
          <p className="text-[11px] text-[var(--text-secondary)]">Manifest v{data.version} is the source of truth for every provider, account, webhook and mapper.</p>
        </div>
        <Badge tone={health.tone} dot>{health.icon}{health.label}</Badge>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard title="Providers" value={data.providers.length} icon={<Layers size={18} />} accent="brand" hint={`${configured.length} configured · ${coverage}% coverage`} />
        <KpiCard title="Accounts" value={data.instances.length} icon={<Users size={18} />} accent="info" hint={`${enabledAccounts} enabled${pausedAccounts ? ` · ${pausedAccounts} paused` : ""}`} />
        <KpiCard title="Queue" value={pending + processing} icon={<Radio size={18} />} accent={pending + processing ? "warning" : "success"} hint={processing ? `${processing} processing now` : "no backlog"} />
        <KpiCard title="Dead letters" value={dead} icon={<AlertTriangle size={18} />} accent={dead ? "danger" : "success"} hint={dead ? "open Activity and replay" : "nothing stuck"} />
      </div>

      <div className="grid gap-3 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <div className="mb-3 flex items-start justify-between gap-2">
            <div>
              <h3 className="text-xs font-extrabold text-[var(--text-primary)]">Coverage by category</h3>
              <p className="text-[10px] text-[var(--text-tertiary)]">Configured providers / providers in each manifest category.</p>
            </div>
            <Button size="sm" variant="ghost" icon={<ArrowRight size={12} />} onClick={onBrowse}>Browse</Button>
          </div>
          <div className="space-y-2.5">
            {categoryRows.map(([key, row]) => {
              const pct = row.total ? Math.round((row.configured / row.total) * 100) : 0;
              return (
                <div key={key}>
                  <div className="mb-1 flex items-center justify-between gap-2 text-[11px]">
                    <span className="font-semibold text-[var(--text-primary)]">{categoryLabel(data.categories, key)}</span>
                    <span className="text-[10px] tabular-nums text-[var(--text-tertiary)]">{row.configured}/{row.total} · {row.accounts} accounts</span>
                  </div>
                  <Bar value={pct} tone={pct === 100 ? "success" : pct > 0 ? "brand" : "warning"} />
                </div>
              );
            })}
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <h3 className="text-xs font-extrabold text-[var(--text-primary)]">Event ledger</h3>
          <p className="mb-3 text-[10px] text-[var(--text-tertiary)]">All-time rows in <code className="font-mono">hlp_ingested_data</code>.</p>
          <div className="space-y-2.5">
            {[
              ["Processed", processed, "success"],
              ["Pending", pending, "warning"],
              ["Processing", processing, "info"],
              ["Dead letter", dead, "danger"],
            ].map(([label, value, tone]) => (
              <div key={String(label)}>
                <div className="mb-1 flex items-center justify-between text-[11px]"><span className="font-semibold text-[var(--text-secondary)]">{label}</span><span className="tabular-nums font-bold text-[var(--text-primary)]">{value}</span></div>
                <Bar value={totalEvents ? (Number(value) / totalEvents) * 100 : 0} tone={tone as "success" | "warning" | "danger" | "brand" | "info"} />
              </div>
            ))}
          </div>
          <button type="button" onClick={() => onViewActivity()} className="mt-3 inline-flex items-center gap-1 text-[11px] font-bold text-[var(--color-brand-indigo)] hover:underline">Open activity <ArrowUpRight size={11} /></button>
        </Card>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <div className="mb-2 flex items-center justify-between gap-2">
            <div>
              <h3 className="flex items-center gap-1.5 text-xs font-extrabold text-[var(--text-primary)]"><Unplug size={13} /> Needs attention</h3>
              <p className="text-[10px] text-[var(--text-tertiary)]">Required providers with no account yet.</p>
            </div>
            <Badge tone={attention.length ? "warning" : "success"}>{attention.length}</Badge>
          </div>
          {!attention.length ? (
            <p className="flex items-center gap-1.5 rounded-lg bg-[var(--color-success)]/10 px-3 py-2 text-[11px] font-semibold text-[var(--color-success)]"><CheckCircle2 size={12} /> Every required provider has an account.</p>
          ) : (
            <div className="space-y-1">
              {attention.slice(0, 5).map((manifest) => (
                <button key={manifest.provider} type="button" onClick={() => onOpenProvider(manifest.provider)}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-[var(--bg-input)]">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--bg-input)] text-[var(--text-tertiary)]"><ProviderGlyph provider={manifest.provider} size={13} /></span>
                  <span className="min-w-0 flex-1"><span className="block truncate text-[11px] font-bold text-[var(--text-primary)]">{manifest.label}</span><span className="block text-[9px] text-[var(--text-tertiary)]">{categoryLabel(data.categories, manifest.category)}</span></span>
                  <ArrowRight size={12} className="text-[var(--text-tertiary)]" />
                </button>
              ))}
              {attention.length > 5 && <button type="button" onClick={onBrowse} className="px-2 pt-1 text-[10px] font-bold text-[var(--color-brand-indigo)]">+{attention.length - 5} more in the catalog</button>}
            </div>
          )}
        </Card>

        <Card>
          <div className="mb-2 flex items-center justify-between gap-2">
            <div>
              <h3 className="flex items-center gap-1.5 text-xs font-extrabold text-[var(--text-primary)]"><Activity size={13} /> Source activity</h3>
              <p className="text-[10px] text-[var(--text-tertiary)]">Newest staged source timestamps.</p>
            </div>
            <Button size="sm" variant="ghost" icon={<Inbox size={12} />} onClick={() => onViewActivity()}>Activity</Button>
          </div>
          {!recentSources.length ? (
            <div className="rounded-lg border border-dashed border-[var(--border-card)] px-3 py-6 text-center">
              <Sparkles size={16} className="mx-auto mb-1 text-[var(--text-tertiary)]" />
              <p className="text-[11px] font-semibold text-[var(--text-secondary)]">No deliveries yet</p>
              <p className="text-[10px] text-[var(--text-tertiary)]">Configure a provider and point its webhook here.</p>
            </div>
          ) : (
            <div className="divide-y divide-[var(--border-card)]">
              {recentSources.map((source) => {
                const provider = data.providers.find((row) => source.source === row.provider || source.source.startsWith(`${row.provider}:`));
                return (
                  <div key={source.source} className="flex items-center gap-2 py-1.5">
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--bg-input)] text-[var(--text-tertiary)]"><ProviderGlyph provider={provider?.provider || "custom"} size={13} /></span>
                    <div className="min-w-0 flex-1"><p className="truncate font-mono text-[10px] font-semibold text-[var(--text-primary)]">{source.source}</p><p className="text-[9px] text-[var(--text-tertiary)]">{source.n} events · {relAgo(source.lastAt)}</p></div>
                    {provider ? <button type="button" onClick={() => onOpenProvider(provider.provider)} className="text-[var(--text-tertiary)] hover:text-[var(--color-brand-indigo)]" aria-label={`Open ${provider.label}`}><ArrowRight size={12} /></button> : null}
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
