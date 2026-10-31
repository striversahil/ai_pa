"use client";

// ImportModal — re-import the Zoho master extract (same shape as
// data/master_data.json). Upsert-only: rows missing from the file are never
// deleted and local edits (notes, duplicate review) survive.
import { useMemo, useRef, useState } from "react";
import { importMasterData } from "@/master-data/api";
import type { MasterImportResult } from "@/master-data/types";
import { Modal, PrimaryButton } from "./ui";

interface Preview {
  customers: number;
  regions: string[];
  summaryRows: number;
  bytes: number;
}

function previewOf(json: any, bytes: number): Preview {
  let customers = 0;
  const regions: string[] = [];
  const grouped = json?.regions;
  if (grouped && typeof grouped === "object" && !Array.isArray(grouped)) {
    for (const [region, list] of Object.entries(grouped)) {
      if (!Array.isArray(list)) continue;
      regions.push(region);
      customers += list.length;
    }
  } else if (Array.isArray(json?.customers)) {
    customers = json.customers.length;
  } else if (Array.isArray(json)) {
    customers = json.length;
  }
  return {
    customers,
    regions: regions.sort(),
    summaryRows: Array.isArray(json?.summary) ? json.summary.length : 0,
    bytes,
  };
}

export default function ImportModal({
  open, onClose, onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: (result: MasterImportResult) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [json, setJson] = useState<unknown>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<MasterImportResult | null>(null);

  const preview = useMemo(
    () => (json ? previewOf(json as any, file?.size ?? 0) : null),
    [json, file],
  );

  const reset = () => {
    setFile(null);
    setJson(null);
    setParseError(null);
    setError(null);
    setResult(null);
    setBusy(false);
    if (inputRef.current) inputRef.current.value = "";
  };

  const close = () => {
    if (busy) return;
    reset();
    onClose();
  };

  const pick = async (f: File | null) => {
    setResult(null);
    setError(null);
    setParseError(null);
    setJson(null);
    setFile(f);
    if (!f) return;
    if (!/\.json$/i.test(f.name)) {
      setParseError("Choose the .json master extract (not CSV).");
      return;
    }
    try {
      const text = await f.text();
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== "object") throw new Error("not a JSON object");
      setJson(parsed);
    } catch (e: any) {
      setParseError(`Could not read the file: ${e?.message || "invalid JSON"}`);
    }
  };

  const submit = async () => {
    if (!json) return;
    setBusy(true);
    setError(null);
    try {
      const res = await importMasterData(json);
      setResult(res);
      onDone(res);
    } catch (e: any) {
      setError(e?.message || "Import failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="Import customer master"
      subtitle="Re-import the Zoho extract. Existing rows are updated in place — nothing is deleted."
      dismissable={!busy}
      footer={
        result ? (
          <div className="flex justify-end">
            <PrimaryButton onClick={close}>Done</PrimaryButton>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-[var(--text-tertiary)]">Max 12 MB · JSON only</span>
            <PrimaryButton onClick={submit} disabled={!json || busy}>
              {busy ? "Importing…" : "Import"}
            </PrimaryButton>
          </div>
        )
      }
    >
      {result ? (
        <div className="space-y-3">
          <p className="rounded-[var(--radius-control)] bg-[color-mix(in_srgb,var(--color-success)_12%,transparent)] px-3 py-2 text-label font-semibold text-[var(--color-success)]">
            Import complete — {result.received.toLocaleString("en-IN")} customers processed.
          </p>
          <div className="grid grid-cols-2 gap-2 text-label">
            {[
              ["Inserted", result.inserted],
              ["Updated", result.updated],
              ["Skipped (no id/name)", result.skipped],
              ["Regions", result.regions],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-[var(--radius-control)] bg-[var(--surface-soft)] px-3 py-2">
                <p className="text-[10px] uppercase tracking-wide text-[var(--text-tertiary)]">{label}</p>
                <p className="font-semibold text-[var(--text-primary)]">{Number(value).toLocaleString("en-IN")}</p>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-[var(--text-secondary)]">
            Notes and duplicate-review decisions were left untouched for every existing row.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <label className="flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-[var(--radius-card)] border border-dashed border-[var(--color-zinc-300)] bg-[var(--surface-sunken)] px-4 py-8 text-center transition-colors hover:border-[var(--color-brand-indigo)]">
            <span className="text-2xl">📄</span>
            <span className="text-label font-semibold text-[var(--text-primary)]">
              {file ? file.name : "Choose the master_data.json extract"}
            </span>
            <span className="text-[11px] text-[var(--text-secondary)]">
              {file ? `${(file.size / 1024 / 1024).toFixed(2)} MB` : "Click to browse — the file never leaves this request"}
            </span>
            <input
              ref={inputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => void pick(e.target.files?.[0] ?? null)}
            />
          </label>

          {parseError && (
            <p className="rounded-[var(--radius-control)] bg-[color-mix(in_srgb,var(--color-danger)_10%,transparent)] px-3 py-2 text-label text-[var(--color-danger)]">{parseError}</p>
          )}
          {error && (
            <p className="rounded-[var(--radius-control)] bg-[color-mix(in_srgb,var(--color-danger)_10%,transparent)] px-3 py-2 text-label text-[var(--color-danger)]">{error}</p>
          )}

          {preview && (
            <div className="rounded-[var(--radius-control)] border border-[var(--border-card)] px-3 py-2.5 text-label">
              <p className="font-semibold text-[var(--text-primary)]">
                {preview.customers.toLocaleString("en-IN")} customers in {preview.regions.length} region{preview.regions.length === 1 ? "" : "s"}
              </p>
              <p className="mt-0.5 text-[11px] text-[var(--text-secondary)]">
                {preview.regions.join(" · ") || "No region blocks found"}
                {preview.summaryRows ? ` · ${preview.summaryRows} summary rows` : ""}
              </p>
            </div>
          )}

          <ul className="list-disc space-y-1 pl-5 text-[11px] text-[var(--text-secondary)]">
            <li>Rows are matched on the Zoho customer id — re-importing the same file changes nothing.</li>
            <li>Local notes, editor corrections and duplicate-review decisions are preserved.</li>
            <li>Rows missing from the file are kept, never deleted.</li>
          </ul>
        </div>
      )}
    </Modal>
  );
}
