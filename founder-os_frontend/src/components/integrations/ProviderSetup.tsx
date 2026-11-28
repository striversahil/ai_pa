"use client";

// ProviderSetup.tsx — the read-only setup sheet for one provider: where the
// provider posts, how the Worker verifies it, how the mapper normalizes it,
// and what outbound operations the adapter exposes.

import React, { useEffect, useState } from "react";
import { AlertTriangle, ArrowDownToLine, ArrowUpRight, Clock3, ExternalLink, FileJson, KeyRound, Radio, ShieldCheck, Timer, Webhook } from "lucide-react";
import { Badge } from "@/components/ui";
import type { InstanceView, ProviderManifest } from "@/integrations/gateway-types";
import { sourceFor, webhookUrl } from "@/integrations/gateway-pure";
import { CopyButton, DeliveryBadge, EmptyState, inputClass, selectClass } from "./gateway-ui";

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-2 border-b border-[var(--border-card)] py-2 text-[11px] last:border-0">
      <span className="font-semibold text-[var(--text-tertiary)]">{label}</span>
      <span className="min-w-0 break-words text-[var(--text-primary)]">{children}</span>
    </div>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-[var(--bg-input)] px-1 py-0.5 font-mono text-[10px] text-[var(--text-secondary)]">{children}</code>;
}

function Chips({ values }: { values?: string[] }) {
  if (!values?.length) return <span className="text-[var(--text-tertiary)]">—</span>;
  return <span className="flex flex-wrap gap-1">{values.map((value) => <Badge key={value} tone="neutral">{value.replace(/_/g, " ")}</Badge>)}</span>;
}

