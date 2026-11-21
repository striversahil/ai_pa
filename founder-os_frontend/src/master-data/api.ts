/**
 * api.ts — Customer master HTTP surface.
 * Mirrors founder-os_backend/src/worker/routes/master-data.ts.
 */

import type {
  CustomerPatch, EditorEntry, MasterCapabilities, MasterCustomer, MasterCustomerDetail,
  MasterImportResult, MasterSummary, DuplicateReview, TypeBaseEntry,
} from "./types";
import { pagedUrl } from "@/lib/paging";

async function jsonOrThrow<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as any)?.error || `Request failed (${res.status})`);
  return body as T;
}

/** Paged customer list (usePagedQuery base URL) — founder paging standard. */
export const CUSTOMERS_URL = "/api/master-data/customers";

/** Header, region tabs, KPI tiles + filter options (COUNT/GROUP BY, cached). */
export async function getMasterSummary(region: string, state: string): Promise<MasterSummary> {
  const res = await fetch(pagedUrl("/api/master-data/summary", { region, state }), { cache: "no-store" });
  return jsonOrThrow<MasterSummary>(res);
}

/** Duplicate-review rows for one region (the review tab groups them). */
export async function getDuplicateRows(region: string): Promise<MasterCustomer[]> {
  const res = await fetch(pagedUrl("/api/master-data/duplicates", { region }), { cache: "no-store" });
  return (await jsonOrThrow<{ rows: MasterCustomer[] }>(res)).rows ?? [];
}

/** Every row the current filters match — for the CSV export only. */
export async function exportCustomers(params: Record<string, string | number | undefined>): Promise<MasterCustomer[]> {
  const res = await fetch(pagedUrl("/api/master-data/export", params), { cache: "no-store" });
  return (await jsonOrThrow<{ rows: MasterCustomer[] }>(res)).rows ?? [];
}

export async function getMasterCustomer(id: string): Promise<MasterCustomerDetail> {
  const res = await fetch(`/api/master-data/customers/${encodeURIComponent(id)}`, { cache: "no-store" });
  const body = await jsonOrThrow<{ customer: MasterCustomerDetail }>(res);
  return body.customer;
}

export async function patchMasterCustomer(id: string, patch: CustomerPatch): Promise<MasterCustomerDetail> {
  const res = await fetch(`/api/master-data/customers/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  const body = await jsonOrThrow<{ customer: MasterCustomerDetail }>(res);
  return body.customer;
}

/** Hard delete (managers only). Pipeline rows are refused server-side — the
 *  caller surfaces the error and suggests Inactive instead. */
export async function deleteMasterCustomer(id: string): Promise<{ id: string; name: string }> {
  const res = await fetch(`/api/master-data/customers/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  return jsonOrThrow<{ id: string; name: string }>(res);
}

export async function setDuplicateReview(
  group: string,
  review: DuplicateReview,
): Promise<{ group: string; review: DuplicateReview; changed: number }> {
  const res = await fetch(`/api/master-data/duplicates/${encodeURIComponent(group)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ review }),
  });
  return jsonOrThrow(res);
}

export async function listEditors(): Promise<EditorEntry[]> {
  const res = await fetch("/api/master-data/editors", { cache: "no-store" });
  const body = await jsonOrThrow<{ editors: EditorEntry[] }>(res);
  return body.editors ?? [];
}

export async function setEditor(userId: string, canEdit: boolean): Promise<EditorEntry> {
  const res = await fetch(`/api/master-data/editors/${encodeURIComponent(userId)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ canEdit }),
  });
  const body = await jsonOrThrow<{ editor: EditorEntry }>(res);
  return body.editor;
}

export async function importMasterData(file: unknown): Promise<MasterImportResult> {
  const res = await fetch("/api/master-data/import", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(file),
  });
  return jsonOrThrow<MasterImportResult>(res);
}

export async function getCapabilities(): Promise<MasterCapabilities> {
  const res = await fetch("/api/master-data/capabilities", { cache: "no-store" });
  return jsonOrThrow<MasterCapabilities>(res);
}

/** Sales-head's allowed client-type vocabulary (view-gated; appointed editors
 *  can read it for the drawer dropdown — writes stay manager-only). */
export async function getTypeBases(): Promise<TypeBaseEntry[]> {
  const res = await fetch("/api/master-data/type-bases", { cache: "no-store" });
  const body = await jsonOrThrow<{ bases: TypeBaseEntry[] }>(res);
  return body.bases ?? [];
}
