// Pure validation/formatting for the HR hiring kit (JD/SOP documents per
// position). Framework-free: no DB, HTTP or Node imports — safe inside the
// Worker bundle and reused by hiring-positions.ts (persistence).
import { HrError } from './errors';

export const HIRING_DOC_KINDS = ['jd', 'sop'] as const;
export type HiringDocKind = (typeof HIRING_DOC_KINDS)[number];

/** KV accepts 25MB; keep headroom like the CRM SO attachments. */
export const MAX_HIRING_DOC_BYTES = 20 * 1024 * 1024;
export const MAX_POSITION_NAME_LENGTH = 80;
export const MAX_IMPORT_POSITIONS = 200;

export function isHiringDocKind(value: unknown): value is HiringDocKind {
  return value === 'jd' || value === 'sop';
}

/** Display name: trimmed, inner whitespace collapsed. */
export function cleanPositionName(value: unknown): string {
  const name = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!name) throw new HrError('Position name is required');
  if (name.length > MAX_POSITION_NAME_LENGTH) {
    throw new HrError(`Position name is too long (max ${MAX_POSITION_NAME_LENGTH} characters)`);
  }
  return name;
}

/** Identity key for de-duplication: "Sales Executive" == "sales-executive". */
export function positionNameKey(value: unknown): string {
  const key = cleanPositionName(value).toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!key) throw new HrError('Position name must contain letters or digits');
  return key;
}

export function isPdfUpload(fileName: unknown, mime: unknown): boolean {
  const type = String(mime ?? '').toLowerCase();
  return type === 'application/pdf' || /\.pdf$/i.test(String(fileName ?? ''));
}

/** Human title for the card row — filename without extension by default. */
export function defaultDocTitle(fileName: unknown, kind: HiringDocKind): string {
  const base = String(fileName ?? '')
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return (base || (kind === 'sop' ? 'SOP' : 'Job description')).slice(0, 200);
}

/** Normalises an import payload into unique, valid position names. */
export function cleanImportNames(values: unknown): string[] {
  const list = Array.isArray(values) ? values : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list.slice(0, MAX_IMPORT_POSITIONS)) {
    let name: string;
    let key: string;
    try {
      name = cleanPositionName(raw);
      key = positionNameKey(name);
    } catch {
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}
