"use client";

// EventDrawer.tsx — one ingest row in full: the staged raw body, the mapped
// normalized object, headers, retry state, and Replay against the CURRENT
// manifest mapping (the repair path for a bad mapper).

import React, { useEffect, useState } from "react";
import { AlertTriangle, Check, FileJson, List, RotateCcw, Server } from "lucide-react";
import { Badge, Button, Drawer } from "@/components/ui";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { fetchIngested, replayIngested } from "@/integrations/gateway-api";
import type { IngestedDetail } from "@/integrations/gateway-types";
import { prettyJson } from "@/integrations/gateway-pure";
import { fmtIstDateTime } from "@/lib/format";
import { CopyButton, StatusPill } from "./gateway-ui";

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-[var(--border-card)] bg-[var(--bg-input)] px-2.5 py-2">
      <p className="text-[9px] font-bold uppercase tracking-wide text-[var(--text-tertiary)]">{label}</p>
      <div className="mt-0.5 truncate text-[11px] font-semibold text-[var(--text-primary)]">{children}</div>
    </div>
  );
}

function JsonBlock({ title, value, icon }: { title: string; value: string; icon: React.ReactNode }) {
  const pretty = prettyJson(value);
  return (
    <section className="rounded-xl border border-[var(--border-card)] bg-[var(--bg-card)]">
      <header className="flex items-center justify-between gap-2 border-b border-[var(--border-card)] px-3 py-2">
        <h4 className="flex items-center gap-1.5 text-[11px] font-extrabold text-[var(--text-primary)]">{icon}{title}</h4>
        <CopyButton value={pretty || value} label="Copy" />
      </header>
      <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all px-3 py-2.5 font-mono text-[10px] leading-relaxed text-[var(--text-secondary)]">{pretty || <span className="italic text-[var(--text-tertiary)]">empty</span>}</pre>
    </section>
  );
}

export function EventDrawer({
  id, onClose, onChanged, onNotice,
}: {
  id: string;
  onClose: () => void;
  onChanged: () => void;
  onNotice: (message: string, tone?: "success" | "danger") => void;
}) {
  const [row, setRow] = useState<IngestedDetail | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmReplay, setConfirmReplay] = useState(false);

  const load = async () => {
    setError("");
    try {
      const result = await fetchIngested(id);
      setRow(result.row);
    } catch (caught: any) {
      setError(String(caught?.message || "Could not load this event"));
    }
  };

  useEffect(() => { void load(); }, [id]);

  const replay = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await replayIngested(id);
      await load();
      onChanged();
      setConfirmReplay(false);
      onNotice(
        result.ok ? "Replay completed with the current mapping." : result.error || "Replay finished with an error.",
        result.ok ? "success" : "danger",
      );
    } catch (caught: any) {
      setError(String(caught?.message || "Replay failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
    <Drawer
      title={row ? `${row.eventType || "Event"} · ${row.source}` : "Ingest event"}
      subtitle={row ? `${row.id} · received ${fmtIstDateTime(row.receivedAt)}` : "Loading…"}
      width="max-w-3xl"
      onClose={onClose}
      headerRight={row ? <Button size="sm" variant="secondary" icon={<RotateCcw size={12} />} disabled={busy || row.status === "processing"} onClick={() => setConfirmReplay(true)}>{busy ? "Replaying…" : "Replay"}</Button> : null}
    >
      {error && <p className="mb-3 flex items-center gap-1.5 rounded-lg bg-[var(--color-danger)]/10 px-3 py-2 text-[11px] font-bold text-[var(--color-danger)]"><AlertTriangle size={12} /> {error}</p>}
      {!row ? (
        <p className="py-10 text-center text-[11px] text-[var(--text-tertiary)]">Loading event…</p>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusPill status={row.status} />
            <Badge tone="neutral">{row.deliveryMode || "batch"}</Badge>
            <Badge tone={row.attempts > 1 ? "warning" : "neutral"}>{row.attempts} attempt{row.attempts === 1 ? "" : "s"}</Badge>
            {row.coreRefId ? <Badge tone="success" dot>mapped → {row.coreRefId}</Badge> : null}
          </div>

          {row.error ? <p className="rounded-lg bg-[var(--color-danger)]/10 px-3 py-2 text-[11px] font-semibold text-[var(--color-danger)]">{row.error}</p> : null}

          <div className="grid gap-2 sm:grid-cols-2">
            <Meta label="Source"><span className="font-mono">{row.source}</span></Meta>
            <Meta label="External event id"><span className="font-mono">{row.externalEventId || "—"}</span></Meta>
            <Meta label="Received">{fmtIstDateTime(row.receivedAt)}</Meta>
            <Meta label="Processed">{row.processedAt ? fmtIstDateTime(row.processedAt) : "—"}</Meta>
            <Meta label="Row id"><span className="font-mono text-[10px]">{row.id}</span></Meta>
            <Meta label="Core ref"><span className="font-mono">{row.coreRefId || "—"}</span></Meta>
          </div>

          <JsonBlock title="Normalized payload" value={row.normalizedJson} icon={<Server size={12} />} />
          <JsonBlock title="Raw body" value={row.rawJson} icon={<FileJson size={12} />} />
          <JsonBlock title="Request headers" value={row.headersJson} icon={<List size={12} />} />

          <p className="flex items-center gap-1.5 text-[10px] text-[var(--text-tertiary)]"><Check size={11} /> Raw and normalized are read-only; Replay is the only write path from here.</p>
        </div>
      )}
    </Drawer>
    <ConfirmDialog
      open={confirmReplay}
      title="Replay this event?"
      message={<>Replay reruns the <b>current</b> mapper over the stored raw body. It does not re-send the webhook and can create or update the mapped record.</>}
      confirmLabel="Replay event"
      busy={busy}
      onCancel={() => setConfirmReplay(false)}
      onConfirm={() => void replay()}
    />
    </>
  );
}