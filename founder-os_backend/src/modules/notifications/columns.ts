// ─────────────────────────────────────────────────────────────────────────────
// modules/notifications/columns.ts — the REAL result headers of an authored SQL
// (PURE).
//
// Why this exists: the founder should never have to guess what a query returns.
// After a dry run we know the actual column names (from the rows), so the
// console can offer `{HOURLY_CONNECTED_CALL}` as a clickable token instead of
// asking for hand-typed mustache keys.
//
// Order is SQL order: first appearance across the rows, so the token list reads
// like the SELECT list the author wrote.
// ─────────────────────────────────────────────────────────────────────────────

/** Column names in first-seen order (union across rows — a later row may carry
 *  a key the first one omitted). Identity keys are put last: they are the
 *  engine's contract, not message material. */
export function resultColumns(rows: Array<Record<string, unknown>> | null | undefined): string[] {
  const seen: string[] = [];
  const have = new Set<string>();
  for (const row of rows ?? []) {
    if (!row || typeof row !== 'object') continue;
    for (const key of Object.keys(row)) {
      const k = String(key);
      if (have.has(k)) continue;
      have.add(k);
      seen.push(k);
    }
  }
  return seen;
}

/** Columns worth offering as `{TOKEN}`s: the person key and the level are
 *  engine plumbing, not message text. */
export function messageColumns(columns: string[]): string[] {
  const plumbing = new Set(['telecaller_id', 'employee_key', 'level', 'severity', 'escalation_level', 'escalationlevel']);
  return (columns ?? []).filter((c) => !plumbing.has(String(c).toLowerCase()));
}

/** `{hourly_connected_call}` — uppercase, non-word chars to underscores. */
export function columnToken(column: string): string {
  return String(column ?? '')
    .trim()
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
}