export function ProviderSetup({
  manifest, instances, selectedId, onSelect,
}: {
  manifest: ProviderManifest;
  instances: InstanceView[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const [origin, setOrigin] = useState("");
  useEffect(() => { setOrigin(window.location.origin); }, []);
  const selected = instances.find((row) => row.id === selectedId) || instances[0] || null;
  const inbound = manifest.inbound || {};
  const outbound = manifest.outbound || {};
  const verification = inbound.verification;
  const idem = inbound.idempotencyKey;
  const challenge = inbound.challengeGet;
  const poll = inbound.poll;
  const url = selected ? webhookUrl(manifest, selected.instanceKey, origin) : webhookUrl(manifest, "default", origin);
  const requiredSecrets = (manifest.secretFields || []).filter((f) => f.required || f.requiredWhen).map((f) => f.label);

  if (!manifest.instanceRequired) {
    return (
      <EmptyState icon={<KeyRound size={18} />} title="Global AI key pool"
        body="OpenAI-compatible calls use the root-only AI gateway in Settings. This integration has no per-account credentials or webhook to configure." />
    );
  }

  return (
    <div className="space-y-4">
      {!!instances.length && instances.length > 1 && (
        <div>
          <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-[var(--text-tertiary)]">Setup shown for</p>
          <select className={selectClass} value={selected?.id || ""} onChange={(e) => onSelect(e.target.value)}>
            {instances.map((row) => <option key={row.id} value={row.id}>{row.label} · {row.instanceKey}{row.isDefault ? " (default)" : ""}</option>)}
          </select>
        </div>
      )}

      {selected && !selected.enabled && (
        <p className="flex items-center gap-1.5 rounded-lg bg-[var(--color-warning)]/10 px-3 py-2 text-[11px] font-bold text-[var(--color-warning)]">
          <AlertTriangle size={12} /> This account is paused — webhook deliveries stay staged but outbound calls will skip it.
        </p>
      )}

      <section className="rounded-xl border border-[var(--border-card)] bg-[var(--bg-card)] p-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h4 className="flex items-center gap-1.5 text-xs font-extrabold text-[var(--text-primary)]"><Webhook size={13} /> Inbound endpoint</h4>
          {inbound.supported ? <Badge tone="success" dot>ready</Badge> : <Badge tone="neutral">not inbound</Badge>}
        </div>
        {!inbound.supported ? (
          <p className="text-[11px] text-[var(--text-secondary)]">This provider is outbound-only. Use an account below to make calls.</p>
        ) : manifest.supportsWebhook ? (
          <>
            <p className="mb-1.5 text-[10px] text-[var(--text-tertiary)]">Paste this into {manifest.label}&apos;s webhook settings. {selected && selected.instanceKey !== "default" ? "The instance key is in the path." : "The default account omits the key."}</p>
            <div className="flex items-start gap-2">
              <code className="min-w-0 flex-1 break-all rounded-lg border border-[var(--border-card)] bg-[var(--bg-input)] px-2.5 py-2 font-mono text-[10px] text-[var(--text-primary)]">{url}</code>
              <CopyButton value={url} label="Copy URL" />
            </div>
            <div className="mt-3 grid gap-x-4 sm:grid-cols-2">
              <Info label="Stages as"><Code>{selected ? sourceFor(manifest.provider, selected.instanceKey) : manifest.provider}</Code></Info>
              <Info label="Transport"><Code>{inbound.transport || "http"}</Code></Info>
              <Info label="Default mode"><DeliveryBadge mode={String(selected?.deliveryMode || manifest.defaultDeliveryMode || "batch")} /></Info>
              <Info label="Quiet hours">{inbound.quietHoursIst ? `${inbound.quietHoursIst[0]}:00–${inbound.quietHoursIst[1]}:00 IST` : "none"}</Info>
            </div>
          </>
        ) : (
          <div className="rounded-lg bg-[var(--bg-input)] p-3">
            <p className="flex items-center gap-1.5 text-[11px] font-bold text-[var(--text-primary)]"><Timer size={12} /> Polled, not pushed</p>
            <p className="mt-1 text-[11px] text-[var(--text-secondary)]">The Worker polls this provider every {poll?.intervalMinutes || 5} minutes (the only poller in the gateway). No public webhook is needed.</p>
            <div className="mt-2"><Info label="Cursor field"><Code>{poll?.cursorField || "lastPollAt"}</Code></Info></div>
          </div>
        )}
      </section>

      {!!inbound.supported && (
        <section className="rounded-xl border border-[var(--border-card)] bg-[var(--bg-card)] p-4">
          <h4 className="mb-2 flex items-center gap-1.5 text-xs font-extrabold text-[var(--text-primary)]"><ShieldCheck size={13} /> Verification &amp; dedupe</h4>
          <Info label="Verification">
            {!verification || verification.kind === "none" ? <Badge tone="warning">no signature check</Badge> : (
              <span className="flex flex-wrap items-center gap-1.5">
                <Badge tone="success" dot>{String(verification.kind || "").replace(/_/g, " ")}</Badge>
                {verification.header ? <span>header <Code>{verification.header}</Code></span> : null}
                {verification.algorithm ? <span>· {verification.algorithm.toUpperCase()}</span> : null}
                {verification.encoding ? <span>· {verification.encoding}</span> : null}
                {verification.secretField ? <span>· secret <Code>{verification.secretField}</Code></span> : null}
                {verification.field ? <span>· field <Code>{verification.field}</Code></span> : null}
              </span>
            )}
          </Info>
          {verification?.optionalIfSecretUnset || verification?.optionalIfConfigUnset ? (
            <p className="mt-1 rounded-md bg-[var(--bg-input)] px-2 py-1 text-[10px] text-[var(--text-tertiary)]">Optional until the matching secret/config is saved; then verification is enforced.</p>
          ) : null}
          <Info label="Idempotency">
            {!idem ? <span className="text-[var(--text-tertiary)]">provider event id</span> : (
              <span className="flex flex-wrap items-center gap-1.5">
                <Badge tone="info">{String(idem.mode || "path")}</Badge>
                {idem.path ? <Code>{idem.path}</Code> : null}
                {(idem.paths || []).map((p) => <Code key={p}>{p}</Code>)}
                {idem.configField ? <span>config <Code>{idem.configField}</Code></span> : null}
                {idem.fallbacks?.length ? <span className="text-[10px] text-[var(--text-tertiary)]">fallback: {idem.fallbacks.join(", ")}</span> : null}
              </span>
            )}
          </Info>
          {challenge ? (
            <Info label="GET challenge"><span>query <Code>{challenge.modeParam}</Code>, token <Code>{challenge.tokenParam}</Code> → <Code>{challenge.challengeParam}</Code></span></Info>
          ) : null}
          {inbound.normalizeQueryToBodyOnGet ? <Info label="GET normalization"><Badge tone="sky">query → body</Badge></Info> : null}
        </section>
      )}

      {!!inbound.supported && (
        <section className="rounded-xl border border-[var(--border-card)] bg-[var(--bg-card)] p-4">
          <h4 className="mb-2 flex items-center gap-1.5 text-xs font-extrabold text-[var(--text-primary)]"><ArrowDownToLine size={13} /> Processing pipeline</h4>
          <Info label="Mapper"><Code>{inbound.mapper || "—"}</Code></Info>
          <Info label="Canonical type"><Code>{inbound.canonicalType || "—"}</Code></Info>
          <Info label="Target sink"><Code>{inbound.targetSink || "—"}</Code></Info>
          <Info label="Live event"><Code>{inbound.liveEvent || "integrations"}</Code></Info>
          <Info label="Required secrets">{requiredSecrets.length ? requiredSecrets.join(", ") : "none"}</Info>
        </section>
      )}

      <section className="rounded-xl border border-[var(--border-card)] bg-[var(--bg-card)] p-4">
        <h4 className="mb-2 flex items-center gap-1.5 text-xs font-extrabold text-[var(--text-primary)]"><ArrowUpRight size={13} /> Outbound calls</h4>
        <Info label="Supported">{outbound.supported ? <Badge tone="success" dot>yes</Badge> : <Badge tone="neutral">no</Badge>}</Info>
        <Info label="Adapter"><Code>{outbound.adapter || "—"}</Code></Info>
        <Info label="Auth strategy"><Code>{manifest.auth?.strategy || "—"}</Code></Info>
        <Info label="Default base URL"><Code>{manifest.defaultBaseUrl || manifest.auth?.defaultBaseUrl || "—"}</Code></Info>
        <Info label="Operations"><Chips values={outbound.operations} /></Info>
        <Info label="Capabilities"><Chips values={outbound.capabilities} /></Info>
      </section>

      {!!manifest.setupNotes?.length && (
        <section className="rounded-xl border border-[var(--border-card)] bg-[var(--bg-card)] p-4">
          <h4 className="mb-2 flex items-center gap-1.5 text-xs font-extrabold text-[var(--text-primary)]"><FileJson size={13} /> Setup notes</h4>
          <ul className="list-inside list-disc space-y-1 text-[11px] text-[var(--text-secondary)]">{manifest.setupNotes.map((note) => <li key={note}>{note}</li>)}</ul>
        </section>
      )}

      {manifest.docsUrl ? (
        <a href={manifest.docsUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[11px] font-bold text-[var(--color-brand-indigo)] hover:underline">
          <ExternalLink size={12} /> {manifest.docsLabel || "Provider documentation"}
        </a>
      ) : null}
    </div>
  );
}
