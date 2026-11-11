// sales-objections/types.ts — Objections board shapes.
// Mirror of founder-os_backend/src/modules/sales-objections/types.ts —
// keep the category list + labels in sync on both sides.

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
