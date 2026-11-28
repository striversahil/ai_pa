"use client";

// IntegrationsGatewayPanel.tsx — Settings → third-party providers.
// ONE address for every account: (provider, instanceKey) → `call()`.
// The provider list, categories, fields and webhook paths are all
// manifest.json; adding a provider needs no edit here.

import { useMemo, useState } from "react";
import { Button, ConfirmDialog } from "@/components/ui";
import { useLiveDashboard } from "@/hooks/useLiveData";
import { fetchInstances, removeInstance, testInstance } from "@/integrations/gateway-api";
import type { InstanceView, ProviderManifest } from "@/integrations/gateway-types";
import { InstanceEditor } from "./InstanceEditor";
import { IngestedLogsPanel } from "./IngestedLogsPanel";

const FALLBACK_CATEGORIES: Record<string, string> = {
  ai: "AI",
  accounting: "Accounting",
  b2b_portal: "B2B portals",
  social: "Social & messaging",
  forms: "Forms",
  email: "Email",
  geo_enrichment: "Geo enrichment",
  search_enrichment: "Search enrichment",
  telecalling: "Telecalling",
  custom: "Custom",
};

export function IntegrationsGatewayPanel() {
  const dash = useLiveDashboard(fetchInstances, { events: ["data-changed"] });
  const [editing, setEditing] = useState<{ manifest: ProviderManifest; instance?: InstanceView } | null>(null);
  const [confirm, setConfirm] = useState<InstanceView | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const manifests = dash.data?.providers ?? [];
  const categories = { ...FALLBACK_CATEGORIES, ...(dash.data?.categories ?? {}) };
  const instances = dash.data?.instances ?? [];
  const counts = dash.data?.stats?.counts ?? {};

  const groups = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const visible = manifests.filter((m) => !needle || m.provider.includes(needle) || m.label.toLowerCase().includes(needle));
    const byCategory = new Map<string, ProviderManifest[]>();
    for (const manifest of visible) {
      const list = byCategory.get(manifest.category) ?? [];
      list.push(manifest);
      byCategory.set(manifest.category, list);
    }
    return [...byCategory.entries()].sort(([a], [b]) => (categories[a] ?? a).localeCompare(categories[b] ?? b));
  }, [manifests, filter, categories]);

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
      <div className="flex flex-wrap items-center gap-2">
        <input className="flex-1 min-w-[12rem] rounded-lg border border-[var(--border-card)] bg-[var(--bg-card)] px-2.5 py-1.5 text-xs"
          placeholder="Filter providers" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <span className="text-[10px] text-[var(--text-tertiary)]">manifest {dash.data?.version ?? "v2.0.0"} · {manifests.length} providers</span>
      </div>

      {dash.loading && !dash.data && <p className="text-xs text-[var(--text-tertiary)]">Loading providers…</p>}
      {!!dash.error && !dash.data && <p className="text-xs font-bold text-red-500">Failed to load providers.</p>}
      {note && <p className="text-[11px] font-bold text-[var(--text-secondary)]">{note}</p>}

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--text-tertiary)]">
        {["pending", "processing", "processed", "dead_letter"].map((status) => (
          <span key={status}>{status}: <b className="text-[var(--text-secondary)] tabular-nums">{counts[status] ?? 0}</b></span>
        ))}
      </div>

      {groups.map(([category, providers]) => (
        <section key={category} className="space-y-2">
          <h3 className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-tertiary)]">{categories[category] ?? category}</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {providers.map((manifest) => {
              const rows = instances.filter((i) => i.provider === manifest.provider);
              return (
                <div key={manifest.provider} className="rounded-xl border border-[var(--border-card)]/70 bg-[var(--bg-input)]/20 p-3 space-y-2">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-extrabold text-[var(--text-primary)]">{manifest.label}</p>
                      <p className="text-[10px] text-[var(--text-tertiary)]">
                        {manifest.direction} · {manifest.inbound.defaultDeliveryMode ?? manifest.defaultDeliveryMode} ·
                        {" "}{manifest.supportsWebhook ? "webhook" : "no webhook"}{manifest.supportsPolling ? " · poll" : ""}
                      </p>
                    </div>
                    {manifest.instanceRequired && <Button size="sm" variant="ghost" onClick={() => setEditing({ manifest })}>+ Add</Button>}
                  </div>

                  {manifest.supportsWebhook && (
                    <p className="truncate font-mono text-[10px] text-[var(--text-tertiary)]" title={manifest.webhookPath}>
                      {manifest.webhookPath}
                    </p>
                  )}

                  {!rows.length && (
                    <p className="text-[11px] text-[var(--text-tertiary)]">
                      {manifest.instanceRequired
                        ? `No account configured — \`call('${manifest.provider}')\` falls back to env.`
                        : `Runs on the global pool — no instance needed.`}
                    </p>
                  )}

                  {rows.map((instance) => (
                    <div key={instance.id} className="rounded-lg border border-[var(--border-card)]/60 px-2 py-1.5 space-y-1">
                      <div className="flex items-center gap-2">
                        <p className="min-w-0 flex-1 truncate text-[11px] font-bold text-[var(--text-secondary)]">
                          {instance.label || instance.instanceKey}
                          {instance.isDefault && <span className="ml-1 rounded bg-brand-indigo/10 px-1 text-[9px] text-brand-indigo">default</span>}
                        </p>
                        <span className="text-[9px] text-[var(--text-tertiary)]">{instance.deliveryMode}</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-1">
                        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void test(instance)}>Test</Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditing({ manifest, instance })}>Edit</Button>
                        <Button size="sm" variant="ghost" onClick={() => setConfirm(instance)}>Delete</Button>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </section>
      ))}

      <section className="space-y-2 pt-2">
        <h3 className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-tertiary)]">Ingested log</h3>
        <IngestedLogsPanel />
      </section>

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
        message="The provider stops using these credentials. Staged rows are kept."
        confirmLabel="Delete"
        busy={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={() => void remove()}
      />
    </div>
  );
}
