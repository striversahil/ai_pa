// vault.ts — AES-256-GCM for instance secrets. WebCrypto only, so the same
// code runs in the Worker and in Node 18+ (guards, runners).
//
// The key is VAULT_KEY. When it is unset we derive from SHARED_SECRET and log
// a warning once: rotating VAULT_KEY makes existing ciphertext undecryptable,
// which is a re-entry operation, never a silent one.

const enc = new TextEncoder();
const dec = new TextDecoder();
let warnedFallback = false;

function b64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
  return btoa(out);
}

function unb64(text: string): Uint8Array {
  const raw = atob(text);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function vaultKey(env: Record<string, unknown> | undefined): string {
  const key = String(env?.VAULT_KEY ?? '').trim();
  if (key) return key;
  const shared = String(env?.SHARED_SECRET ?? '').trim();
  if (!shared) throw new Error('vault: VAULT_KEY and SHARED_SECRET are both unset');
  if (!warnedFallback) {
    warnedFallback = true;
    console.warn('[vault] VAULT_KEY unset — deriving the instance vault key from SHARED_SECRET');
  }
  return shared;
}

async function aesKey(secret: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(secret));
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

/** JSON map of secret name → value, sealed as one opaque string. */
export async function encryptSecrets(
  secrets: Record<string, string>,
  secret: string,
): Promise<string> {
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(secrets ?? {})) {
    const value = String(v ?? '').trim();
    if (value) clean[k] = value;
  }
  if (!Object.keys(clean).length) return '';
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await aesKey(secret),
    enc.encode(JSON.stringify(clean)),
  );
  return JSON.stringify({ v: 1, iv: b64(iv), ct: b64(new Uint8Array(sealed)) });
}

export async function decryptSecrets(
  cipher: string,
  secret: string,
): Promise<Record<string, string>> {
  if (!cipher) return {};
  let parsed: { iv?: string; ct?: string };
  try {
    parsed = JSON.parse(cipher);
  } catch {
    return {};
  }
  if (!parsed?.iv || !parsed?.ct) return {};
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: unb64(parsed.iv) as unknown as BufferSource },
      await aesKey(secret),
      unb64(parsed.ct) as unknown as BufferSource,
    );
    return JSON.parse(dec.decode(plain)) as Record<string, string>;
  } catch {
    // Wrong/rotated key or tampered row: behave like 'no secrets' rather than
    // throwing a crypto error at every call site.
    return {};
  }
}

/** Deep-redact a value for logs: never print a secret back into an error. */
export function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (!value || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = /secret|token|password|apikey|api_key|authorization/i.test(k) ? '***' : redactSecrets(v);
  }
  return out;
}
