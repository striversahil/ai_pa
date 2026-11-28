"use client";

// IntegrationsGatewayPanel.tsx — Settings → third-party providers.
// ONE address for every account: (provider, instanceKey) → `call()`.
// Instances are optional per provider: `call('zoho')` uses the default
// instance, `call('zoho', { instanceKey: 'dpg' })` the named one.

import { useState } from "react";
import { Button, ConfirmDialog } from "@/components/ui";
import { useLiveDashboard } from "@/hooks/useLiveData";
import { fetchInstances, removeInstance, testInstance } from "@/integrations/gateway-api";
import type { InstanceView, ProviderManifest } from "@/integrations/gateway-types";
import { InstanceEditor } from "./InstanceEditor";
import { IngestedLogsPanel } from "./IngestedLogsPanel";

function webhookUrl(manifest: ProviderManifest, key: string): string {
  const path = `${manifest.webhookPath}${key && key !== "default" ? `/${key}` : ""}`;
  return typeof window === "undefined" ? path : `${window.location.origin}${path}`;
}

export function IntegrationsGatewayPanel() {
  const dash = useLiveDashboard(fetchInstances, { events: ["data-changed"] });
  const [editing, setEditing] = useState<{ manifest: ProviderManifest; instance?: InstanceView } | null>(null);
  const [confirm, setConfirm] = useState<InstanceView | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const manifests = dash.data?.providers ?? [];
  const instances = dash.data?.instances ?? [];
  const counts = dash.data?.stats?.counts ?? {};

  const test = async (instance: InstanceView) => {
    setBusy(true);
    setNote(null);
    try {
      const res = await testInstance(instance.id);
      setNote(`${instance.label}: ${res.ok ? "connection ok" : res.detail || "failed"}`);
    } catch (e: any) {
      setNote(`${instance.label}: ${e?.message ?? "test failed"}`);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      await removeInstance(confirm.id);
      setConfirm(null);
      dash.refresh();
    } catch (e: any) {
      setNote(e?.message ?? "Delete failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {dash.loading && !dash.data && <p className="text-xs text-[var(--text-tertiary)]">Loading providers…</p>}
      {!!dash.error && !dash.data && <p className="text-xs font-bold text-red-500">Failed to load providers.</p>}
      {note && <p className="text-[11px] font-bold text-[var(--text-secondary)]">{note}</p>}

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--text-tertiary)]">
        {["pending", "processing", "processed", "dead_letter"].map((status) => (
          <span key={status}>{status}: <b className="text-[var(--text-secondary)] tabular-nums">{counts[status] ?? 0}</b></span>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {manifests.filter((m) => m.instanceRequired).map((manifest) => {
          const rows = instances.filter((i) => i.provider === manifest.provider);
          return (
            <div key={manifest.provider} className="rounded-xl border border-[var(--border-card)]/70 bg-[var(--bg-input)]/20 p-3 space-y-2">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-extrabold text-[var(--text-primary)]">{manifest.label}</p>
                  <p className="text-[10px] text-[var(--text-tertiary)]">{manifest.category} · default {manifest.defaultDeliveryMode}</p>
                </div>
                <Button size="sm" variant="ghost" onClick={() => setEditing({ manifest })}>+ Add</Button>
              </div>

              {!rows.length && <p className="text-[11px] text-[var(--text-tertiary)]">No account configured — `call('{manifest.provider}')` falls back to env.</p>}
              {rows.map((instance) => (
                <div key={instance.id} className="rounded-lg border border-[var(--border-card)]/60 bg-[var(--bg-card)] px-2.5 py-2 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[11px] font-bold text-[var(--text-primary)]">{instance.label}</span>
                    {instance.isDefault && <span className="rounded bg-brand-indigo/10 px-1.5 py-0.5 text-[9px] font-bold text-brand-indigo">default</span>}
                    <span className="rounded bg-[var(--bg-input)] px-1.5 py-0.5 text-[9px] font-bold text-[var(--text-tertiary)]">{instance.deliveryMode}</span>
                    {!instance.enabled && <span className="text-[9px] font-bold text-amber-600 dark:text-amber-400">disabled</span>}
                    <span className="ml-auto font-mono text-[10px] text-[var(--text-tertiary)]">{instance.instanceKey}</span>
                  </div>
                  {manifest.supportsWebhook && (
                    <p className="truncate font-mono text-[10px] text-[var(--text-tertiary)]" title={webhookUrl(manifest, instance.instanceKey)}>
                      {webhookUrl(manifest, instance.instanceKey)}
                    </p>
                  )}
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setEditing({ manifest, instance })}>Edit</Button>
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => void test(instance)}>Test</Button>
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirm(instance)}>Delete</Button>
                  </div>
                </div>
              ))}
            </div>
          );
        })}
      </div>

      <div className="space-y-2">
        <div>
          <h3 className="text-sm font-extrabold text-[var(--text-primary)]">Ingested log</h3>
          <p className="text-[11px] text-[var(--text-secondary)]">
            Every provider push lands in `hlp_ingested_data` first. Realtime rows are processed on receipt; batch rows wait for the 5-minute runner.
          </p>
        </div>
        <IngestedLogsPanel />
      </div>

      <p className="text-[10px] text-[var(--text-tertiary)]">
        OpenAI models/keys are managed above in AI gateway — the `openai` provider is a thin adapter over that pool and stores no secret here.
      </p>

      {editing && (
        <InstanceEditor
          manifest={editing.manifest}
          instance={editing.instance}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); dash.refresh(); }}
        />
      )}

      <ConfirmDialog
        open={!!confirm}
        title="Delete this account?"
        message={confirm ? `${confirm.label} (${confirm.provider}:${confirm.instanceKey}) will stop resolving. Staged rows are kept.` : ""}
        confirmLabel="Delete"
        busy={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={() => void remove()}
      />
    </div>
  );
}
