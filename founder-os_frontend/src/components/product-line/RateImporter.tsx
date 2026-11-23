"use client";

// RateImporter.tsx — a paste, a review, then a batch.
//
// Phase 1 (Preview) resolves every row against the live catalogue and shows the
// vendors that would have to be CREATED — nothing is written. Phase 2 (Import)
// lands the accepted rows with the operator's vendor decisions and stamps them
// with one RateBatch, so the whole paste can be inspected or undone later.
//
// The agent is asked to pick `vendor` from the active list and to set
// `is_new_vendor: true` only when it invented one; a name that exists in the
// master is treated as matched whatever the flag says.
import React, { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ClipboardPaste, Copy, History, Plus, Upload, X } from "lucide-react";
import { Drawer } from "@/components/ui";
import { field, fmtINR, ghostBtn, iconBtn, label, panel, primaryBtn } from "../product-line-dashboard/helpers";
import { productLineApi } from "@/product-line/api";
import type { ImportPreview, NewVendorCandidate, VendorDecision, VendorRow } from "@/product-line/types";

const errMsg = (e: unknown) => String((e as any)?.message ?? "import failed");
const VENDOR_TYPES = ["manufacturer", "distributor", "trader"];

type Choice = "create" | "skip" | "map";

interface Props {
  vendors: VendorRow[];
  onClose: () => void;
  onChanged: () => void;
  onCopyPrompt: () => void;
  onOpenBatches: () => void;
}

