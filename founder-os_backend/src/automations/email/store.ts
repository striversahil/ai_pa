// automations/email/store.ts — persistence ONLY (raw D1 via env.DB, so the
// Worker build needs no Prisma shim registration for these tables).

import type { EmailAccount, OutboxItem } from './types';

type D1 = { prepare: (q: string) => any };

function rid(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

function rowToAccount(r: any): EmailAccount {
  return {
    id: String(r.id), label: String(r.label), email: String(r.email),
    provider: 'gmail', status: r.status === 'revoked' ? 'revoked' : 'active',
    createdAt: String(r.createdAt), updatedAt: String(r.updatedAt),
  };
}

function rowToOutbox(r: any): OutboxItem {
  const j = (s: string) => { try { const v = JSON.parse(String(s)); return Array.isArray(v) ? v : []; } catch { return []; } };
  return {
    id: String(r.id), accountId: String(r.accountId),
    to: j(r.toAddrs), cc: j(r.cc), bcc: j(r.bcc),
    subject: String(r.subject), body: String(r.body), html: Number(r.isHtml) === 1,
    status: r.status, dueAt: Number(r.dueAt), repeatDailyAt: String(r.repeatDailyAt ?? ''),
    attempts: Number(r.attempts), lastError: String(r.lastError ?? ''),
    createdAt: String(r.createdAt),
  };
}

export async function listAccounts(db: D1): Promise<EmailAccount[]> {
  const rs = await db.prepare('SELECT * FROM EmailAccount ORDER BY createdAt ASC').all().catch(() => ({ results: [] }));
  return ((rs as any)?.results ?? []).map(rowToAccount);
}

export async function getAccount(db: D1, id: string): Promise<EmailAccount | null> {
  const r = await db.prepare('SELECT * FROM EmailAccount WHERE id = ?').bind(id).first().catch(() => null);
  return r ? rowToAccount(r) : null;
}

/** Find by address (case-insensitive) or create a pending row for OAuth. */
export async function findOrCreateAccountByEmail(db: D1, email: string, label: string): Promise<EmailAccount> {
  const addr = email.trim().toLowerCase();
  if (!addr) throw new Error('email is required to start OAuth');
  const r = await db.prepare('SELECT * FROM EmailAccount WHERE lower(email) = ?').bind(addr).first().catch(() => null);
  if (r) return rowToAccount(r);
  return createAccount(db, label || addr, addr);
}

export async function createAccount(db: D1, label: string, email: string): Promise<EmailAccount> {
  const id = rid();
  await db.prepare(
    'INSERT INTO EmailAccount (id, label, email, provider, status) VALUES (?, ?, ?, ?, ?)',
  ).bind(id, label.slice(0, 80), email.toLowerCase(), 'gmail', 'active').run();
  return (await getAccount(db, id))!;
}

export async function setAccountStatus(db: D1, id: string, status: 'active' | 'revoked'): Promise<void> {
  await db.prepare(`UPDATE EmailAccount SET status = ?, updatedAt = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`)
    .bind(status, id).run();
}

export async function enqueue(db: D1, accountId: string, m: {
  to: string[]; cc?: string[]; bcc?: string[]; subject: string; body: string; html?: boolean;
}, dueAt: number, repeatDailyAt: string): Promise<OutboxItem> {
  const id = rid();
  await db.prepare(
    `INSERT INTO EmailOutbox (id, accountId, toAddrs, cc, bcc, subject, body, isHtml, status, dueAt, repeatDailyAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?)`,
  ).bind(id, accountId, JSON.stringify(m.to), JSON.stringify(m.cc ?? []), JSON.stringify(m.bcc ?? []),
    m.subject, m.body, m.html ? 1 : 0, dueAt, repeatDailyAt).run();
  const r = await db.prepare('SELECT * FROM EmailOutbox WHERE id = ?').bind(id).first();
  return rowToOutbox(r);
}

/** CAS-claim up to `limit` due rows (queued + due + attempts left). */
export async function claimDue(db: D1, now: number, limit = 10): Promise<OutboxItem[]> {
  const rs = await db.prepare(
    'SELECT * FROM EmailOutbox WHERE status = ? AND dueAt <= ? AND attempts < 5 ORDER BY dueAt ASC LIMIT ?',
  ).bind('queued', now, limit).all().catch(() => ({ results: [] }));
  const claimed: OutboxItem[] = [];
  for (const r of ((rs as any)?.results ?? [])) {
    const upd: any = await db.prepare(
      `UPDATE EmailOutbox SET status = 'sending', updatedAt = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id = ? AND status = 'queued'`,
    ).bind(String((r as any).id)).run().catch(() => null);
    if (upd && Number(upd?.meta?.changes ?? 0) > 0) claimed.push(rowToOutbox(r));
  }
  return claimed;
}

export async function resolveOutbox(
  db: D1, id: string, ok: boolean, error: string, nextDueAt: number | null,
): Promise<void> {
  if (ok && nextDueAt) {
    // Daily repeat: back to queued for tomorrow, attempts reset.
    await db.prepare(
      `UPDATE EmailOutbox SET status='queued', dueAt=?, attempts=0, lastError='',
       updatedAt=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`,
    ).bind(nextDueAt, id).run();
    return;
  }
  await db.prepare(
    `UPDATE EmailOutbox SET status=?, attempts=attempts+1, lastError=?,
     updatedAt=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`,
  ).bind(ok ? 'sent' : 'failed', error.slice(0, 500), id).run();
  if (!ok) {
    // 5 strikes → dead (stops retrying, stays visible for inspection).
    await db.prepare(`UPDATE EmailOutbox SET status='dead' WHERE id=? AND attempts >= 5`).bind(id).run();
  }
}

export async function listOutbox(db: D1, limit = 50): Promise<OutboxItem[]> {
  const rs = await db.prepare('SELECT * FROM EmailOutbox ORDER BY dueAt DESC LIMIT ?').bind(limit).all().catch(() => ({ results: [] }));
  return ((rs as any)?.results ?? []).map(rowToOutbox);
}

export async function cancelOutbox(db: D1, id: string): Promise<boolean> {
  const upd: any = await db.prepare(
    `UPDATE EmailOutbox SET status='cancelled', updatedAt=strftime('%Y-%m-%dT%H:%M:%fZ','now')
     WHERE id=? AND (status='queued' OR status='failed')`,
  ).bind(id).run().catch(() => null);
  return Number(upd?.meta?.changes ?? 0) > 0;
}

export async function addLog(db: D1, e: {
  accountId: string; action: string; to: string[]; subject: string; gmailId: string; ok: boolean; error: string;
}): Promise<void> {
  await db.prepare(
    'INSERT INTO EmailLog (id, accountId, action, toAddrs, subject, gmailId, ok, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).bind(rid(), e.accountId, e.action, JSON.stringify(e.to), e.subject.slice(0, 300),
    e.gmailId, e.ok ? 1 : 0, e.error.slice(0, 500)).run().catch(() => {});
}

export async function listLog(db: D1, limit = 50): Promise<any[]> {
  const rs = await db.prepare('SELECT * FROM EmailLog ORDER BY createdAt DESC LIMIT ?').bind(limit).all().catch(() => ({ results: [] }));
  return ((rs as any)?.results ?? []).map((r: any) => ({
    id: String(r.id), accountId: String(r.accountId), action: String(r.action),
    to: String(r.toAddrs), subject: String(r.subject), gmailId: String(r.gmailId),
    ok: Number(r.ok) === 1, error: String(r.error ?? ''), createdAt: String(r.createdAt),
  }));
}

/** Next 03:00-IST-safe due: tomorrow at HH:MM IST → epoch ms. */
export function nextDailyDueIst(hhmm: string, fromMs: number): number {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
  if (!m) throw new Error('repeatDailyAt must be HH:MM (24h, IST)');
  const istNow = new Date(fromMs + 5.5 * 3600_000);
  const y = istNow.getUTCFullYear(), mo = istNow.getUTCMonth(), d = istNow.getUTCDate();
  let due = Date.UTC(y, mo, d, Number(m[1]), Number(m[2])) - 5.5 * 3600_000;
  if (due <= fromMs) due += 86_400_000;
  return due;
}
