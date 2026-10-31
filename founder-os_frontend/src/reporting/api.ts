/**
 * api.ts — Reporting Sheet HTTP surface.
 * Mirrors founder-os_backend/src/worker/routes/reporting-sheet.ts.
 */
import type {
  AutofillResult, RegionOrderRow, ReportDepartment, ReportEntryView,
  ReportOrigin, ReportSection, ReportingCapabilities, ReportingPayload,
  TelecallerRow,
} from "./types";

async function jsonOrThrow<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as any)?.error || `Request failed (${res.status})`);
  return body as T;
}

/** Viewer-filtered weekly payload (departments the session may open). */
export async function getReportingSheet(period?: string): Promise<ReportingPayload> {
  const qs = period ? `?period=${encodeURIComponent(period)}` : "";
  const res = await fetch(`/api/automations/reporting-sheet/data${qs}`, { cache: "no-store" });
  return jsonOrThrow<ReportingPayload>(res);
}

/** Live-source suggestion for one section — never writes. */
export async function getAutofill(
  dept: ReportDepartment, section: ReportSection, period: string,
): Promise<AutofillResult> {
  const qs = `?dept=${encodeURIComponent(dept)}&section=${encodeURIComponent(section)}&period=${encodeURIComponent(period)}`;
  const res = await fetch(`/api/reporting/autofill${qs}`, { cache: "no-store" });
  return jsonOrThrow<AutofillResult>(res);
}

export async function saveReportSection(
  period: string, dept: ReportDepartment, section: ReportSection,
  body: {
    payload: Record<string, unknown>;
    telecallerRows: TelecallerRow[];
    regionOrders: RegionOrderRow[];
    origin: ReportOrigin;
  },
): Promise<ReportEntryView> {
  const res = await fetch(
    `/api/reporting/week/${encodeURIComponent(period)}/${encodeURIComponent(dept)}/${encodeURIComponent(section)}`,
    { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
  );
  const out = await jsonOrThrow<{ entry: ReportEntryView }>(res);
  return out.entry;
}

export async function getCapabilities(): Promise<ReportingCapabilities> {
  const res = await fetch("/api/reporting/capabilities", { cache: "no-store" });
  return jsonOrThrow<ReportingCapabilities>(res);
}

export async function getFilledPeriods(): Promise<string[]> {
  const res = await fetch("/api/reporting/filled", { cache: "no-store" });
  const body = await jsonOrThrow<{ filled: string[] }>(res);
  return body.filled ?? [];
}
