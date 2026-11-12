// Extracted verbatim from client-segments.ts by scripts/refactor/split-module.mjs.
// client-segments.ts re-exports everything public here, so existing imports keep working.


export type ClientSegmentKind = 'consumer' | 'reseller' | '';

export interface ClientCandidate {
  id: string;
  name: string;
  typeBase: string;
  region: string;
  state: string;
}

export interface ClientClass {
  /** Normalised client key (normalizeClientKey of the estimate name). */
  key: string;
  displayName: string;
  segment: ClientSegmentKind;
  /** manual = sales-head override; auto = master match; none = needs review. */
  source: 'manual' | 'auto' | 'none';
  masterCustomerId: string;
  masterName: string;
  /** Master region (R1–R4, '' when unmatched) — drives sales-head direct re-homing. */
  masterRegion: string;
  matchKind: 'exact' | 'fuzzy-unique' | 'fuzzy-best' | 'ambiguous' | 'none' | 'manual';
  candidates: ClientCandidate[];
}

export interface ClientQueueRow {
  key: string;
  displayName: string;
  segment: ClientSegmentKind;
  source: 'manual' | 'auto' | 'none';
  masterName: string;
  matchKind: string;
  candidates: ClientCandidate[];
  regions: string[];
  estimateCount: number;
  acceptedCount: number;
  acceptedValue: number;
  declinedCount: number;
  declinedValue: number;
  estimates: Array<{
    estimateId: string;
    estimateNumber: string;
    customerName: string;
    total: number;
    region: string;
    status: string;
    day: string;
  }>;
}

export interface MasterEntry {
  id: string;
  displayName: string;
  companyName: string;
  typeBase: string;
  region: string;
  state: string;
}

// ── Matching (pure) ─────────────────────────────────────────────────────────

export interface MasterIndex {
  exact: Map<string, number[]>;
  tokenIdx: Map<string, Set<number>>;
  tokenSets: string[][];
}
