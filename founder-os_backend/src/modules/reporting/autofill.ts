// autofill.ts — live-source suggestions for the Reporting Sheet.
//
// Each section with `autofill: true` pulls its numbers from the dashboard that
// already owns them, for the requested week (Mon–Sun). The head confirms or
// adjusts in the form; the SAVED snapshot is what history shows, so a later
// source recompute can never rewrite a submitted week.
//
// Nothing here writes — it only builds the suggestion + provenance list.

import type {
  AutofillResult, RegionOrderRow, ReportDepartment, ReportSection, TelecallerRow,
} from './types';
import { weekRange } from './period';

const num = (v: unknown): number => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.floor(Number(v)) : 0);

/** Clamp a week range to days that actually exist (today or earlier). */
async function clampRange(from: string, to: string): Promise<{ from: string; to: string } | null> {
  const { istDateStr } = await import('./period');
  const today = istDateStr();
  if (from > today) return null;
  return { from, to: to > today ? today : to };
}

async function salesAutofill(
  section: ReportSection, from: string, to: string,
): Promise<Pick<AutofillResult, 'payload' | 'telecallerRows' | 'regionOrders' | 'autoKeys' | 'sources'>> {
  const empty = { payload: {}, telecallerRows: [] as TelecallerRow[], regionOrders: [] as RegionOrderRow[], autoKeys: [] as string[], sources: [] as string[] };
  const range = await clampRange(from, to);
  if (!range) return empty;

  if (section === 'telecaller') {
    let rows: TelecallerRow[] = [];
    const sources: string[] = [];
    try {
      const { computeTelecallingDaily } = await import('../../automations/telecalling/service');
      const daily = await computeTelecallingDaily(range.from, range.to);
      const byName = new Map<string, TelecallerRow>();
      for (const r of ('rows' in daily ? daily.rows : [])) {
        const name = String(r.telecallerName ?? 'Unknown').slice(0, 80);
        const cur = byName.get(name) ?? { name, connected: 0, leads: 0 };
        cur.connected += num(r.callsConnected);
        cur.leads += num(r.leadsGenerated);
        byName.set(name, cur);
      }
      rows = [...byName.values()]
        .filter((r) => r.connected + r.leads > 0)
        .sort((x, y) => y.connected - x.connected);
      sources.push('auto dialer / manual call log');
    } catch { /* call source unavailable — rows stay empty */ }
    let regionOrders: RegionOrderRow[] = [];
    try {
      const { loadAcceptedSnapshot } = await import('../../automations/telecalling/accepted');
      const snap = await loadAcceptedSnapshot(range.from, range.to);
      regionOrders = ['R1', 'R2', 'R3', 'R4'].map((r) => {
        const b = snap.byRegion.get(r);
        return { region: r, orders: b?.count ?? 0, value: b?.value ?? 0 };
      });
      sources.push('accepted estimates');
    } catch {
      // Accepted-estimate attribution is a bonus — telecaller rows stand alone.
    }
    return { payload: {}, telecallerRows: rows, regionOrders, autoKeys: ['telecallerRows', 'regionOrders'], sources };
  }

  if (section === 'data') {
    // Lead-pipeline status autofill came from the retired call portal. The section stays
    // manual; the enquiry dashboard owns live pipeline numbers now.
    return empty;
  }

  return empty;
}

async function operationsAutofill(
  section: ReportSection,
): Promise<Pick<AutofillResult, 'payload' | 'telecallerRows' | 'regionOrders' | 'autoKeys' | 'sources'>> {
  const empty = { payload: {}, telecallerRows: [] as TelecallerRow[], regionOrders: [] as RegionOrderRow[], autoKeys: [] as string[], sources: [] as string[] };
  if (section !== 'outstanding') return empty;
  const { getDebtorsTrackerData } = await import('../../automations/debtors-tracker/service');
  const data = await getDebtorsTrackerData();
  const s = (data as any)?.summary ?? {};
  return {
    ...empty,
    payload: {
      invoicedTotal: num(s.grossDue ?? s.totalReceivable),
      advanceReceived: num(s.advanceReceived),
      netDue: num(s.netDue ?? (num(s.grossDue) - num(s.advanceReceived))),
    },
    autoKeys: ['invoicedTotal', 'advanceReceived', 'netDue'],
    sources: ['debtors ledger (live snapshot)'],
  };
}

