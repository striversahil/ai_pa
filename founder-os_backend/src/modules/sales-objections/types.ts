// types.ts — Sales Objections shapes (Sales → Objections tab).
//
// One concern per file: shapes + category list live here; persistence lives
// in store.ts; HTTP in worker/routes/sales-objections.ts. Mirror: the
// frontend copy lives in founder-os_frontend/src/sales-objections/types.ts.

export const OBJECTION_CATEGORIES = [
  'price',
  'delivery',
  'quality',
  'competition',
  'payment_terms',
  'other',
] as const;

export type ObjectionCategory = (typeof OBJECTION_CATEGORIES)[number];

export const OBJECTION_CATEGORY_LABEL: Record<ObjectionCategory, string> = {
  price: 'Price',
  delivery: 'Delivery',
  quality: 'Quality',
  competition: 'Competition',
  payment_terms: 'Payment terms',
  other: 'Other',
};

export interface SalesObjectionReply {
  id: string;
  objectionId: string;
  text: string;
  createdBy: string;
  createdByName: string;
  createdAt: string;
}

export interface SalesObjection {
  id: string;
  estNumber: string;
  clientName: string;
  category: ObjectionCategory;
  detail: string;
  status: 'open' | 'resolved';
  createdBy: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  replies?: SalesObjectionReply[];
}

export function isObjectionCategory(v: unknown): v is ObjectionCategory {
  return (OBJECTION_CATEGORIES as readonly string[]).includes(String(v ?? ''));
}

export function cleanObjectionInput(body: any): { ok: true; value: { estNumber: string; clientName: string; category: ObjectionCategory; detail: string } } | { ok: false; error: string } {
  const estNumber = String(body?.estNumber ?? '').trim().slice(0, 100);
  const clientName = String(body?.clientName ?? '').trim().slice(0, 200);
  if (!estNumber && !clientName) return { ok: false, error: 'estimate number or client name required' };
  const category = isObjectionCategory(body?.category) ? (body.category as ObjectionCategory) : 'other';
  const detail = String(body?.detail ?? '').trim().slice(0, 2000);
  if (!detail) return { ok: false, error: 'objection detail required' };
  return { ok: true, value: { estNumber, clientName, category, detail } };
}
