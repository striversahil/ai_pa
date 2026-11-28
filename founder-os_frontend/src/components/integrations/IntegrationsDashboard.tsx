"use client";

// IntegrationsDashboard.tsx — the root-only integration workspace. It replaces
// BOTH the old Settings third-party panel and the 0180 hub UI: one page, three
// operator views (Overview / Providers / Activity), all driven by the v2
// manifest + the unified gateway instance/ingest APIs.

import React, { useEffect, useState } from "react";
import { AlertTriangle, Cable, CheckCircle2, RefreshCw, ShieldCheck, Sparkles } from "lucide-react";
import { Badge, Button, TabBar } from "@/components/ui";
import { useLiveDashboard } from "@/hooks/useLiveData";
import { fetchInstances } from "@/integrations/gateway-api";
import type { InstancesPayload } from "@/integrations/gateway-types";
import { OverviewTab } from "./OverviewTab";
import { ProvidersTab } from "./ProvidersTab";
import { ProviderDrawer } from "./ProviderDrawer";
import { DeliveriesTab } from "./DeliveriesTab";

type Tab = "overview" | "providers" | "activity";

export default function IntegrationsDashboard() {
  const dash = useLiveDashboard<InstancesPayload>(fetchInstances, { events: ["integrations", "data-changed"] });
  const [tab, setTab] = useState<Tab>("overview");
  const [selectedProvider, setSelectedProvider] = useState("");
  const [activityQuery, setActivityQuery] = useState("");
  const [notice, setNotice] = useState<{ message: string; tone: "success" | "danger" } | null>(null);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 5200);
    return () => clearTimeout(timer);
  }, [notice]);

  const notify = (message: string, tone: "success" | "danger" = "success") => setNotice({ message, tone });

  const data = dash.data;
  const manifest = data?.providers.find((row) => row.provider === selectedProvider) || null;
  const providerInstances = manifest && data ? data.instances.filter((row) => row.provider === manifest.provider) : [];
  const pending = Number(data?.stats.counts.pending || 0) + Number(data?.stats.counts.processing || 0);
  const dead = Number(data?.stats.counts.dead_letter || 0);

  const openActivity = (provider?: string) => {
    setSelectedProvider("");
    setActivityQuery(provider || "");
    setTab("activity");
  };

  const changeTab = (next: Tab) => {
    if (next === "activity" && tab !== "activity") setActivityQuery("");
    setTab(next);
  };

  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-4">
      <header className="rounded-2xl border border-[var(--border-card)] bg-[var(--bg-card)] p-5 shadow-[var(--shadow-soft)]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-[0.16em] text-[var(--color-brand-indigo)]"><Sparkles size={11} /> Operations · root only</p>
            <h1 className="mt-1 font-heading text-2xl font-extrabold tracking-tight text-[var(--text-primary)]">Integrations</h1>
            <p className="mt-1 max-w-2xl text-[11px] leading-relaxed text-[var(--text-secondary)]">
              One gateway for outbound calls and inbound webhooks. The manifest is the catalog: connect accounts, copy a provider&apos;s endpoint, watch deliveries and replay a mapping without a deploy.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {data ? <Badge tone="neutral">manifest v{data.version}</Badge> : null}
            {data ? <Badge tone={dead ? "danger" : pending ? "warning" : "success"} dot>{dead ? `${dead} dead letter${dead === 1 ? "" : "s"}` : pending ? `${pending} in queue` : "healthy"}</Badge> : null}
            <Button size="sm" variant="secondary" icon={<RefreshCw size={12} />} onClick={dash.refresh} disabled={dash.refreshing || dash.loading}>{dash.refreshing ? "Refreshing…" : "Refresh"}</Button>
          </div>
        </div>
        {data ? (
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-[var(--border-card)] pt-3 text-[10px] text-[var(--text-tertiary)]">
            <span className="flex items-center gap-1.5"><Cable size={11} /> {data.providers.length} providers</span>
            <span className="flex items-center gap-1.5"><ShieldCheck size={11} /> {data.instances.length} encrypted account{data.instances.length === 1 ? "" : "s"}</span>
            <span className="flex items-center gap-1.5"><CheckCircle2 size={11} /> {Number(data.stats.counts.processed || 0).toLocaleString("en-IN")} processed events</span>
            <span className="ml-auto font-mono text-[9px] opacity-70">/api/integrations/*</span>
          </div>
        ) : null}
      </header>

      {notice && (
        <div className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-[11px] font-bold ${notice.tone === "danger"
          ? "border-[var(--color-danger)]/30 bg-[var(--color-danger)]/10 text-[var(--color-danger)]"
          : "border-[var(--color-success)]/30 bg-[var(--color-success)]/10 text-[var(--color-success)]"}`}>
          <span className="flex items-center gap-1.5">{notice.tone === "danger" ? <AlertTriangle size={12} /> : <CheckCircle2 size={12} />} {notice.message}</span>
          <button type="button" onClick={() => setNotice(null)} className="opacity-70 hover:opacity-100" aria-label="Dismiss">×</button>
        </div>
      )}

      {dash.error && !data ? (
        <div className="rounded-2xl border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/10 p-6 text-center">
          <AlertTriangle size={20} className="mx-auto mb-2 text-[var(--color-danger)]" />
          <p className="text-sm font-extrabold text-[var(--text-primary)]">Could not load the gateway</p>
          <p className="mt-1 text-[11px] text-[var(--text-secondary)]">{String((dash.error as any)?.message || dash.error)}</p>
          <Button className="mt-3" size="sm" onClick={dash.refresh} icon={<RefreshCw size={12} />}>Retry</Button>
        </div>
      ) : dash.loading && !data ? (
        <div className="space-y-3">
          <div className="h-10 w-72 animate-pulse rounded-xl bg-[var(--bg-input)]" />
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[0, 1, 2, 3].map((n) => <div key={n} className="h-28 animate-pulse rounded-2xl bg-[var(--bg-input)]" />)}
          </div>
          <div className="h-64 animate-pulse rounded-2xl bg-[var(--bg-input)]" />
        </div>
      ) : data ? (
        <>
          <TabBar
            items={[
              { key: "overview" as const, label: "Overview" },
              { key: "providers" as const, label: "Providers", count: data.providers.length },
              { key: "activity" as const, label: "Activity", count: pending + dead, tone: dead ? "danger" as const : undefined },
            ]}
            active={tab}
            onChange={changeTab}
            variant="segmented"
            ariaLabel="Integration workspace tabs"
          />

          {tab === "overview" && <OverviewTab data={data} onBrowse={() => setTab("providers")} onOpenProvider={setSelectedProvider} onViewActivity={openActivity} />}
          {tab === "providers" && <ProvidersTab data={data} onOpen={setSelectedProvider} onViewActivity={openActivity} />}
          {tab === "activity" && (
            <DeliveriesTab key={activityQuery || "all"} sources={data.stats.sources} initialQuery={activityQuery}
              onChanged={dash.refresh} onNotice={notify} />
          )}
        </>
      ) : null}

      {manifest && data && (
        <ProviderDrawer
          manifest={manifest}
          instances={providerInstances}
          categories={data.categories}
          stats={data.stats.sources}
          onClose={() => setSelectedProvider("")}
          onChanged={dash.refresh}
          onViewActivity={openActivity}
        />
      )}
    </div>
  );
}
