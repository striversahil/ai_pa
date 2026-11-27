"use client";

// AddSourceDrawer — connect a service in three steps: pick it, configure it,
// copy the URL. The URL and (when the service supports it) the signing secret
// are shown exactly once here, then never again in plain text.
import React, { useMemo, useState } from "react";
import { ArrowLeft, Check, Copy, Loader2, Plus, Sparkles } from "lucide-react";
import { Badge, Button, Drawer, ErrorState } from "@/components/ui";
import { createSource, previewMapping } from "@/integrations/api";
import { AUTH_LABEL, copyText, groupCatalog } from "@/integrations/format";
import type { CatalogEntry, IntegrationSource } from "@/integrations/types";

type Step = "pick" | "setup" | "done";

const FIELD =
  "w-full rounded-lg border border-[var(--border-card)] bg-[var(--bg-input)] px-2.5 py-2 text-[11px] text-[var(--text-primary)] outline-none focus:border-[var(--color-brand-indigo)]";
const LABEL = "mb-1 block text-[10px] font-bold uppercase tracking-wide text-[var(--text-tertiary)]";

export function AddSourceDrawer({
  catalog,
  onClose,
  onCreated,
}: {
  catalog: CatalogEntry[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [step, setStep] = useState<Step>("pick");
  const [entry, setEntry] = useState<CatalogEntry | null>(null);
  const [name, setName] = useState("");
  const [config, setConfig] = useState<Record<string, string>>({});
  const [sample, setSample] = useState("");
  const [preview, setPreview] = useState<{ events: any[]; warnings: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<{ source: IntegrationSource; signingSecret: string } | null>(null);
  const [copied, setCopied] = useState("");

  const groups = useMemo(() => groupCatalog(catalog), [catalog]);

  const pick = (next: CatalogEntry) => {
    setEntry(next);
    setName(next.name);
    setConfig({});
    setSample(next.key === "generic" ? "" : "");
    setPreview(null);
    setError("");
    setStep("setup");
  };

  const runPreview = async () => {
    if (!entry) return;
    setBusy(true);
    setError("");
    try {
      const r = await previewMapping({ payload: sample, mapping: entry.mapping, connectorKey: entry.key });
      setPreview({ events: r.events, warnings: r.warnings });
    } catch (e: any) {
      setError(e?.message ?? "Could not read that sample");
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    if (!entry) return;
    setBusy(true);
    setError("");
    try {
      const r = await createSource({ connectorKey: entry.key, name: name.trim() || entry.name, config });
      setCreated({ source: r.source, signingSecret: r.signingSecret });
      setStep("done");
      onCreated();
    } catch (e: any) {
      setError(e?.message ?? "Could not create the connection");
    } finally {
      setBusy(false);
    }
  };

  const copy = async (key: string, text: string) => {
    if (await copyText(text)) {
      setCopied(key);
      setTimeout(() => setCopied(""), 1600);
    }
  };

  const title = step === "pick" ? "Add a connection" : step === "setup" ? `Connect ${entry?.name ?? ""}` : "You're connected";

  return (
    <Drawer title={title} subtitle={step === "pick" ? "Any service that can POST or forward a form submission can be wired up here." : entry?.hint} onClose={onClose}>
      {error ? <div className="mb-3"><ErrorState title="Something went wrong" message={error} /></div> : null}

      {step === "pick" ? (
        <div className="space-y-4">
          {groups.map((group) => (
            <div key={group.category}>
              <p className={LABEL}>{group.category}</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {group.entries.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => pick(item)}
                    className="flex items-start gap-2 rounded-lg border border-[var(--border-card)] bg-[var(--bg-card)] p-2.5 text-left hover:border-[var(--color-brand-indigo)]"
                  >
                    <span className="text-base leading-none">{item.icon ?? "🔌"}</span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-xs font-bold text-[var(--text-primary)]">{item.name}</span>
                        {item.status === "needs-setup" ? <Badge tone="warning">Needs setup</Badge> : null}
                        {item.customId ? <Badge tone="brand">Custom</Badge> : null}
                      </span>
                      <span className="mt-0.5 block text-[10px] text-[var(--text-secondary)]">{AUTH_LABEL[item.authKind]}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ))}
          <p className="text-[10px] text-[var(--text-tertiary)]">
            Missing a portal? Add it under <b>Services → New service</b> — paste one sample payload and map its fields, no deploy needed.
          </p>
        </div>
      ) : null}

      {step === "setup" && entry ? (
        <div className="space-y-3">
          <div>
            <label className={LABEL}>Connection name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className={FIELD} placeholder={`${entry.name} — main account`} />
            <p className="mt-1 text-[10px] text-[var(--text-tertiary)]">Shown in the feed ("via …"). Use the account or form name.</p>
          </div>

          {(entry.fields ?? []).map((field) => (
            <div key={field.key}>
              <label className={LABEL}>{field.label}</label>
              <input
                type={field.secret ? "password" : "text"}
                value={config[field.key] ?? ""}
                onChange={(e) => setConfig((c) => ({ ...c, [field.key]: e.target.value }))}
                className={FIELD}
                placeholder={field.placeholder}
                autoComplete="off"
              />
              {field.hint ? <p className="mt-1 text-[10px] text-[var(--text-tertiary)]">{field.hint}</p> : null}
            </div>
          ))}

          {entry.key !== "tally" ? (
            <div>
              <label className={LABEL}>Test with a sample payload (optional)</label>
              <textarea
                value={sample}
                onChange={(e) => setSample(e.target.value)}
                rows={5}
                spellCheck={false}
                className={`${FIELD} font-mono text-[10px]`}
                placeholder='{"id":"1","name":"Ravi","phone":"+91…","company":"G Mart","message":"Need a roller mill"}'
              />
              <div className="mt-1 flex items-center gap-2">
                <Button size="sm" variant="secondary" icon={<Sparkles size={12} />} disabled={busy || !sample.trim()} onClick={runPreview}>
                  Preview mapping
                </Button>
                <span className="text-[10px] text-[var(--text-tertiary)]">Nothing is saved — this only shows what would be ingested.</span>
              </div>
              {preview ? (
                <div className="mt-2 rounded-lg border border-[var(--border-card)] bg-[var(--surface-sunken)] p-2">
                  <p className="text-[10px] font-bold text-[var(--text-primary)]">
                    {preview.events.length} event{preview.events.length === 1 ? "" : "s"} recognised
                  </p>
                  <ul className="mt-1 space-y-0.5 text-[10px] text-[var(--text-secondary)]">
                    {preview.events.slice(0, 3).map((ev, i) => (
                      <li key={i} className="truncate">
                        {String(ev.title ?? "—")} · {String(ev.company ?? "")} {String(ev.phone ?? "")}
                      </li>
                    ))}
                  </ul>
                  {preview.warnings.map((w, i) => (
                    <p key={i} className="mt-1 text-[10px] text-[var(--color-warning)]">{w}</p>
                  ))}
                </div>
              ) : null}
            </div>
          ) : (
            <p className="rounded-lg bg-[var(--surface-sunken)] p-2 text-[10px] leading-relaxed text-[var(--text-secondary)]">
              In Tally: open the form → <b>Integrations → Webhooks</b> → add this URL. Tally signs every call with the secret you get on the next
              step; submissions already collected can be backfilled later from this panel.
            </p>
          )}

          <div className="flex items-center gap-2 pt-1">
            <Button size="sm" variant="ghost" icon={<ArrowLeft size={12} />} onClick={() => setStep("pick")}>
              Back
            </Button>
            <span className="flex-1" />
            <Button size="sm" variant="primary" icon={busy ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} disabled={busy} onClick={create}>
              {busy ? "Connecting…" : "Create connection"}
            </Button>
          </div>
        </div>
      ) : null}

      {step === "done" && created ? (
        <div className="space-y-4">
          <div className="rounded-lg border border-[color-mix(in_srgb,var(--color-success)_35%,transparent)] bg-[color-mix(in_srgb,var(--color-success)_8%,transparent)] p-3">
            <p className="flex items-center gap-1.5 text-xs font-bold text-[var(--text-primary)]">
              <Check size={14} className="text-[var(--color-success)]" /> Paste this URL into {entry?.name ?? "the service"}
            </p>
            <code className="mt-2 block break-all rounded-md bg-[var(--bg-card)] px-2 py-1.5 text-[10px] text-[var(--text-primary)]">{created.source.webhookUrl}</code>
            <Button size="sm" variant="secondary" className="mt-2" icon={<Copy size={12} />} onClick={() => copy("url", created.source.webhookUrl)}>
              {copied === "url" ? "Copied" : "Copy webhook URL"}
            </Button>
          </div>

          {created.signingSecret ? (
            <div>
              <p className={LABEL}>Signing secret</p>
              <code className="block break-all rounded-md bg-[var(--surface-sunken)] px-2 py-1.5 text-[10px] text-[var(--text-primary)]">{created.signingSecret}</code>
              <div className="mt-1 flex items-center gap-2">
                <Button size="sm" variant="ghost" icon={<Copy size={12} />} onClick={() => copy("secret", created.signingSecret)}>
                  {copied === "secret" ? "Copied" : "Copy secret"}
                </Button>
                <span className="text-[10px] text-[var(--text-tertiary)]">Shown once — it verifies every call's signature.</span>
              </div>
            </div>
          ) : null}

          <p className="text-[10px] leading-relaxed text-[var(--text-secondary)]">
            Send one test submission now — it should appear in the feed within a second, and again under the connection's <b>Deliveries</b> with the
            exact body the service sent. That is the fastest way to confirm the mapping.
          </p>

          <div className="flex justify-end">
            <Button size="sm" variant="primary" onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      ) : null}
    </Drawer>
  );
}