export function RateImporter({ vendors, onClose, onChanged, onCopyPrompt, onOpenBatches }: Props) {
  const [text, setText] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [drafts, setDrafts] = useState<Record<string, NewVendorCandidate>>({});
  const [mapTo, setMapTo] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{ batchId: string; created: number; failed: number } | null>(null);

  const reset = () => {
    setPreview(null);
    setResult(null);
    setErr(null);
    setChoices({});
    setDrafts({});
    setMapTo({});
  };

  const preview_ = async () => {
    if (!text.trim()) return;
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      const out = await productLineApi.previewImport(text);
      setPreview(out);
      const nextChoices: Record<string, Choice> = {};
      const nextDrafts: Record<string, NewVendorCandidate> = {};
      for (const v of out.newVendors) {
        nextChoices[v.name] = "create";
        nextDrafts[v.name] = { ...v };
      }
      setChoices(nextChoices);
      setDrafts(nextDrafts);
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const decisions: VendorDecision[] = useMemo(() => {
    if (!preview) return [];
    return preview.newVendors.map((v) => {
      const action = choices[v.name] ?? "skip";
      const d = drafts[v.name] ?? v;
      return {
        name: v.name,
        action,
        ...(action === "map" ? { vendorId: mapTo[v.name] ?? "" } : {}),
        ...(action === "create"
          ? {
              location: d.location,
              contactPerson: d.contactPerson,
              contactPhone1: d.contactPhone1,
              contactPhone2: d.contactPhone2,
              address: d.address,
              yearEstablished: d.yearEstablished,
              vendorType: d.vendorType,
            }
          : {}),
      };
    });
  }, [preview, choices, drafts, mapTo]);

  /** Rows that will NOT land because their (new) vendor is being skipped. */
  const skippedNames = useMemo(() => {
    if (!preview) return new Set<string>();
    return new Set(
      preview.newVendors
        .filter((v) => (choices[v.name] ?? "skip") === "skip")
        .map((v) => v.name.toLowerCase()),
    );
  }, [preview, choices]);
  const importable = useMemo(() => {
    if (!preview) return 0;
    return preview.rows.filter((r) => r.ok && !skippedNames.has(r.vendor.toLowerCase())).length;
  }, [preview, skippedNames]);

  const blocked = useMemo(() => {
    if (!preview) return 0;
    return preview.newVendors.filter((v) => {
      const c = choices[v.name] ?? "skip";
      if (c === "map" && !mapTo[v.name]) return true;
      return false;
    }).length;
  }, [preview, choices, mapTo]);

  const runImport = async () => {
    if (!preview) return;
    setBusy(true);
    setErr(null);
    try {
      const out = await productLineApi.importRates(text, decisions, label.trim() || undefined);
      setResult({ batchId: out.batchId, created: out.created, failed: out.failed.length });
      onChanged();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const setDraft = (name: string, patch: Partial<NewVendorCandidate>) =>
    setDrafts((d) => ({ ...d, [name]: { ...(d[name] ?? ({} as NewVendorCandidate)), ...patch } }));

  const willCreate = decisions.filter((d) => d.action === "create").length;

  return (
    <Drawer
      title="Paste AI rates"
      subtitle={
        result
          ? `batch ${result.batchId.slice(0, 10)}… created`
          : preview
            ? `${preview.okCount} of ${preview.total} rows ready · ${preview.newVendors.length} vendor${preview.newVendors.length === 1 ? "" : "s"} to decide`
            : "paste the { rates: [ … ] } block the assistant returned"
      }
      onClose={onClose}
      width="max-w-4xl"
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={ghostBtn} onClick={() => void navigator.clipboard.readText().then(setText).catch(() => setErr("clipboard blocked — use Ctrl+V in the box"))}>
            <ClipboardPaste size={13} /> Paste
          </button>
          <button type="button" className={ghostBtn} onClick={onCopyPrompt}>
            <Copy size={13} /> Copy the prompt
          </button>
          {preview || result ? (
            <button type="button" className={ghostBtn} onClick={reset}>
              <X size={13} /> Start over
            </button>
          ) : null}
          <span className="ml-auto text-[10px] text-[var(--text-tertiary)]">one paste is capped at 500 rows</span>
        </div>

        {!preview && !result ? (
          <>
            <div>
              <span className={label}>Agent answer</span>
              <textarea
                className={`${field} min-h-[300px] font-mono text-[11px] leading-5`}
                spellCheck={false}
                placeholder={'{"rates": [ { "product_key": "milling_fabric", "vendor": "…", "is_new_vendor": false, … } ] }'}
                value={text}
                onChange={(e) => { setText(e.target.value); setErr(null); }}
              />
            </div>
            <div>
              <span className={label}>Label this batch (optional — shows in the batch log)</span>
              <input className={field} placeholder="e.g. Shreeji Nov-2026 rate list" value={label} onChange={(e) => setLabel(e.target.value)} />
            </div>
          </>
        ) : null}

        {err ? (
          <div className="flex items-start gap-2 text-xs font-semibold text-[var(--color-danger)] bg-[var(--bg-input)] rounded-xl px-3 py-2">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {err}
          </div>
        ) : null}

        {preview ? (
          <>
            <div className="flex flex-wrap items-center gap-3 text-[11px] font-semibold">
              <span className="inline-flex items-center gap-1 text-emerald-600">
                <CheckCircle2 size={12} /> {preview.okCount} ready
              </span>
              {preview.errorCount ? (
                <span className="inline-flex items-center gap-1 text-[var(--color-danger)]">
                  <AlertTriangle size={11} /> {preview.errorCount} rejected
                </span>
              ) : null}
              <span className="text-[var(--text-tertiary)]">
                {preview.matchedVendors.length} vendor{preview.matchedVendors.length === 1 ? "" : "s"} matched
              </span>
              {skippedNames.size ? (
                <span className="text-[var(--text-tertiary)]">{preview.okCount - importable} will be skipped</span>
              ) : null}
            </div>

            {/* New vendors — the only thing that needs a human decision */}
            {preview.newVendors.length ? (
              <div className={`${panel} p-3 space-y-3`}>
                <div className="flex items-center gap-2">
                  <span className={label}>New vendors the agent invented — {willCreate} will be created</span>
                  <span className="ml-auto text-[10px] text-[var(--text-tertiary)]">nothing is created unless you say so</span>
                </div>
                {preview.newVendors.map((v) => {
                  const choice = choices[v.name] ?? "skip";
                  const d = drafts[v.name] ?? v;
                  return (
                    <div key={v.name} className="rounded-xl border border-[var(--border-card)] p-2.5 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[12px] font-extrabold text-[var(--text-primary)]">{v.name}</span>
                        <span className="text-[10px] text-[var(--text-tertiary)]">{v.rows} row{v.rows === 1 ? "" : "s"}</span>
                        <div className="ml-auto flex items-center gap-1">
                          {(["create", "map", "skip"] as Choice[]).map((c) => (
                            <button
                              key={c}
                              type="button"
                              onClick={() => setChoices((x) => ({ ...x, [v.name]: c }))}
                              className={`px-2 py-1 rounded-lg text-[10px] font-bold border ${
                                choice === c
                                  ? c === "skip"
                                    ? "border-[var(--color-danger)] text-[var(--color-danger)] bg-[color-mix(in_srgb,var(--color-danger)_10%,transparent)]"
                                    : "border-brand-indigo text-brand-indigo bg-brand-indigo/10"
                                  : "border-[var(--border-card)] text-[var(--text-tertiary)]"
                              }`}
                            >
                              {c === "create" ? "Create new" : c === "map" ? "Map to existing" : "Skip"}
                            </button>
                          ))}
                        </div>
                      </div>

                      {choice === "create" ? (
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                          <div><span className={label}>Vendor name</span>
                            <input className={field} value={d.name} onChange={(e) => setDraft(v.name, { name: e.target.value })} /></div>
                          <div><span className={label}>City / location</span>
                            <input className={field} value={d.location} onChange={(e) => setDraft(v.name, { location: e.target.value })} /></div>
                          <div><span className={label}>Type</span>
                            <select className={field} value={d.vendorType} onChange={(e) => setDraft(v.name, { vendorType: e.target.value })}>
                              {VENDOR_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                            </select></div>
                          <div><span className={label}>Contact person</span>
                            <input className={field} value={d.contactPerson} onChange={(e) => setDraft(v.name, { contactPerson: e.target.value })} /></div>
                          <div><span className={label}>Phone 1</span>
                            <input className={field} value={d.contactPhone1} onChange={(e) => setDraft(v.name, { contactPhone1: e.target.value })} /></div>
                          <div><span className={label}>Phone 2</span>
                            <input className={field} value={d.contactPhone2} onChange={(e) => setDraft(v.name, { contactPhone2: e.target.value })} /></div>
                          <div className="col-span-2"><span className={label}>Address</span>
                            <input className={field} value={d.address} onChange={(e) => setDraft(v.name, { address: e.target.value })} /></div>
                          <div><span className={label}>Year established</span>
                            <input className={field} inputMode="numeric" value={d.yearEstablished ?? ""}
                              onChange={(e) => setDraft(v.name, { yearEstablished: e.target.value === "" ? null : Number(e.target.value) })} /></div>
                        </div>
                      ) : choice === "map" ? (
                        <div>
                          <span className={label}>Existing vendor</span>
                          <select className={field} value={mapTo[v.name] ?? ""} onChange={(e) => setMapTo((m) => ({ ...m, [v.name]: e.target.value }))}>
                            <option value="">Select a vendor…</option>
                            {vendors.map((ev) => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
                          </select>
                        </div>
                      ) : (
                        <p className="text-[10.5px] text-[var(--text-tertiary)]">
                          Rows for this vendor will be rejected — pick “Map to existing” if it is already in the master under another name.
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : null}

            {/* Row resolution */}
            <div className={`${panel} overflow-hidden`}>
              <div className="grid grid-cols-[36px_minmax(0,1.3fr)_minmax(0,1fr)_90px_1fr] gap-2 px-3 py-1.5 border-b border-[var(--border-card)] text-[9.5px] font-bold uppercase tracking-wider text-[var(--text-tertiary)]">
                <span>#</span><span>Product</span><span>Vendor</span><span className="text-right">Price</span><span>Status</span>
              </div>
              <div className="max-h-64 overflow-y-auto divide-y divide-[var(--border-card)]/50">
                {preview.rows.map((r) => (
                  <div key={r.index} className="grid grid-cols-[36px_minmax(0,1.3fr)_minmax(0,1fr)_90px_1fr] gap-2 px-3 py-1 items-center">
                    <span className="text-[10px] tabular-nums text-[var(--text-tertiary)]">{r.index}</span>
                    <span className="min-w-0">
                      <span className="block text-[11px] font-bold text-[var(--text-primary)] truncate">{r.productLabel ?? r.productKey ?? "—"}</span>
                      {r.productKey ? <span className="block text-[9px] font-mono text-[var(--text-tertiary)] truncate">{r.productKey}</span> : null}
                    </span>
                    <span className="min-w-0 text-[10.5px] text-[var(--text-secondary)] truncate">
                      {r.vendor || "—"}
                      {r.isNewVendor ? <span className="ml-1 text-[9px] font-bold text-amber-600">new</span> : null}
                    </span>
                    <span className="text-right text-[10.5px] tabular-nums text-[var(--text-primary)]">{fmtINR(r.price)}</span>
                    <span className="min-w-0 text-[10px]">
                      {r.ok ? (
                        <span className="inline-flex items-center gap-1 font-bold text-emerald-600"><CheckCircle2 size={10} /> ready</span>
                      ) : (
                        <span className="block text-[var(--color-danger)] font-semibold truncate" title={r.error}>{r.error}</span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : null}

        {result ? (
          <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/5 p-3 space-y-2">
            <div className="flex items-center gap-2 text-xs font-bold text-emerald-700">
              <CheckCircle2 size={14} /> {result.created} vendor rates imported
              {result.failed ? <span className="text-[var(--color-danger)]">· {result.failed} rejected</span> : null}
            </div>
            <div className="text-[10.5px] text-[var(--text-tertiary)]">
              Saved as batch <span className="font-mono">{result.batchId}</span> — open the batch log to review or undo it.
            </div>
            <button type="button" className={ghostBtn} onClick={onOpenBatches}>
              <History size={13} /> Open batch log
            </button>
          </div>
        ) : null}

        <div className="flex items-center gap-2 border-t border-[var(--border-card)] pt-3">
          {!preview && !result ? (
            <button type="button" className={primaryBtn} disabled={busy || !text.trim()} onClick={() => void preview_()}>
              <Upload size={13} /> {busy ? "Checking…" : "Preview rows"}
            </button>
          ) : null}
          {preview && !result ? (
            <button type="button" className={primaryBtn} disabled={busy || blocked > 0 || importable === 0} onClick={() => void runImport()}>
              <Plus size={13} /> {busy ? "Importing…" : `Import ${importable} row${importable === 1 ? "" : "s"}`}
            </button>
          ) : null}
          <button type="button" className={ghostBtn} onClick={onClose}>Close</button>
          {blocked ? (
            <span className="ml-auto text-[10px] font-semibold text-[var(--color-danger)]">
              pick an existing vendor for {blocked} “map” decision{blocked === 1 ? "" : "s"}
            </span>
          ) : null}
        </div>
      </div>
    </Drawer>
  );
}
