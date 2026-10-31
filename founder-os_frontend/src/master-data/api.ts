/**
 * api.ts — Customer master HTTP surface.
 * Mirrors founder-os_backend/src/worker/routes/master-data.ts.
 */

import type {
  CustomerPatch, EditorEntry, MasterCapabilities, MasterCustomerDetail,
  MasterDataPayload, MasterImportResult, DuplicateReview,
} from "./types";

async function jsonOrThrow<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as any)?.error || `Request failed (${res.status})`);
  return body as T;
}

/** Dashboard payload — one KV-cached read of the whole book. */
export async function getMasterData(): Promise<MasterDataPayload> {
  const res = await fetch("/api/automations/master-data/data", { cache: "no-store" });
  return jsonOrThrow<MasterDataPayload>(res);
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
