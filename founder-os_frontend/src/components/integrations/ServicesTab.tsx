"use client";

// ServicesTab — the catalogue: what this platform knows how to ingest, plus the
// founder's own services. A custom service is a name + a JSON mapping (no
// deploy), so "a portal we don't support yet" is a two-minute job.
import React, { useMemo, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Badge, Button, ConfirmDialog, Drawer, ErrorState } from "@/components/ui";
import { createConnector, removeConnector, updateConnector } from "@/integrations/api";
import { AUTH_LABEL, groupCatalog } from "@/integrations/format";
import type { CatalogEntry, CustomConnector, MappingSpec } from "@/integrations/types";

const FIELD =
  "w-full rounded-lg border border-[var(--border-card)] bg-[var(--bg-input)] px-2.5 py-2 text-[11px] text-[var(--text-primary)] outline-none focus:border-[var(--color-brand-indigo)]";
const LABEL = "mb-1 block text-[10px] font-bold uppercase tracking-wide text-[var(--text-tertiary)]";

export function ServicesTab({
  catalog,
  connectors,
  onChanged,
}: {
  catalog: CatalogEntry[];
  connectors: CustomConnector[];
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState<{ connector: CustomConnector | null } | null>(null);
  const [removing, setRemoving] = useState<CustomConnector | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const groups = useMemo(() => groupCatalog(catalog), [catalog]);

  const remove = async () => {
    if (!removing) return;
    setBusy(true);
    setError("");
    try {
      await removeConnector(removing.id);
      setRemoving(null);
      onChanged();
    } catch (e: any) {
      setError(e?.message ?? "Could not delete");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div>
          <h3 className="text-sm font-extrabold text-[var(--text-primary)]">Services</h3>
          <p className="text-[10px] text-[var(--text-secondary)]">A service defines HOW a payload becomes an event. Connections are instances of one.</p>
        </div>
        <span className="flex-1" />
        {error ? <span className="text-[10px] text-[var(--color-danger)]">{error}</span> : null}
        <Button size="sm" variant="primary" icon={<Plus size={12} />} onClick={() => setEditing({ connector: null })}>
          New service
        </Button>
      </div>

      {groups.map((group) => (
        <div key={group.category}>
          <p className={LABEL}>{group.category}</p>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {group.entries.map((entry) => {
              const custom = entry.customId ? connectors.find((c) => c.id === entry.customId) : null;
              return (
                <div key={entry.key} className="flex items-start gap-2 rounded-lg border border-[var(--border-card)] bg-[var(--bg-card)] p-2.5">
                  <span className="text-base leading-none">{entry.icon ?? "🔌"}</span>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5">
                      <span className="truncate text-xs font-bold text-[var(--text-primary)]">{entry.name}</span>
                      {entry.status === "needs-setup" ? <Badge tone="warning">Needs setup</Badge> : null}
                      {entry.customId ? <Badge tone="brand">Custom</Badge> : null}
                    </p>
                    <p className="text-[10px] text-[var(--text-secondary)]">{AUTH_LABEL[entry.authKind]}</p>
                    {entry.hint ? <p className="mt-0.5 line-clamp-2 text-[10px] text-[var(--text-tertiary)]">{entry.hint}</p> : null}
                  </div>
                  {custom ? (
                    <span className="flex shrink-0 items-center gap-1">
                      <button type="button" className="rounded p-1 text-[var(--text-tertiary)] hover:text-[var(--text-primary)]" onClick={() => setEditing({ connector: custom })} aria-label="Edit service">
                        <Pencil size={12} />
                      </button>
                      <button type="button" className="rounded p-1 text-[var(--text-tertiary)] hover:text-[var(--color-danger)]" onClick={() => setRemoving(custom)} aria-label="Delete service">
                        <Trash2 size={12} />
                      </button>
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {editing ? (
        <CustomServiceDrawer
          connector={editing.connector}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            onChanged();
          }}
        />
      ) : null}

      <ConfirmDialog
        open={!!removing}
        title={`Delete "${removing?.name ?? ""}"?`}
        message="The service is removed from the catalogue. Connections using it must be removed first."
        confirmLabel="Delete service"
        busy={busy}
        onConfirm={remove}
        onCancel={() => setRemoving(null)}
      />
    </div>
  );
}

const STARTER = '{\n  "fields": {\n    "externalId": "id",\n    "title": "subject",\n    "summary": "message",\n    "contactName": "name",\n    "phone": "phone",\n    "email": "email",\n    "company": "company",\n    "city": "city"\n  },\n  "eventKind": "lead"\n}';

function CustomServiceDrawer({ connector, onClose, onSaved }: { connector: CustomConnector | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(connector?.name ?? "");
  const [icon, setIcon] = useState(connector?.icon ?? "🔌");
  const [sample, setSample] = useState(connector?.sample ?? "");
  const [mapping, setMapping] = useState(connector?.mapping ? JSON.stringify(connector.mappingSpec, null, 2) : STARTER);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      const spec = JSON.parse(mapping) as MappingSpec;
      if (connector) await updateConnector(connector.id, { name, icon, mapping: spec, sample });
      else await createConnector({ name, icon, mapping: spec, sample });
      onSaved();
    } catch (e: any) {
      setError(e?.message ?? "Could not save the service");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer title={connector ? "Edit service" : "New service"} subtitle="A name and a mapping. Every future payload shape is handled without a deploy." onClose={onClose}>
      <div className="space-y-3">
        {error ? <ErrorState title="Could not save" message={error} /> : null}
        <div className="flex gap-2">
          <div className="w-16">
            <label className={LABEL}>Icon</label>
            <input value={icon} onChange={(e) => setIcon(e.target.value)} className={`${FIELD} text-center`} maxLength={4} />
          </div>
          <div className="flex-1">
            <label className={LABEL}>Service name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className={FIELD} placeholder="e.g. Justdial leads" />
          </div>
        </div>
        <div>
          <label className={LABEL}>Field mapping (JSON)</label>
          <textarea value={mapping} onChange={(e) => setMapping(e.target.value)} rows={12} spellCheck={false} className={`${FIELD} font-mono text-[10px]`} />
          <p className="mt-1 text-[10px] leading-relaxed text-[var(--text-tertiary)]">
            <b>itemsPath</b> where the array sits (blank = the body itself), <b>fields</b> target → dot path, <b>literals</b> target → fixed value,
            <b> occurredAtFormat</b> iso | epoch_s | epoch_ms | dd-mm-yyyy | yyyy-mm-dd, <b>eventKind</b> lead | enquiry | visit | expense | order | message | raw.
          </p>
        </div>
        <div>
          <label className={LABEL}>Sample payload (optional)</label>
          <textarea value={sample} onChange={(e) => setSample(e.target.value)} rows={5} spellCheck={false} className={`${FIELD} font-mono text-[10px]`} placeholder='{"id":"1","name":"Ravi"}' />
        </div>
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" disabled={busy || !name.trim()} onClick={save}>
            {busy ? "Saving…" : connector ? "Save service" : "Create service"}
          </Button>
        </div>
      </div>
    </Drawer>
  );
}
