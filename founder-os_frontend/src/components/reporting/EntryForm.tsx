"use client";

// EntryForm — descriptor-driven entry form for one reporting section.
//
// Renders the scalar fields from fields.ts plus the two tabular blocks
// (telecaller rows, region orders). Auto-fill pulls the live suggestion;
// any change after a pre-fill marks the save `adjusted`, a save straight
// after pre-fill is `autofill`, untouched hand entry is `manual`.
import { useEffect, useMemo, useState } from "react";
import type {
  AutofillResult, RegionOrderRow, ReportDepartment, ReportEntryView,
  ReportOrigin, ReportSection, TelecallerRow,
} from "@/reporting/types";
import { getSectionDef, type ReportFieldDef } from "@/reporting/fields";
import { getAutofill } from "@/reporting/api";

const inputClass =
  "w-full rounded-[var(--radius-control)] border border-[var(--border-card)] bg-[var(--bg-input)] px-3 py-2 text-label text-[var(--text-primary)] outline-none transition-colors placeholder:text-[var(--text-tertiary)] focus:border-[var(--color-brand-indigo)]";

function FieldInput({
  def, value, onChange, disabled,
}: {
  def: ReportFieldDef;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  const common = {
    className: inputClass,
    value,
    disabled,
    onChange: (e: any) => onChange(e.target.value),
    placeholder: def.type === "number" || def.type === "money" ? "0" : "",
  };
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
        {def.label}
        {def.auto && <span className="rounded bg-[var(--bg-input)] px-1 py-px text-[9px] font-bold normal-case text-[var(--color-info)]">auto</span>}
        {def.locked && <span className="text-[9px] font-normal normal-case">locked</span>}
      </span>
      {def.type === "textarea" ? (
        <textarea rows={2} {...common} onChange={(e) => onChange(e.target.value)} />
      ) : def.type === "text" ? (
        <input {...common} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input inputMode="decimal" {...common} onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, ""))} />
      )}
      {def.hint && <span className="text-[10px] text-[var(--text-tertiary)]">{def.hint}</span>}
    </label>
  );
}