async function digitalAutofill(
  section: ReportSection, from: string, to: string,
): Promise<Pick<AutofillResult, 'payload' | 'telecallerRows' | 'regionOrders' | 'autoKeys' | 'sources'>> {
  const empty = { payload: {}, telecallerRows: [] as TelecallerRow[], regionOrders: [] as RegionOrderRow[], autoKeys: [] as string[], sources: [] as string[] };
  if (section !== 'meta' && section !== 'email-wa' && section !== 'b2b') return empty;
  const range = await clampRange(from, to);
  if (!range) return empty;
  // Series covers trailing days ending today; ask for enough to include `from`.
  const { istDateStr, parseDay } = await import('./period');
  const needDays = Math.min(
    93,
    Math.max(7, Math.round((parseDay(istDateStr()).getTime() - parseDay(range.from).getTime()) / 86400000) + 1),
  );
  const { getDigitalMarketingMetricsSeries } = await import('../../automations/digital-marketing/service');
  const series = await getDigitalMarketingMetricsSeries(needDays);
  const days = (series?.days ?? []).filter((d: any) => d?.date >= range.from && d?.date <= range.to);
  const sum = (pick: (d: any) => unknown) => days.reduce((t: number, d: any) => t + num(pick(d)), 0);
  const sumMeta = (k: 'spend' | 'inquiries' | 'leads') => sum((d) => d?.meta?.[k]);
  const payload: Record<string, unknown> = {};
  const autoKeys: string[] = [];
  if (section === 'meta') {
    Object.assign(payload, { spend: sumMeta('spend'), inquiries: sumMeta('inquiries'), leads: sumMeta('leads') });
    autoKeys.push('spend', 'inquiries', 'leads');
  } else if (section === 'email-wa') {
    Object.assign(payload, {
      emailSent: sum((d) => d?.email?.sent),
      emailLeads: sum((d) => d?.email?.leads),
      waSent: sum((d) => d?.whatsapp?.sent),
      waLeads: sum((d) => d?.whatsapp?.leads),
    });
    autoKeys.push('emailSent', 'emailLeads', 'waSent', 'waLeads');
  } else {
    Object.assign(payload, {
      alibaba: sum((d) => d?.b2b?.alibaba),
      indiamart: sum((d) => d?.b2b?.indiamart),
      tradeindia: sum((d) => d?.b2b?.tradeindia),
      eexporter: sum((d) => d?.b2b?.eexporter),
    });
    autoKeys.push('alibaba', 'indiamart', 'tradeindia', 'eexporter');
  }
  return {
    ...empty, payload, autoKeys,
    sources: [`marketing log (${days.length} day${days.length === 1 ? '' : 's'} in week)`],
  };
}

export async function buildAutofill(
  dept: ReportDepartment, section: ReportSection, period: string,
): Promise<AutofillResult> {
  const { from, to } = weekRange(period);
  const base: AutofillResult = {
    period, from, to, payload: {}, telecallerRows: [], regionOrders: [], autoKeys: [], sources: [],
  };
  try {
    if (dept === 'sales') return { ...base, ...(await salesAutofill(section, from, to)) };
    if (dept === 'operations') return { ...base, ...(await operationsAutofill(section)) };
    if (dept === 'digital') return { ...base, ...(await digitalAutofill(section, from, to)) };
  } catch (e) {
    // A failing source must never block the form — the head types by hand.
    base.sources = [`source unavailable (${(e as Error)?.message ?? 'error'}) — enter by hand`];
  }
  return base;
}
