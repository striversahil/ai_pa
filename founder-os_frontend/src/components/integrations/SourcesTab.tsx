"use client";

// SourcesTab — every live pipe. One card per connection: what it is, how much
// it has delivered, and the three things a founder does daily — copy the URL,
// pause it, or open it to rotate/remap/remove.
import React, { useState } from "react";
import { Copy, ExternalLink, Link2, Pause, Play, Plus } from "lucide-react";
import { Badge, Button, EmptyState } from "@/components/ui";
import { copyText, relTime } from "@/integrations/format";
import type { IntegrationSource } from "@/integrations/types";

export function SourcesTab({
  sources,
  onOpen,
  onAdd,
  onToggle,
  onChanged,
}: {
  sources: IntegrationSource[];
  onOpen: (source: IntegrationSource) => void;
  onAdd: () => void;
  onToggle: (source: IntegrationSource) => Promise<void>;
  onChanged: () => void;
}) {
  const [copied, setCopied] = useState<string | null>(null);

  const copy = async (source: IntegrationSource) => {
    if (!source.webhookUrl) return;
    if (await copyText(source.webhookUrl)) {
      setCopied(source.id);
      setTimeout(() => setCopied(null), 1600);
    }
  };

  if (!sources.length) {
    return (
      <EmptyState
        icon={<Link2 size={20} />}
        title="Nothing connected yet"
        description="Add Tally, IndiaMART, TradeIndia, a Meta lead form or any portal of your own — each one gets a webhook URL to paste into that service."
        action={
          <Button variant="primary" icon={<Plus size={14} />} onClick={onAdd}>
            Add a connection
          </Button>
        }
      />
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {sources.map((source) => (
        <div key={source.id} className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-[var(--border-card)] bg-[var(--bg-card)] p-3">
          <div className="flex items-start gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--surface-soft)] text-base">{source.connector?.icon ?? "🔌"}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-extrabold text-[var(--text-primary)]">{source.name}</p>
              <p className="truncate text-[10px] text-[var(--text-secondary)]">{source.connector?.name ?? source.connectorKey}</p>
            </div>
            <Badge tone={source.status === "active" ? "success" : "warning"} dot>
              {source.status === "active" ? "Live" : "Paused"}
            </Badge>
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-[var(--text-secondary)]">
            <span>
              <b className="text-[var(--text-primary)]">{source.eventCount.toLocaleString("en-IN")}</b> ingested
            </span>
            <span>last {source.lastEventAt ? relTime(source.lastEventAt) : "never"}</span>
          </div>

          {source.lastError ? <p className="truncate text-[10px] text-[var(--color-danger)]">Last error: {source.lastError}</p> : null}

          <code className="truncate rounded-md bg-[var(--surface-sunken)] px-2 py-1 text-[10px] text-[var(--text-tertiary)]">
            {source.webhookUrl || `${source.webhookPrefix}…`}
          </code>

          <div className="mt-auto flex flex-wrap items-center gap-1.5">
            <Button size="sm" variant="secondary" icon={<Copy size={12} />} onClick={() => copy(source)} disabled={!source.webhookUrl}>
              {copied === source.id ? "Copied" : "Copy URL"}
            </Button>
            <Button size="sm" variant="ghost" icon={source.status === "active" ? <Pause size={12} /> : <Play size={12} />} onClick={() => void onToggle(source)}>
              {source.status === "active" ? "Pause" : "Resume"}
            </Button>
            <span className="flex-1" />
            <Button size="sm" variant="ghost" icon={<ExternalLink size={12} />} onClick={() => onOpen(source)}>
              Open
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
