// missing.ts — what a vendor quote still has to answer.
//
// One pure function, two readers: the rates sheet (server-computed per row, so
// the "Missing (3)" badge and its tooltip are always truthful) and
// `refreshMissingSpecs` (re-fills `VendorRate.missingSpecs` when the catalogue's
// required list changes, so the `incomplete` filter cannot drift).
//
// mirror: founder-os_frontend/src/product-line/filters.ts#missingFields
// (guard `kyp-schema` compares both implementations on the same fixture).

export interface MissingContract {
  props: Record<string, { label?: string }>;
  required: string[];
}

export interface MissingRateInput {
  attrValues?: Record<string, unknown> | string | null;
  unit?: unknown;
  moq?: unknown;
  pricePerUnit?: unknown;
  deliveryDays?: unknown;
  quotedAt?: unknown;
}

/** Envelope fields every quote must answer, in display order. */
export const ENVELOPE_MISSING = [
  'Unit of sale',
  'MOQ',
  'Price per unit',
  'Delivery time',
  'Date added',
] as const;

function hasValue(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === 'string') return v.trim() !== '';
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

function specDoc(raw: MissingRateInput['attrValues']): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
  try {
    const v = JSON.parse(String(raw));
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Human labels of every unanswered required field — specs first, then envelope. */
export function missingFieldsFor(rate: MissingRateInput, product: MissingContract | null): string[] {
  const doc = specDoc(rate.attrValues);
  const out: string[] = [];
  if (product) {
    for (const key of product.required) {
      if (!hasValue(doc[key])) out.push(product.props?.[key]?.label ?? key);
    }
  }
  const envelope: [string, unknown][] = [
    [ENVELOPE_MISSING[0], rate.unit],
    [ENVELOPE_MISSING[1], rate.moq],
    [ENVELOPE_MISSING[2], rate.pricePerUnit && Number(rate.pricePerUnit) > 0 ? rate.pricePerUnit : null],
    [ENVELOPE_MISSING[3], rate.deliveryDays === null || rate.deliveryDays === undefined ? null : rate.deliveryDays],
    [ENVELOPE_MISSING[4], rate.quotedAt],
  ];
  for (const [label, value] of envelope) {
    if (!hasValue(value)) out.push(label);
  }
  return out;
}
