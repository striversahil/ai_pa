// search.ts — local (optimistic) enquiry search: THE single home for "does
// this row match this query". Used by BOTH the client-side filters
// (ProcurementQueue / ManagementReview memos) AND the gates that decide
// whether a server/database search is even needed.
//
// Product rule: frontend search runs FIRST and instantly over loaded rows;
// the backend search fires ONLY when nothing matches locally. The gate and
// the memos share this function, so the gate can never claim a "hit" the
// memos then fail to display (or vice versa).
//
// Haystack = the union of every field any tab filters on (client, title,
// EST/enquiry numbers, source lead, location, contact fields, description,
// source, daily no, item name/qty/spec/verbatim + vendor names). Callers
// with extra local-only fields (e.g. the roster-resolved agent name) pass
// them via `extraHay`.
import type { Enquiry } from '../types';

export function matchesEnquiryQuery(e: Pick<Enquiry, 'items'>, query: string, extraHay: string[] = []): boolean {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return true;
  const hay = [
    (e as any)?.clientCompany ?? '',
    (e as any)?.title ?? '',
    (e as any)?.estNumber ?? '',
    (e as any)?.enquiryNumber ?? '',
    (e as any)?.sourceLead ?? '',
    (e as any)?.location ?? '',
    (e as any)?.contactName ?? '',
    (e as any)?.contactEmail ?? '',
    (e as any)?.contactPhone ?? '',
    (e as any)?.description ?? '',
    (e as any)?.source ?? '',
    String((e as any)?.dailyNo ?? ''),
    ...(((e as any)?.items ?? []) as any[]).flatMap((it: any) => [
      it?.name ?? '',
      it?.qty ?? '',
      it?.spec ?? '',
      it?.verbatim ?? '',
      ...(((it?.rates ?? []) as any[]).map((r: any) => r?.vendor ?? '')),
    ]),
    ...extraHay,
  ].join(' ').toLowerCase();
  if (hay.includes(q)) return true;
  // EST digits: "23558" matches "EST-023558".
  const qDigits = q.replace(/\D/g, '');
  if (qDigits.length >= 3 && String((e as any)?.estNumber ?? '').replace(/\D/g, '').includes(qDigits)) return true;
  return false;
}
