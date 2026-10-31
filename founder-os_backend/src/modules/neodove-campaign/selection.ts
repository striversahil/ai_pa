// selection.ts — pure lead selection for a region + state.
//
// No I/O: the caller hands in raw MasterCustomer rows and gets back the exact
// list NeoDove would receive, plus every skipped row with a reason. Keeping
// this pure is what makes the dry run trustworthy — the preview, the batch
// builder and the tests all call the same function.
//
// Mirrored on the frontend by src/telecalling/neodove-campaign.ts (display-only
// counting); this side is authoritative.

import type { AssignedLead, CampaignLead, Distribution, SkippedLead } from './types';

/** Parse a D1 JSON column defensively — never throws on bad data. */
export function parseList(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((v) => String(v ?? '')).filter(Boolean);
  const text = String(raw ?? '').trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed.map((v) => String(v ?? '')).filter(Boolean) : [];
  } catch {
    return [];
  }
}

/** Email column → the first valid address, or ''. */
export function firstEmail(raw: unknown): string {
  for (const candidate of parseList(raw)) {
    const value = candidate.trim().toLowerCase();
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return value.slice(0, 200);
  }
  return '';
}

/**
 * Normalize any stored phone into NeoDove's bare 10-digit Indian shape.
 * Returns null when the number cannot be a reachable Indian mobile/landline:
 *   +919876543210 → 9876543210
 *   09876543210   → 9876543210
 *   9876543210    → 9876543210
 *   0091 98765…   → 9876543210
 * Foreign / short numbers are rejected (the push reports them, never guesses).
 */
export function toIndianMobile(raw: unknown): string | null {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  const digits = text.replace(/\D/g, '');
  if (!digits) return null;
  let local = digits;
  if (local.startsWith('0091')) local = local.slice(4);
  else if (local.startsWith('91') && local.length === 12) local = local.slice(2);
  else if (local.startsWith('0') && local.length === 11) local = local.slice(1);
  if (local.length !== 10) return null;
  // Indian mobiles start 6-9; landlines start 1-5. Anything else is garbage.
  if (!/^[1-9]/.test(local)) return null;
  return local;
}

/** "9876543210" → "••••••3210" (never expose a full number in a payload). */
export function maskMobile(mobile: string): string {
  const value = String(mobile ?? '');
  if (value.length <= 4) return '••••';
  return `${'•'.repeat(Math.max(0, value.length - 4))}${value.slice(-4)}`;
}

function leadName(row: any): string {
  const company = String(row?.companyName ?? '').trim();
  const display = String(row?.displayName ?? '').trim();
  const contact = String(row?.contactPerson ?? '').trim();
  return (company || display || contact || 'Customer').slice(0, 160);
}

/**
 * Build the pushable lead list for one region + state.
 *
 * Rules (founder decisions 2026-10-31):
 *   - every customer in the region+state that has a usable phone,
 *   - one lead per mobile — two rows sharing a number would create a duplicate
 *     in NeoDove within the same push, so the second is skipped and reported,
 *   - no pipeline filter: "all with a phone" means all.
 */
export function selectLeads(
  rows: any[],
  region: string,
  state: string,
): { leads: CampaignLead[]; skipped: SkippedLead[] } {
  const leads: CampaignLead[] = [];
  const skipped: SkippedLead[] = [];
  const seenMobile = new Set<string>();

  for (const row of rows ?? []) {
    const customerId = String(row?.id ?? '');
    if (!customerId) continue;
    const name = leadName(row);
    const phones = parseList(row?.phonesJson);
    if (phones.length === 0) {
      skipped.push({ customerId, name, reason: 'no_phone' });
      continue;
    }
    let mobile: string | null = null;
    for (const phone of phones) {
      const candidate = toIndianMobile(phone);
      if (candidate) { mobile = candidate; break; }
    }
    if (!mobile) {
      skipped.push({ customerId, name, reason: 'invalid_phone' });
      continue;
    }
    if (seenMobile.has(mobile)) {
      skipped.push({ customerId, name, reason: 'duplicate_mobile_in_batch' });
      continue;
    }
    seenMobile.add(mobile);
    leads.push({
      customerId,
      zohoCustomerId: String(row?.zohoCustomerId ?? ''),
      region: String(row?.region ?? region),
      state: String(row?.state ?? state),
      mobile,
      name,
      email: firstEmail(row?.emailsJson),
    });
  }

  return { leads, skipped };
}

/**
 * 32-bit string hash: FNV-1a followed by a murmur3-style avalanche.
 *
 * The avalanche is NOT cosmetic. FNV-1a's low bit is the XOR of the characters'
 * low bits (multiplying by an odd constant preserves it), so `hash % 2` on a
 * bare FNV-1a hash is a parity function — measured against the real customer
 * book it split West Bengal 84/57 instead of ~70/71. The final mix destroys
 * that structure so the low bits are actually uniform.
 *
 * Deterministic in every JS runtime: no locale, no seed, no Math.random.
 */
export function hash32(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

/** Which of `agentCount` buckets a mobile falls into (stable forever). */
export function agentIndexFor(mobile: string, agentCount: number): number {
  if (agentCount <= 0) return -1;
  return hash32(String(mobile ?? '')) % agentCount;
}

/**
 * Pair each lead with its destination agent.
 *
 * `single` → every lead to agentKeys[0] (the caller passes exactly one key).
 * `split`  → stable hash of the MOBILE, not the customer row or its position.
 *
 * Why hash the mobile:
 *   - the founder's model is "resend everything", so a repeat push must land on
 *     the same agent or both agents end up calling the same prospect;
 *   - hashing the position in a sorted list would re-assign every lead after
 *     the first insertion, which is exactly that failure.
 * The cost is an approximate split (118 leads → typically 58/60, not 59/59),
 * which is the trade the founder chose for stability.
 *
 * `agentKeys` MUST be sorted by the caller so the modulo buckets are stable
 * regardless of D1 row order.
 */
export function assignAgents(
  leads: CampaignLead[],
  distribution: Distribution,
  agentKeys: string[],
): AssignedLead[] {
  const keys = agentKeys.filter(Boolean);
  if (keys.length === 0) return [];
  if (distribution === 'single' || keys.length === 1) {
    const only = keys[0];
    return leads.map((lead) => ({ lead, agentKey: only }));
  }
  return leads.map((lead) => ({
    lead,
    agentKey: keys[agentIndexFor(lead.mobile, keys.length)] ?? keys[0],
  }));
}
