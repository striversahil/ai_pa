// Extracted verbatim from intake.ts by scripts/refactor/split-module.mjs.
// intake.ts re-exports everything public here, so existing imports keep working.


export interface IntakeCtx {
  env: Record<string, unknown>;
  me: any;
  who: string;
  /** Volatile conversation id (client-minted; '' = legacy user-wide memory). */
  session: string;
}

export interface IntakeDraft {
  /** Prior filing receipt: update this exact rate when present. */
  rateId?: string;
  productId?: string;
  productName?: string;
  productCategory?: string;
  vendorId?: string;
  vendorName?: string;
  vendorType?: string;
  vendorPhone?: string;
  vendorLocation?: string;
  price?: number;
  unit?: string;
  discount?: number;
  moq?: string;
  delivery?: number;
  weight?: number;
  packQty?: string;
  packDims?: string;
  quotedAt?: string;
  specs: Record<string, string>;
  /** Non-spec vendor extras (delivery notes, stray details matching no KYP
   *  key) — stored on the rate, never as spec keys. */
  notes?: string;
}

export interface FiledRate {
  rateId: string;
  updated: boolean;
  product: string;
  vendor: string;
  missing: string[];
}
