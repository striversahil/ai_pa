/**
 * Debtors Tracker — customer situation (CRM follow-up state).
 * Per-customer tag set by CRM/sales or accounts from the Customer Ageing tab,
 * plus a free-text CRM remarks field. Stored on PaymentCustomer so it
 * survives re-imports (imports never touch these columns).
 */
export const CUSTOMER_SITUATIONS = [
  'NOT_ANSWERING',
  'BUSY',
  'CALLBACK',
  'PROMISED_TO_PAY',
  'DISPUTED',
  'PAID_CLOSED',
] as const;

export type CustomerSituation = (typeof CUSTOMER_SITUATIONS)[number];

export const CUSTOMER_SITUATION_LABELS: Record<CustomerSituation, string> = {
  NOT_ANSWERING: 'Not answering',
  BUSY: 'Busy',
  CALLBACK: 'Callback',
  PROMISED_TO_PAY: 'Promised to pay',
  DISPUTED: 'Disputed',
  PAID_CLOSED: 'Paid / Closed',
};

export function situationLabel(situation: string): string {
  const key = String(situation || '').trim().toUpperCase();
  return (CUSTOMER_SITUATION_LABELS as Record<string, string>)[key] ?? '';
}

/** Normalize to a valid enum value or '' (unset). */
export function normalizeCustomerSituation(raw: unknown): string {
  const key = String(raw ?? '').trim().toUpperCase();
  return (CUSTOMER_SITUATIONS as readonly string[]).includes(key) ? key : '';
}

export function isValidCustomerSituationInput(raw: unknown): boolean {
  const s = String(raw ?? '').trim();
  return s === '' || (CUSTOMER_SITUATIONS as readonly string[]).includes(s.toUpperCase());
}
