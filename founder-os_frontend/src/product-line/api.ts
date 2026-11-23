// api.ts — every Product Line call in one place (components never fetch).
import { api } from "@/api/client";
import type {
  BatchDetail,
  GuideRow,
  ImportPreview,
  ImportResult,
  LiveCatalog,
  Paged,
  Payload,
  ProductRow,
  PromptPayload,
  RateBatchRow,
  RateDetail,
  RateRow,
  VendorDecision,
  VendorRow,
} from "./types";

const BASE = "/product-line";

export interface CatalogWrite {
  name?: string;
  category?: string;
  aliases?: string[];
  key?: string;
  active?: boolean;
}

export interface GuideWrite {
  productId?: string;
  question?: string;
  guideNote?: string | null;
  isRequired?: boolean;
  sortOrder?: number;
  type?: string;
  enum?: string[] | null;
  min?: number | null;
  max?: number | null;
  /** Default answer for a new quote (enum member / number / boolean). */
  default?: string | number | boolean | null;
  condition?: unknown;
  active?: boolean;
}

export const productLineApi = {
  /** Workspace payload: products + guide rows + vendors + counted totals. */
  payload: () => api.get<Payload>(`/session/workspaces/product-line/data`),
  /** Live catalogue (typed specs) — what the editors + export read. */
  catalog: () => api.get<LiveCatalog>(`${BASE}/catalog`),

  createProduct: (body: CatalogWrite) => api.post<ProductRow>(`${BASE}/products`, body),
  updateProduct: (id: string, body: CatalogWrite) => api.patch<ProductRow>(`${BASE}/products/${id}`, body),
  deleteProduct: (id: string) => api.del<{ ok: true }>(`${BASE}/products/${id}`),
  renameCategory: (from: string, to: string) => api.post<{ updated: number }>(`${BASE}/categories/rename`, { from, to }),

  createGuide: (body: GuideWrite) => api.post<GuideRow>(`${BASE}/guide`, body),
  updateGuide: (id: string, body: GuideWrite) => api.patch<GuideRow>(`${BASE}/guide/${id}`, body),
  deleteGuide: (id: string) => api.del<{ ok: true }>(`${BASE}/guide/${id}`),
  reorderGuide: (productId: string, ids: string[]) => api.post<{ ok: true }>(`${BASE}/guide/reorder`, { productId, ids }),

  createVendor: (body: Partial<VendorRow>) => api.post<VendorRow>(`${BASE}/vendors`, body),
  updateVendor: (id: string, body: Partial<VendorRow>) => api.patch<VendorRow>(`${BASE}/vendors/${id}`, body),
  deleteVendor: (id: string) => api.del<{ ok: true }>(`${BASE}/vendors/${id}`),

  rateDetail: (id: string) => api.get<RateDetail>(`${BASE}/rates/${id}`),
  createRate: (body: Record<string, unknown>) => api.post<RateRow>(`${BASE}/rates`, body),
  updateRate: (id: string, body: Record<string, unknown>) => api.patch<RateRow>(`${BASE}/rates/${id}`, body),
  deleteRate: (id: string) => api.del<{ ok: true }>(`${BASE}/rates/${id}`),
  setRateActive: (id: string, active: boolean) => api.patch<{ ok: true }>(`${BASE}/rates/${id}`, { active }),

  // Categories: add one ahead of products, rename everywhere, drop an empty one.
  addCategory: (name: string) => api.post<{ name: string; categories: string[] }>(`${BASE}/categories`, { name }),
  deleteCategory: (name: string) =>
    api.del<{ removed: string; categories: string[] }>(`${BASE}/categories/${encodeURIComponent(name)}`),

  // The rate-intake prompt (editable, saved, copied with the vendor list filled).
  prompt: () => api.get<PromptPayload>(`${BASE}/prompt`),
  savePrompt: (template: string) => api.post<{ template: string; isDefault: boolean }>(`${BASE}/prompt`, { template }),
  resetPrompt: () => api.del<{ template: string; isDefault: boolean }>(`${BASE}/prompt`),
  /** Phase 1: resolve + typecheck, writes nothing. */
  previewImport: (json: string) => api.post<ImportPreview>(`${BASE}/rates/import/preview`, { json }),
  /** Phase 2: land it under one batch, using the operator's vendor decisions. */
  importRates: (json: string, vendors: VendorDecision[], label?: string) =>
    api.post<ImportResult>(`${BASE}/rates/import`, { json, vendors, label }),

  /** The paste log (newest first) and one batch's quotes. */
  batches: (limit = 100) => api.get<{ batches: RateBatchRow[] }>(`${BASE}/batches?limit=${limit}`),
  batch: (id: string) => api.get<BatchDetail>(`${BASE}/batches/${id}`),
  deleteBatch: (id: string) => api.del<{ deleted: number; batchId: string }>(`${BASE}/batches/${id}`),
};

/**
 * KYP JSON download. The schema is built server-side from the LIVE catalogue, so
 * what downloads is what the system currently typechecks against.
 */
export async function downloadKypSchema(): Promise<string> {
  const res = await fetch("/api/product-line/schema.json");
  if (!res.ok) {
    const msg = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(String((msg as any)?.error ?? "could not export"));
  }
  const blob = await res.blob();
  const dispo = res.headers.get("content-disposition") ?? "";
  const name = /filename="([^"]+)"/.exec(dispo)?.[1] ?? "bui_milling_vendor_kyp_schema.json";
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return name;
}