export default function EntryForm({
  dept, section, period, entry, canEdit, onSaved,
}: {
  dept: ReportDepartment;
  section: ReportSection;
  period: string;
  entry: ReportEntryView | null;
  canEdit: boolean;
  onSaved: () => void;
}) {
  const def = getSectionDef(dept, section);
  const [values, setValues] = useState<Record<string, string>>({});
  const [teleRows, setTeleRows] = useState<TelecallerRow[]>([]);
  const [regionRows, setRegionRows] = useState<RegionOrderRow[]>([]);
  const [origin, setOrigin] = useState<ReportOrigin>("manual");
  const [prefilled, setPrefilled] = useState(false);
  const [autoBusy, setAutoBusy] = useState(false);
  const [autoInfo, setAutoInfo] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset when switching section / week / entry.
  useEffect(() => {
    const v: Record<string, string> = {};
    for (const f of def?.fields ?? []) {
      const raw = entry?.payload?.[f.key];
      v[f.key] = raw === undefined || raw === null ? "" : String(raw);
    }
    setValues(v);
    setTeleRows(entry?.telecallerRows ?? []);
    setRegionRows(entry?.regionOrders ?? []);
    setOrigin("manual");
    setPrefilled(false);
    setAutoInfo(null);
    setError(null);
  }, [dept, section, period, entry, def]);

  const locked = useMemo(() => !canEdit, [canEdit]);
  if (!def) return null;

  const touch = (next: Record<string, string>, rows?: TelecallerRow[], regions?: RegionOrderRow[]) => {
    setValues(next);
    if (rows) setTeleRows(rows);
    if (regions) setRegionRows(regions);
    if (prefilled) setOrigin("adjusted");
  };

  const set = (key: string, value: string) => touch({ ...values, [key]: value });

  const autofill = async () => {
    setAutoBusy(true);
    setError(null);
    try {
      const res: AutofillResult = await getAutofill(dept, section, period);
      const v: Record<string, string> = {};
      for (const f of def.fields) {
        const hit = res.payload[f.key];
        v[f.key] = hit === undefined || hit === null ? (values[f.key] ?? "") : String(hit);
      }
      setValues(v);
      if (def.rows === "telecaller") {
        setTeleRows(res.telecallerRows);
        setRegionRows(res.regionOrders);
      }
      setOrigin("autofill");
      setPrefilled(true);
      const empty = res.autoKeys.length === 0 && res.telecallerRows.length === 0;
      setAutoInfo(empty
        ? `No live numbers for this week yet (${res.sources.join("; ") || "source empty"}) — enter by hand.`
        : `Pre-filled from ${res.sources.join(" + ")} (${res.from} → ${res.to}). Confirm or adjust, then save.`);
    } catch (e: any) {
      setError(e?.message || "Auto-fill failed — enter by hand.");
    } finally {
      setAutoBusy(false);
    }
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {};
      for (const f of def.fields) {
        const raw = (values[f.key] ?? "").trim();
        if (!raw) continue;
        payload[f.key] = f.type === "number" || f.type === "money" ? Number(raw) : raw;
      }
      const { saveReportSection } = await import("@/reporting/api");
      await saveReportSection(period, dept, section, {
        payload, telecallerRows: teleRows, regionOrders: regionRows, origin,
      });
      onSaved();
    } catch (e: any) {
      setError(e?.message || "Could not save this section");
    } finally {
      setSaving(false);
    }
  };

  const setTele = (i: number, key: "connected" | "leads", value: string) => {
    const n = Math.max(0, Math.floor(Number(value) || 0));
    touch(values, teleRows.map((r, j) => (j === i ? { ...r, [key]: n } : r)));
  };

  const setRegion = (i: number, key: "orders" | "value", value: string) => {
    const n = Math.max(0, Math.floor(Number(value) || 0));
    touch(values, undefined, regionRows.map((r, j) => (j === i ? { ...r, [key]: n } : r)));
  };

  return (
    <div className="space-y-3">
      {def.autofill && canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void autofill()}
            disabled={autoBusy}
            className="rounded-[var(--radius-control)] border border-[var(--color-info)]/40 bg-[color-mix(in_srgb,var(--color-info)_10%,transparent)] px-3 py-1.5 text-[11px] font-semibold text-[var(--color-info)] transition-opacity hover:opacity-80 disabled:opacity-50"
          >
            {autoBusy ? "Pulling live numbers…" : "↻ Auto-fill from dashboards"}
          </button>
          {prefilled && (
            <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-info)]">
              pre-filled — {origin === "autofill" ? "untouched" : "adjusted by you"}
            </span>
          )}
        </div>
      )}
      {autoInfo && (
        <p className="rounded-[var(--radius-control)] bg-[var(--surface-soft)] px-3 py-2 text-[11px] text-[var(--text-secondary)]">{autoInfo}</p>
      )}
      {error && (
        <p className="rounded-[var(--radius-control)] bg-[color-mix(in_srgb,var(--color-danger)_10%,transparent)] px-3 py-2 text-label text-[var(--color-danger)]">{error}</p>
      )}

      {def.rows === "telecaller" && (
        <div className="overflow-x-auto rounded-[var(--radius-control)] border border-[var(--border-card)]">
          <table className="w-full min-w-[460px] border-collapse text-sm">
            <thead>
              <tr className="bg-[var(--surface-soft)] text-left text-[10px] uppercase tracking-wide text-[var(--text-tertiary)]">
                <th className="px-3 py-2 font-semibold">Telecaller</th>
                <th className="px-3 py-2 text-right font-semibold">Connected</th>
                <th className="px-3 py-2 text-right font-semibold">Leads</th>
                <th className="px-3 py-2 text-right font-semibold" title="Connected ÷ 7 days">Avg / day</th>
              </tr>
            </thead>
            <tbody>
              {teleRows.length === 0 && (
                <tr><td colSpan={4} className="px-3 py-3 text-center text-[11px] text-[var(--text-tertiary)]">
                  No rows yet — auto-fill from the NeoDove report or add rows below.
                </td></tr>
              )}
              {teleRows.map((r, i) => (
                <tr key={`${r.name}-${i}`} className="border-t border-[var(--border-card)]">
                  <td className="px-3 py-1.5">
                    {locked ? (
                      <span className="text-label text-[var(--text-primary)]">{r.name}</span>
                    ) : (
                      <input
                        className={inputClass}
                        value={r.name}
                        onChange={(e) => touch(values, teleRows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                      />
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    {locked ? (
                      <span className="font-semibold text-[var(--text-primary)]">{r.connected}</span>
                    ) : (
                      <input
                        className={`${inputClass} text-right`} inputMode="numeric"
                        value={String(r.connected)}
                        onChange={(e) => setTele(i, "connected", e.target.value)}
                      />
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    {locked ? (
                      <span className="font-semibold text-[var(--text-primary)]">{r.leads}</span>
                    ) : (
                      <input
                        className={`${inputClass} text-right`} inputMode="numeric"
                        value={String(r.leads)}
                        onChange={(e) => setTele(i, "leads", e.target.value)}
                      />
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-right text-[11px] text-[var(--text-secondary)]">{(r.connected / 7).toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
            {teleRows.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-[var(--border-card)] bg-[var(--surface-soft)] font-semibold">
                  <td className="px-3 py-2 text-[var(--text-primary)]">Total</td>
                  <td className="px-3 py-2 text-right text-[var(--text-primary)]">{teleRows.reduce((t, r) => t + r.connected, 0).toLocaleString("en-IN")}</td>
                  <td className="px-3 py-2 text-right text-[var(--text-primary)]">{teleRows.reduce((t, r) => t + r.leads, 0).toLocaleString("en-IN")}</td>
                  <td className="px-3 py-2 text-right text-[11px] text-[var(--text-secondary)]">{(teleRows.reduce((t, r) => t + r.connected, 0) / 7).toFixed(1)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      {def.rows === "telecaller" && regionRows.length > 0 && (
        <div className="overflow-x-auto rounded-[var(--radius-control)] border border-[var(--border-card)]">
          <table className="w-full min-w-[420px] border-collapse text-sm">
            <thead>
              <tr className="bg-[var(--surface-soft)] text-left text-[10px] uppercase tracking-wide text-[var(--text-tertiary)]">
                <th className="px-3 py-2 font-semibold">Region</th>
                <th className="px-3 py-2 text-right font-semibold">Orders received</th>
                <th className="px-3 py-2 text-right font-semibold">Value (₹)</th>
              </tr>
            </thead>
            <tbody>
              {regionRows.map((r, i) => (
                <tr key={r.region} className="border-t border-[var(--border-card)]">
                  <td className="px-3 py-1.5 font-semibold text-[var(--text-primary)]">{r.region}</td>
                  <td className="px-3 py-1.5 text-right">
                    {locked ? (
                      <span className="font-semibold text-[var(--text-primary)]">{r.orders}</span>
                    ) : (
                      <input className={`${inputClass} text-right`} inputMode="numeric" value={String(r.orders)} onChange={(e) => setRegion(i, "orders", e.target.value)} />
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    {locked ? (
                      <span className="text-[var(--text-primary)]">₹{r.value.toLocaleString("en-IN")}</span>
                    ) : (
                      <input className={`${inputClass} text-right`} inputMode="decimal" value={String(r.value)} onChange={(e) => setRegion(i, "value", e.target.value)} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {def.fields.map((f) => (
          <div key={f.key} className={f.type === "textarea" ? "sm:col-span-2" : ""}>
            {locked ? (
              <div>
                <p className="text-[10px] uppercase tracking-wide text-[var(--text-tertiary)]">{f.label}</p>
                <p className="mt-0.5 break-words text-label text-[var(--text-primary)]">
                  {values[f.key] || <span className="text-[var(--text-tertiary)]">—</span>}
                </p>
              </div>
            ) : (
              <FieldInput def={f} value={values[f.key] ?? ""} onChange={(v) => set(f.key, v)} disabled={!!f.locked} />
            )}
          </div>
        ))}
      </div>

      {canEdit && (
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="rounded-[var(--radius-control)] bg-[var(--color-brand-indigo)] px-4 py-2 text-label font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "Saving…" : entry ? "Save changes" : "Submit section"}
          </button>
        </div>
      )}
    </div>
  );
}
