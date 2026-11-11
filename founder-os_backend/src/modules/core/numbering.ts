// modules/core/numbering.ts — gapless document numbers per entity/prefix.
// Phase 0 stub. Phase 3+ implements next_number() inside the creating D1 batch
// against core_doc_series (D1 batch is atomic; runners serialize per entity).
export interface NumberingInput {
  entityType: string;
  prefix: string;
  padding?: number;
}

export function formatNumber(prefix: string, next: number, padding = 5): string {
  return `${prefix}${String(next).padStart(padding, '0')}`;
}

export function maxNumberLength(prefix: string, next: number, padding = 5): number {
  return formatNumber(prefix, next, padding).length;
}

export function assertGstNumberLength(_docNo: string): void {
  void _docNo;
}
