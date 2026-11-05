// ── Device tokens + one-time pairing codes ──────────────────────────────────
// Only the SHA-256 hash of a device token is stored. Pair codes are short,
// human-typed, single-use and expire quickly.
import { sha256Hex } from './parse';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const b64 = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return 'fc_' + b64;
}

export async function hashToken(token: string): Promise<string> {
  return sha256Hex(token);
}

export function randomPairCode(length = 8): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

export function normalizePairCode(raw: unknown): string {
  return String(raw ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
}
