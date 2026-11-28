"use client";

// ProviderDrawer.tsx — one provider, everything about it: accounts, setup and
// recent activity. Account create/edit replaces the body (never a second
// drawer stacked on this one).

import React, { useState } from "react";
import {
  Activity, AlertCircle, Check, CirclePause, CirclePlay, Inbox, Pencil, Plus,
  Settings2, Star, Trash2, XCircle,
} from "lucide-react";
import { Badge, Button, Drawer, TabBar } from "@/components/ui";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { relAgo } from "@/lib/format";
import { removeInstance, saveInstance, testInstance } from "@/integrations/gateway-api";
import { categoryLabel, sourceFor, sourcesForProvider } from "@/integrations/gateway-pure";
import type { InstanceView, ProviderManifest, SourceStat } from "@/integrations/gateway-types";
import { AccountForm } from "./AccountForm";
import { ProviderActivity } from "./ProviderActivity";
import { ProviderSetup } from "./ProviderSetup";
import { CategoryBadge, DeliveryBadge, DirectionBadge, EmptyState, ProviderGlyph } from "./gateway-ui";

type DrawerTab = "accounts" | "setup" | "activity";

function AccountCard({
  row, selected, busy, onEdit, onTest, onToggle, onDefault, onDelete, onSetup,
}: {
  row: InstanceView;
  selected: boolean;
  busy: boolean;
  onEdit: () => void;
  onTest: () => void;
  onToggle: () => void;
  onDefault: () => void;
  onDelete: () => void;
  onSetup: () => void;
}) {
  return (
    <div className={`rounded-xl border bg-[var(--bg-card)] p-3.5 transition ${selected ? "border-[var(--color-brand-indigo)]/50 shadow-sm" : "border-[var(--border-card)]"}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="truncate text-xs font-extrabold text-[var(--text-primary)]">{row.label}</p>
            {row.isDefault && <span className="inline-flex items-center gap-0.5 rounded bg-[var(--color-brand-indigo)]/10 px-1.5 py-0.5 text-[9px] font-bold uppercase text-[var(--color-brand-indigo)]"><Star size={9} fill="currentColor" /> default</span>}
            <Badge tone={row.enabled ? "success" : "warning"} dot>{row.enabled ? "enabled" : "paused"}</Badge>
          </div>
          <p className="mt-0.5 font-mono text-[10px] text-[var(--text-tertiary)]">{sourceFor(row.provider, row.instanceKey)} · updated {relAgo(row.updatedAt)}</p>
        </div>
        <ProviderGlyph provider={row.provider} size={16} />
      </div>

      <div className="mt-2.5 grid gap-2 rounded-lg bg-[var(--bg-input)] px-2.5 py-2 text-[10px] sm:grid-cols-2">
        <div className="min-w-0"><span className="text-[var(--text-tertiary)]">Base URL</span><p className="truncate font-mono text-[var(--text-primary)]">{row.baseUrl || "—"}</p></div>
        <div className="flex items-center gap-2"><span className="text-[var(--text-tertiary)]">Delivery</span><DeliveryBadge mode={row.deliveryMode} /></div>
        <div className="sm:col-span-2"><span className="text-[var(--text-tertiary)]">Credentials</span><p className="text-[var(--text-primary)]">{row.secretKeys.length ? row.secretKeys.join(", ") : "none stored"}</p></div>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-1">
        <Button size="sm" variant="secondary" icon={<Activity size={12} />} onClick={onTest} disabled={busy}>Test</Button>
        <Button size="sm" variant="ghost" icon={<Pencil size={12} />} onClick={onEdit} disabled={busy}>Edit</Button>
        <Button size="sm" variant="ghost" icon={row.enabled ? <CirclePause size={12} /> : <CirclePlay size={12} />} onClick={onToggle} disabled={busy}>{row.enabled ? "Pause" : "Enable"}</Button>
        {!row.isDefault && <Button size="sm" variant="ghost" icon={<Star size={12} />} onClick={onDefault} disabled={busy}>Default</Button>}
        <Button size="sm" variant="ghost" icon={<Settings2 size={12} />} onClick={onSetup}>Setup</Button>
        <Button size="sm" variant="ghost" icon={<Trash2 size={12} />} onClick={onDelete} disabled={busy} className="ml-auto text-[var(--color-danger)]">Delete</Button>
      </div>
    </div>
  );
}

export function ProviderDrawer({
  manifest, instances, categories, stats, onClose, onChanged, onViewActivity,
}: {
  manifest: ProviderManifest;
  instances: InstanceView[];
  categories: Record<string, string>;
  stats: SourceStat[];
  onClose: () => void;
  onChanged: () => void;
  onViewActivity: (provider: string) => void;
}) {
  const [tab, setTab] = useState<DrawerTab>("accounts");
  const [mode, setMode] = useState<"list" | "form">("list");
  const [editing, setEditing] = useState<InstanceView | null>(null);
  const [selectedId, setSelectedId] = useState(instances.find((row) => row.isDefault)?.id || instances[0]?.id || "");
  const [busyId, setBusyId] = useState("");
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState("");
  const [deleteRow, setDeleteRow] = useState<InstanceView | null>(null);
  const [deleting, setDeleting] = useState(false);
  const selected = instances.find((row) => row.id === selectedId) || instances.find((row) => row.isDefault) || instances[0] || null;

  const run = async (id: string, action: () => Promise<string>) => {
    setBusyId(id); setNotice(""); setActionError("");
    try {
      setNotice(await action());
      onChanged();
    } catch (error: any) {
      setActionError(String(error?.message || "Action failed"));
    } finally {
      setBusyId("");
    }
  };

  const test = (row: InstanceView) => run(row.id, async () => {
    const result = await testInstance(row.id);
    if (!result.ok) throw new Error(result.detail || "Connection test failed.");
    return `Connection test passed for ${row.label}.`;
  });

  const toggle = (row: InstanceView) => run(row.id, async () => {
    await saveInstance({ enabled: !row.enabled }, row.id);
    return row.enabled ? `${row.label} paused.` : `${row.label} enabled.`;
  });

  const makeDefault = (row: InstanceView) => run(row.id, async () => {
    await saveInstance({ isDefault: true }, row.id);
    setSelectedId(row.id);
    return `${row.label} is now the default account.`;
  });

  const confirmDelete = async () => {
    if (!deleteRow) return;
    setDeleting(true); setActionError("");
    try {
      await removeInstance(deleteRow.id);
      setDeleteRow(null); setNotice(`${deleteRow.label} deleted. Its ingest log is preserved.`);
      onChanged();
    } catch (error: any) { setActionError(String(error?.message || "Could not delete account")); }
    finally { setDeleting(false); }
  };

  const tabs = [
    { key: "accounts" as const, label: "Accounts", count: instances.length },
    { key: "setup" as const, label: "Setup" },
    { key: "activity" as const, label: "Activity" },
  ];
  const providerSources = sourcesForProvider(stats, manifest.provider);

  return (
    <>
      <Drawer
        width="max-w-3xl"
        title={mode === "form" ? (editing ? `Edit ${editing.label}` : `Connect ${manifest.label}`) : manifest.label}
        subtitle={`${categoryLabel(categories, manifest.category)} · ${manifest.provider} · manifest ${manifest.defaultDeliveryMode || "batch"} default`}
        onClose={onClose}
        headerRight={mode === "list" && manifest.instanceRequired ? (
          <Button size="sm" variant="primary" icon={<Plus size={13} />} onClick={() => { setEditing(null); setMode("form"); }}>New account</Button>
        ) : null}
      >
        {mode === "form" ? (
          <AccountForm key={editing?.id || "new"} manifest={manifest} instance={editing}
            hasDefault={instances.some((row) => row.isDefault)}
            onCancel={() => { setMode("list"); setEditing(null); }}
            onSaved={(message) => { setMode("list"); setEditing(null); setNotice(message); setActionError(""); onChanged(); }} />
        ) : (
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-xl border border-[var(--border-card)] bg-[var(--bg-card)] p-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--color-brand-indigo)]/10 text-[var(--color-brand-indigo)]"><ProviderGlyph provider={manifest.provider} /></div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5"><CategoryBadge category={manifest.category} label={categoryLabel(categories, manifest.category)} /><DirectionBadge direction={manifest.direction} /><Badge tone="neutral">{instances.length} accounts</Badge></div>
                <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--text-secondary)]">{manifest.description}</p>
              </div>
            </div>

            <TabBar items={tabs} active={tab} onChange={setTab} variant="segmented" size="sm" ariaLabel="Provider sections" />

            {tab === "accounts" && (
              <div className="space-y-3">
                {notice && <p className="flex items-start gap-1.5 rounded-lg bg-[var(--color-success)]/10 px-3 py-2 text-[11px] font-semibold text-[var(--color-success)]"><Check size={12} className="mt-0.5" /> {notice}</p>}
                {actionError && <p className="flex items-start gap-1.5 rounded-lg bg-[var(--color-danger)]/10 px-3 py-2 text-[11px] font-semibold text-[var(--color-danger)]"><AlertCircle size={12} className="mt-0.5" /> {actionError}</p>}
                {!manifest.instanceRequired ? (
                  <EmptyState icon={<XCircle size={18} />} title="No account needed" body="This provider runs on the global AI key pool. Configure keys in Settings → AI gateway." />
                ) : !instances.length ? (
                  <EmptyState icon={<Inbox size={18} />} title="No account connected" body={`Add the first ${manifest.label} account. Its credentials are encrypted and never shown again.`}
                    action={<Button size="sm" variant="primary" icon={<Plus size={13} />} onClick={() => { setEditing(null); setMode("form"); }}>Connect account</Button>} />
                ) : (
                  instances.map((row) => (
                    <AccountCard key={row.id} row={row} selected={selected?.id === row.id} busy={busyId === row.id}
                      onEdit={() => { setEditing(row); setMode("form"); }}
                      onTest={() => void test(row)}
                      onToggle={() => void toggle(row)}
                      onDefault={() => void makeDefault(row)}
                      onDelete={() => setDeleteRow(row)}
                      onSetup={() => { setSelectedId(row.id); setTab("setup"); }} />
                  ))
                )}
                {!!instances.length && (
                  <p className="text-[10px] text-[var(--text-tertiary)]">Pausing keeps already-staged events; new outbound calls skip paused accounts. Deleting an account never deletes the ingest log.</p>
                )}
              </div>
            )}

            {tab === "setup" && (
              <>
                {notice && <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-[var(--color-success)]"><Check size={12} /> {notice}</p>}
                <ProviderSetup manifest={manifest} instances={instances} selectedId={selected?.id || ""} onSelect={setSelectedId} />
              </>
            )}

            {tab === "activity" && (
              <ProviderActivity provider={manifest.provider} onViewActivity={() => onViewActivity(manifest.provider)} />
            )}

            {!instances.length && manifest.instanceRequired && providerSources.length > 0 && (
              <p className="text-[10px] text-[var(--text-tertiary)]">{providerSources.reduce((sum, row) => sum + row.n, 0)} existing events were recorded before this account was removed; they remain replayable in Activity.</p>
            )}
          </div>
        )}
      </Drawer>
      <ConfirmDialog
        open={!!deleteRow}
        title="Delete this account?"
        message={<>{deleteRow?.label ? <b>{deleteRow.label}</b> : "This account"} will be removed. Staged events and the ingest log are kept and can still be replayed.</>}
        confirmLabel="Delete account"
        busy={deleting}
        onCancel={() => setDeleteRow(null)}
        onConfirm={() => void confirmDelete()}
      />
    </>
  );
}
