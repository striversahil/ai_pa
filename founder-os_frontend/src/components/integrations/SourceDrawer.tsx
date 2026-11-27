"use client";

// SourceDrawer — one connection in full: the URL, the secrets that are set,
// the mapping (editable), the delivery audit, and the destructive actions
// (rotate the key, remove the pipe).
import React, { useCallback, useEffect, useState } from "react";
import { Copy, KeyRound, Loader2, Pause, Play, ShieldCheck, Trash2 } from "lucide-react";
import { Badge, Button, ConfirmDialog, Drawer } from "@/components/ui";
import { fetchDeliveries, removeSource, rotateSource, updateSource } from "@/integrations/api";
import { copyText, fmtWhen, relTime } from "@/integrations/format";
import type { DeliveryRow, IntegrationSource } from "@/integrations/types";
import { MappingEditor } from "./MappingEditor";

const LABEL = "mb-1 block text-[10px] font-bold uppercase tracking-wide text-[var(--text-tertiary)]";
const MONO = "block break-all rounded-md bg-[var(--surface-sunken)] px-2 py-1.5 text-[10px] text-[var(--text-primary)]";

export function SourceDrawer({ source, onClose, onChanged }: { source: IntegrationSource; onClose: () => void; onChanged: () => void }) {
  const [current, setCurrent] = useState(source);
  const [url, setUrl] = useState(source.webhookUrl);
  const [deliveries, setDeliveries] = useState<DeliveryRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState("");
  const [confirm, setConfirm] = useState<"rotate" | "remove" | null>(null);
  const [purge, setPurge] = useState(false);
  const [error, setError] = useState("");

  const loadDeliveries = useCallback(
    async (next: number) => {
      setLoading(true);
      try {
        const r = await fetchDeliveries(source.id, next, 20);
        setDeliveries((prev) => (next === 1 ? r.rows : [...prev, ...r.rows]));
        setTotal(r.total);
        setPage(next);
      } catch (e: any) {
        setError(e?.message ?? "Could not load deliveries");
      } finally {
        setLoading(false);
      }
    },
    [source.id],
  );

  useEffect(() => {
    void loadDeliveries(1);
  }, [loadDeliveries]);

  const copy = async (key: string, text: string) => {
    if (await copyText(text)) {
      setCopied(key);
      setTimeout(() => setCopied(""), 1600);
    }
  };

  const toggle = async () => {
    setBusy("status");
    setError("");
    try {
      const next = current.status === "active" ? "paused" : "active";
      const r = await updateSource(current.id, { status: next });
      setCurrent({ ...current, ...r.source, config: current.config, mappingSpec: current.mappingSpec, secrets: current.secrets });
      onChanged();
    } catch (e: any) {
      setError(e?.message ?? "Could not update");
    } finally {
      setBusy(null);
    }
  };

  const rotate = async () => {
    setBusy("rotate");
    setError("");
    try {
      const r = await rotateSource(current.id);
      setUrl(r.webhookUrl);
      setConfirm(null);
      onChanged();
    } catch (e: any) {
      setError(e?.message ?? "Could not rotate");
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    setBusy("remove");
    setError("");
    try {
      await removeSource(current.id, purge);
      setConfirm(null);
      onChanged();
      onClose();
    } catch (e: any) {
      setError(e?.message ?? "Could not remove");
      setBusy(null);
    }
  };

  return (
    <Drawer
      title={current.name}
      subtitle={`${current.connector?.name ?? current.connectorKey} · ${current.eventCount.toLocaleString("en-IN")} events · last ${current.lastEventAt ? relTime(current.lastEventAt) : "never"}`}
      width="max-w-3xl"
      onClose={onClose}
      headerRight={
        <Button size="sm" variant="secondary" icon={current.status === "active" ? <Pause size={12} /> : <Play size={12} />} disabled={busy === "status"} onClick={toggle}>
          {current.status === "active" ? "Pause" : "Resume"}
        </Button>
      }
    >
      <div className="space-y-5">
        {error ? <p className="text-[11px] text-[var(--color-danger)]">{error}</p> : null}

        <div>
          <p className={LABEL}>Webhook URL</p>
          <code className={MONO}>{url || `${current.webhookPrefix}…`}</code>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" icon={<Copy size={12} />} onClick={() => copy("url", url)} disabled={!url}>
              {copied === "url" ? "Copied" : "Copy"}
            </Button>
            <Button size="sm" variant="ghost" icon={<KeyRound size={12} />} onClick={() => setConfirm("rotate")}>
              Rotate key
            </Button>
            <span className="text-[10px] text-[var(--text-tertiary)]">Rotating breaks the old URL — update the service afterwards.</span>
          </div>
        </div>

        {Object.keys(current.secrets ?? {}).length ? (
          <div>
            <p className={LABEL}>Credentials</p>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(current.secrets).map(([key, set]) => (
                <Badge key={key} tone={set ? "success" : "neutral"} dot>
                  {key} {set ? "set" : "not set"}
                </Badge>
              ))}
              {Object.entries(current.config ?? {}).map(([key, value]) => (
                <Badge key={key} tone="neutral">
                  {key}: {String(value).slice(0, 40) || "—"}
                </Badge>
              ))}
            </div>
          </div>
        ) : null}

        <div>
          <p className="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-[var(--text-tertiary)]">
            <ShieldCheck size={11} /> Field mapping
          </p>
          <MappingEditor
            key={`${current.id}:${current.mapping || "default"}`}
            sourceId={current.id}
            connectorKey={current.connectorKey}
            initial={current.mappingSpec}
            sample={current.connector?.customId ? "" : ""}
            onSave={async (spec) => {
              const r = await updateSource(current.id, { mapping: spec });
              setCurrent((prev) => ({ ...prev, ...r.source, secrets: prev.secrets }));
            }}
            onSaved={onChanged}
          />
        </div>

        <div>
          <p className={LABEL}>Deliveries ({total})</p>
          {deliveries.length === 0 && !loading ? (
            <p className="text-[10px] text-[var(--text-tertiary)]">Nothing has called this URL yet.</p>
          ) : (
            <div className="divide-y divide-[var(--border-card)] overflow-hidden rounded-lg border border-[var(--border-card)]">
              {deliveries.map((d) => (
                <div key={d.id} className="px-2 py-1.5">
                  <div className="flex flex-wrap items-center gap-2 text-[10px]">
                    <Badge tone={d.status === "accepted" ? "success" : d.status === "paused" ? "neutral" : "danger"}>
                      {d.status} {d.httpStatus}
                    </Badge>
                    <span className="text-[var(--text-secondary)]">{fmtWhen(d.receivedAt)}</span>
                    <span className="text-[var(--text-tertiary)]">{d.bytes} bytes</span>
                    {d.error ? <span className="text-[var(--color-danger)]">{d.error}</span> : null}
                    {d.bodyPreview ? (
                      <button type="button" className="ml-auto text-[10px] font-bold text-[var(--color-brand-indigo)]" onClick={() => copy(d.id, d.bodyPreview)}>
                        {copied === d.id ? "Copied body" : "Copy body"}
                      </button>
                    ) : null}
                  </div>
                  {d.bodyPreview ? <p className="mt-0.5 truncate font-mono text-[10px] text-[var(--text-tertiary)]">{d.bodyPreview}</p> : null}
                </div>
              ))}
            </div>
          )}
          {deliveries.length < total ? (
            <Button size="sm" variant="ghost" className="mt-1.5" disabled={loading} icon={loading ? <Loader2 size={12} className="animate-spin" /> : undefined} onClick={() => void loadDeliveries(page + 1)}>
              Load older deliveries
            </Button>
          ) : null}
        </div>

        <div className="rounded-lg border border-[color-mix(in_srgb,var(--color-danger)_30%,transparent)] p-2.5">
          <p className="text-[10px] font-bold text-[var(--color-danger)]">Remove this connection</p>
          <label className="mt-1 flex items-center gap-1.5 text-[10px] text-[var(--text-secondary)]">
            <input type="checkbox" checked={purge} onChange={(e) => setPurge(e.target.checked)} />
            Also delete the {current.eventCount.toLocaleString("en-IN")} events it ingested
          </label>
          <Button size="sm" variant="danger" className="mt-1.5" icon={<Trash2 size={12} />} onClick={() => setConfirm("remove")}>
            Remove connection
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirm === "rotate"}
        title="Rotate the webhook key?"
        message="The current URL stops working immediately. Any service still posting to it will fail until you paste the new URL."
        confirmLabel="Rotate key"
        busy={busy === "rotate"}
        onConfirm={rotate}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === "remove"}
        title={`Remove "${current.name}"?`}
        message={purge ? "The connection AND every event it ingested will be deleted. This cannot be undone." : "The connection and its delivery log are removed. Events it already ingested stay in the feed."}
        confirmLabel={purge ? "Remove + delete events" : "Remove connection"}
        busy={busy === "remove"}
        onConfirm={remove}
        onCancel={() => setConfirm(null)}
      />
    </Drawer>
  );
}
