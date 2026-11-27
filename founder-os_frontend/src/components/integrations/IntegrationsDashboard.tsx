"use client";

// IntegrationsDashboard — the root-only ingestion hub (/integrations).
//
// One sidebar entry for every outside service the business feeds on: Tally
// forms, IndiaMART, TradeIndia, Meta lead ads, WhatsApp (native), a generic
// webhook, or a service the founder defines here. Three views over one payload:
//   Feed        → everything ingested, newest first (the activity itself)
//   Connections → the live pipes: copy URL, pause, rotate, remap, remove
//   Services    → the catalogue + custom services
import React, { useState } from "react";
import { Inbox, Link2, Plug, Plus, Radio } from "lucide-react";
import { Badge, Button, ErrorState, KpiCard, TabBar } from "@/components/ui";
import { useLiveQuery } from "@/hooks/useLiveData";
import { fetchIntegrations, updateSource } from "@/integrations/api";
import { relTime } from "@/integrations/format";
import type { IntegrationSource, IntegrationsPayload } from "@/integrations/types";
import { AddSourceDrawer } from "./AddSourceDrawer";
import { FeedTab } from "./FeedTab";
import { ServicesTab } from "./ServicesTab";
import { SourceDrawer } from "./SourceDrawer";
import { SourcesTab } from "./SourcesTab";

type Tab = "feed" | "connections" | "services";

export default function IntegrationsDashboard() {
  const dash = useLiveQuery<IntegrationsPayload>(fetchIntegrations, { events: ["integrations", "ingest"] });
  const [tab, setTab] = useState<Tab>("feed");
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const payload = dash.data;
  const sources = payload?.sources ?? [];
  const open = openId ? sources.find((s) => s.id === openId) ?? null : null;

  const toggle = async (source: IntegrationSource) => {
    await updateSource(source.id, { status: source.status === "active" ? "paused" : "active" });
    dash.refresh();
  };

  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-4 pb-12">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 text-lg font-extrabold text-[var(--text-primary)]">
            <Radio size={18} className="text-[var(--color-brand-indigo)]" /> Integrations
          </h1>
          <p className="text-[11px] text-[var(--text-secondary)]">
            Every outside portal, one pipeline: connect a service, paste its webhook URL, and its submissions land in one feed — normalized, deduped,
            replayable.
          </p>
        </div>
        <Button variant="primary" icon={<Plus size={14} />} onClick={() => setAdding(true)}>
          Add connection
        </Button>
      </div>

      {dash.error && !payload ? (
        <ErrorState title="Could not load the integration hub" message={String((dash.error as any)?.message ?? "")} onRetry={dash.refresh} />
      ) : null}

      {!payload ? (
        <p className="py-10 text-center text-xs text-[var(--text-tertiary)]">Loading…</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard title="Connections" value={payload.stats.sources} icon={<Link2 size={18} />} hint={`${sources.filter((s) => s.status === "active").length} live`} />
            <KpiCard title="Events ingested" value={payload.stats.events.toLocaleString("en-IN")} icon={<Inbox size={18} />} accent="success" hint="all time" />
            <KpiCard title="Last activity" value={payload.stats.lastEventAt ? relTime(payload.stats.lastEventAt) : "—"} icon={<Radio size={18} />} accent="info" hint="newest event" />
            <KpiCard title="Services" value={payload.catalog.length} icon={<Plug size={18} />} accent="violet" hint={`${payload.connectors.length} custom`} />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <TabBar
              variant="segmented"
              active={tab}
              onChange={(k: string) => setTab(k as Tab)}
              items={[
                { key: "feed", label: "Activity" },
                { key: "connections", label: `Connections ${sources.length}` },
                { key: "services", label: `Services ${payload.catalog.length}` },
              ]}
            />
            <span className="flex-1" />
            {sources.some((s) => s.lastError) ? <Badge tone="danger" dot>a connection is failing</Badge> : null}
          </div>

          {tab === "feed" ? <FeedTab sources={sources} /> : null}
          {tab === "connections" ? (
            <SourcesTab sources={sources} onOpen={(s) => setOpenId(s.id)} onAdd={() => setAdding(true)} onToggle={toggle} onChanged={dash.refresh} />
          ) : null}
          {tab === "services" ? <ServicesTab catalog={payload.catalog} connectors={payload.connectors} onChanged={dash.refresh} /> : null}
        </>
      )}

      {adding && payload ? (
        <AddSourceDrawer
          catalog={payload.catalog}
          onClose={() => {
            setAdding(false);
            dash.refresh();
          }}
          onCreated={dash.refresh}
        />
      ) : null}

      {open ? (
        <SourceDrawer
          key={open.id}
          source={open}
          onClose={() => setOpenId(null)}
          onChanged={async () => {
            await dash.refresh();
          }}
        />
      ) : null}

      {!sources.length && payload && tab === "connections" ? (
        <p className="flex items-center justify-center gap-1.5 text-[10px] text-[var(--text-tertiary)]">
          <Inbox size={11} /> <Link2 size={11} /> A connection is one URL you paste into a service.
        </p>
      ) : null}
    </div>
  );
}