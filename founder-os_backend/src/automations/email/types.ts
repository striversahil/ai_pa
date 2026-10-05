// automations/email/types.ts — shapes + provider contract for the modular
// email service. Mirror: none (backend-only v1; a frontend card can reuse
// these names later). Providers implement EmailProvider; Gmail is the first.

export type EmailAccountStatus = 'active' | 'revoked';

export interface EmailAccount {
  id: string;
  label: string;
  email: string;
  provider: 'gmail';
  status: EmailAccountStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ComposeInput {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
  /** true = text/html part; false = text/plain (default). */
  html?: boolean;
}

export type OutboxStatus = 'queued' | 'sending' | 'sent' | 'failed' | 'dead' | 'cancelled';

export interface OutboxItem extends ComposeInput {
  id: string;
  accountId: string;
  status: OutboxStatus;
  /** epoch ms when the tick may send it. */
  dueAt: number;
  /** "HH:MM" IST — after each send, reschedules for next day at this time. */
  repeatDailyAt: string;
  attempts: number;
  lastError: string;
  createdAt: string;
}

export interface DraftSummary {
  id: string;
  threadId: string;
  snippet: string;
  subject: string;
  to: string;
  date: string;
}

export interface SendResult {
  ok: boolean;
  gmailId: string;
}

/** Minimal token vault so Worker (KV) and Express (memory/env) share logic. */
export interface TokenStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

/** Provider contract — Gmail implements it now; SMTP/Graph plug in later. */
export interface EmailProvider {
  readonly name: 'gmail';
  oauthStartUrl(args: { clientId: string; redirectUri: string; state: string }): string;
  exchangeCode(args: {
    clientId: string; clientSecret: string; redirectUri: string; code: string;
  }): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }>;
  refreshAccessToken(args: {
    clientId: string; clientSecret: string; refreshToken: string;
  }): Promise<{ accessToken: string; expiresIn: number }>;
  getProfile(accessToken: string): Promise<{ email: string }>;
  sendRaw(accessToken: string, rawBase64Url: string): Promise<{ gmailId: string }>;
  createDraftRaw(accessToken: string, rawBase64Url: string): Promise<{ draftId: string }>;
  listDrafts(accessToken: string, max?: number): Promise<DraftSummary[]>;
  deleteDraft(accessToken: string, draftId: string): Promise<void>;
}

/** Build a single-part RFC822 message and return base64url (edge-safe). */
export function buildRawMessage(from: string, m: ComposeInput): string {
  const encSubject = `=?UTF-8?B?${b64Encode(m.subject)}?=`;
  const headers = [
    `From: ${from}`,
    `To: ${m.to.join(', ')}`,
    ...(m.cc?.length ? [`Cc: ${m.cc.join(', ')}`] : []),
    ...(m.bcc?.length ? [`Bcc: ${m.bcc.join(', ')}`] : []),
    `Subject: ${encSubject}`,
    'MIME-Version: 1.0',
    `Content-Type: ${m.html ? 'text/html' : 'text/plain'}; charset=UTF-8`,
    'Content-Transfer-Encoding: base64',
    '',
    '',
  ];
  // The trailing '' pair is the mandatory blank line between the header
  // block and the body — without it Gmail swallows the body (shows empty).
  const ascii = headers.join('\r\n') + b64Encode(m.body).replace(/.{76}/g, '$&\r\n');
  return b64UrlEncode(ascii);
}

function b64Encode(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

function b64UrlEncode(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeAddrs(list: unknown): string[] {
  const arr = Array.isArray(list) ? list : typeof list === 'string' ? list.split(',') : [];
  const out = [...new Set(arr.map((a) => String(a).trim().toLowerCase()).filter(Boolean))];
  for (const a of out) {
    if (!EMAIL_RE.test(a) || a.length > 254) throw new Error(`invalid email address: ${a}`);
  }
  return out;
}

export function validateCompose(m: Partial<ComposeInput>): ComposeInput {
  const to = normalizeAddrs((m as any)?.to);
  if (to.length === 0) throw new Error('to is required (at least one address)');
  if (to.length > 50) throw new Error('to limited to 50 recipients per mail');
  const cc = normalizeAddrs((m as any)?.cc ?? []);
  const bcc = normalizeAddrs((m as any)?.bcc ?? []);
  const subject = String((m as any)?.subject ?? '').trim().slice(0, 500);
  if (!subject) throw new Error('subject is required');
  const body = String((m as any)?.body ?? '').slice(0, 500_000);
  if (!body.trim()) throw new Error('body is required');
  return { to, cc, bcc, subject, body, html: !!(m as any)?.html };
}
