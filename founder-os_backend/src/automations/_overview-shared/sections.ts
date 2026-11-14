/**
 * _overview-shared/sections.ts — section registry + pure summarizers.
 *
 * Each entry maps one source automation's `data()` payload to a concise
 * `OverviewSection`. Summarizers are framework-free pure functions: safe
 * property access, never throw, capped attention lists. Adding a new source
 * dashboard = one entry here (slug + title + summarize) — no aggregator edit.
 *
 * Mirror logic: founder-os_frontend/src/overview/normalize.ts formats these
 * sections for display (no duplication of extraction logic).
 */

import type { OverviewSection } from './types';

const num = (v: unknown, fallback = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const inr = (v: unknown): string => `₹${Math.round(num(v)).toLocaleString('en-IN')}`;

function section(slug: string, title: string, raw: unknown, err: unknown, build: (d: any) => Omit<OverviewSection, 'slug' | 'title' | 'ok' | 'error'>): OverviewSection {
  if (err || raw == null) {
    return { slug, title, headline: 'Unavailable', kpis: [], attention: [], ok: false, error: err instanceof Error ? err.message : String((err as any)?.message ?? err ?? 'no data') };
  }
  try {
    return { slug, title, ok: true, ...build(raw as any) };
  } catch (e: any) {
    return { slug, title, headline: 'Unavailable', kpis: [], attention: [], ok: false, error: e?.message ?? 'summarize failed' };
  }
}

function summarizeZoho(d: any) {
  const sent = num(d.sentEstimates);
  const unclassified = num(d.unclassifiedEstimates);
  const declined = num(d.declinedEstimates);
  const orders = num(d.activeSalesOrdersToday);
  const att: string[] = [];
  if (unclassified > 0) att.push(`${unclassified} sent estimates await AI classification`);
  if (num(d.pendingAiEstimates) > 0) att.push(`${num(d.pendingAiEstimates)} stuck on AI pending`);
  if (declined > 0) att.push(`${declined} declined lifetime — review save rate`);
  return {
    headline: `${sent} sent · ${inr(d.totalSentValue)} pipeline · ${orders} SO today`,
    kpis: [
      { label: 'Sent', value: String(sent) },
      { label: 'Pipeline', value: inr(d.totalSentValue) },
      { label: 'SO today', value: `${orders} (${inr(d.salesOrdersTodayValue)})` },
      { label: 'Unclassified', value: String(unclassified) },
    ],
    attention: att.slice(0, 3),
  };
}

function summarizeCrm(d: any) {
  const stages = d.stages ?? {};
  const count = (s: any) => num(s?.count);
  const confirm = count(stages.confirm);
  const invoice = count(stages.invoice);
  const ship = count(stages.ship);
  const payment = count(stages.payment);
  const total = num(d.totalActive);
  const att: string[] = [];
  if (confirm > 0) att.push(`${confirm} orders awaiting confirm (CRM desk)`);
  if (payment > 0) att.push(`${payment} shipped awaiting payment ${inr(stages.payment?.value)}`);
  if (ship > 0) att.push(`${ship} invoiced awaiting dispatch`);
  if (d.stale) att.push(`Snapshot stale since ${String(d.staleSince ?? 'unknown')} — Zoho fetch failing`);
  return {
    headline: `${total} active · ${inr(d.totalValue)} · confirm ${confirm} → invoice ${invoice} → ship ${ship} → pay ${payment}`,
    kpis: [
      { label: 'Active', value: `${total} (${inr(d.totalValue)})` },
      { label: 'Confirm', value: String(confirm) },
      { label: 'Invoice', value: String(invoice) },
      { label: 'Ship', value: String(ship) },
      { label: 'Payment', value: String(payment) },
    ],
    attention: att.slice(0, 4),
  };
}

function summarizeTelecalling(d: any) {
  const kpi = d.kpi ?? {};
  const risk = d.risk ?? d.atRisk ?? {};
  const counts = risk.counts ?? risk;
  const regions: any[] = Array.isArray(d.regions) ? d.regions : [];
  const points = regions.reduce((s, r) => s + num(r.points), 0);
  const unmapped = num(d?.unmapped?.count ?? 0);
  const att: string[] = [];
  const red = num(counts.red), zombie = num(counts.zombie);
  if (red > 0) att.push(`${red} red-risk holdings need chase today`);
  if (zombie > 0) att.push(`${zombie} zombie estimates silent >3 days`);
  if (unmapped > 0) att.push(`${unmapped} unmapped estimates need a region link`);
  const won = num(kpi.won), closedValue = num(kpi.closedValue);
  return {
    headline: `${won} won · ${inr(closedValue)} closed · pipeline ${inr(kpi.pipelineValue)} · ${num(kpi.leadsGenerated)} leads`,
    kpis: [
      { label: 'Won', value: `${won} (${inr(closedValue)})` },
      { label: 'Pipeline', value: inr(kpi.pipelineValue) },
      { label: 'Leads', value: String(num(kpi.leadsGenerated)) },
      { label: 'Points', value: String(points) },
    ],
    attention: att.slice(0, 4),
  };
}

function summarizeEnquiries(parts: { tracker: any; procurement: any; management: any }) {
  const t = parts.tracker ?? {};
  const counts = t.counts ?? {};
  const total = num(counts.total ?? t.enquiries);
  const byStatus: Record<string, number> = counts.byStatus ?? {};
  const proc = num(parts.procurement?.pending ?? parts.procurement?.counts?.total);
  const mgmt = num(parts.management?.pending ?? parts.management?.counts?.total);
  const att: string[] = [];
  const open = num(byStatus.new) + num(byStatus.open) + num(byStatus['in-progress']);
  if (open > 0) att.push(`${open} open enquiries in pipeline`);
  if (proc > 0) att.push(`${proc} items awaiting vendor rates (procurement)`);
  if (mgmt > 0) att.push(`${mgmt} rated items awaiting markup/finalize`);
  return {
    headline: `${total} enquiries · procurement ${proc} · management ${mgmt}`,
    kpis: [
      { label: 'Total', value: String(total) },
      { label: 'New', value: String(num(byStatus.new)) },
      { label: 'Awaiting rates', value: String(proc) },
      { label: 'Awaiting review', value: String(mgmt) },
    ],
    attention: att.slice(0, 3),
  };
}

function summarizeTaskbar(d: any, kind: string) {
  const today = d.today ?? d;
  const pending = num(d.pending ?? d.todayPending ?? today?.pending);
  const done = num(d.done ?? d.todayDone ?? today?.done);
  const overdue = num(d.overdue ?? d.incomplete ?? today?.overdue);
  const att: string[] = [];
  if (overdue > 0) att.push(`${overdue} overdue/incomplete ${kind} tasks`);
  if (pending > 0) att.push(`${pending} due today`);
  return {
    headline: `${done} done · ${pending} due · ${overdue} overdue`,
    kpis: [
      { label: 'Done', value: String(done) },
      { label: 'Due', value: String(pending) },
      { label: 'Overdue', value: String(overdue) },
    ],
    attention: att.slice(0, 3),
  };
}

function summarizeNeodove(d: any) {
  const agents: any[] = Array.isArray(d.agents) ? d.agents : [];
  const totals = d.totals ?? {};
  const connected = num(totals.callsConnected);
  const red = agents.filter((a) => a?.kra?.overall === 'red').length;
  const att: string[] = [];
  if (red > 0) att.push(`${red}/${agents.length} agents below target`);
  const worst = [...agents].sort((a, b) => num(a?.kra?.connectedPct) - num(b?.kra?.connectedPct))[0];
  if (worst) att.push(`Lowest: ${String(worst.userName ?? '?')} ${num(worst?.kra?.connectedPct)}% connects`);
  return {
    headline: `${agents.length} agents · ${connected} connects · ${d?.meta?.reportDate ?? 'latest'}`,
    kpis: [
      { label: 'Agents', value: String(agents.length) },
      { label: 'Connects', value: String(connected) },
      { label: 'Leads', value: String(num(totals.leadsGenerated ?? totals.leadsConverted)) },
      { label: 'Below target', value: String(red) },
    ],
    attention: att.slice(0, 3),
  };
}

function summarizeStock(d: any) {
  const totals = d?.totals ?? {};
  const items: any[] = Array.isArray(d?.items) ? d.items : [];
  const low = items.filter((i) => i?.status === 'low').slice(0, 3).map((i) => `${String(i.sku)} low (${num(i.onHand)} left)`);
  const out = items.filter((i) => i?.status === 'out').slice(0, 3).map((i) => `${String(i.sku)} out of stock`);
  return {
    headline: `${num(totals.skus)} SKUs · ${num(totals.units)} units · ${num(totals.low)} low · ${num(totals.out)} out`,
    kpis: [
      { label: 'SKUs', value: String(num(totals.skus)) },
      { label: 'Units', value: String(num(totals.units)) },
      { label: 'Low', value: String(num(totals.low)) },
      { label: 'Out', value: String(num(totals.out)) },
    ],
    attention: [...out, ...low].slice(0, 4),
  };
}

export interface SectionDef {
  key: string;
  title: string;
  slugs: string[];
  linkSlug: string;
  build: (rawBySlug: Record<string, { data: unknown; error: unknown }>) => OverviewSection;
}

export const SECTIONS: SectionDef[] = [
  { key: 'zoho', title: 'Analyzer', slugs: ['zoho-sent-analyzer'], linkSlug: 'sales', build: (r) => section('sales', 'Analyzer', r['zoho-sent-analyzer']?.data, r['zoho-sent-analyzer']?.error, summarizeZoho) },
  { key: 'crm', title: 'CRM — Sales Orders', slugs: ['crm'], linkSlug: 'crm', build: (r) => section('crm', 'CRM — Sales Orders', r.crm?.data, r.crm?.error, summarizeCrm) },
  { key: 'telecalling', title: 'Sales Leaderboard', slugs: ['telecalling'], linkSlug: 'telecalling', build: (r) => section('telecalling', 'Sales Leaderboard', r.telecalling?.data, r.telecalling?.error, summarizeTelecalling) },
  {
    key: 'enquiries', title: 'Enquiries', slugs: ['enquiry-procurement', 'enquiry-management'], linkSlug: 'sales',
    build: (r) => {
      const err = r['enquiry-procurement']?.error ?? r['enquiry-management']?.error;
      const anyData = r['enquiry-procurement']?.data ?? r['enquiry-management']?.data;
      return section('sales', 'Enquiries', anyData, err && !anyData ? err : null, () =>
        summarizeEnquiries({ tracker: null, procurement: r['enquiry-procurement']?.data, management: r['enquiry-management']?.data }));
    },
  },
  { key: 'accounts', title: 'Accounts', slugs: ['accounts'], linkSlug: 'accounts', build: (r) => section('accounts', 'Accounts', r.accounts?.data, r.accounts?.error, (d) => summarizeTaskbar(d, 'accounts')) },
  { key: 'digital', title: 'Digital Marketing', slugs: ['digital-marketing'], linkSlug: 'digital-marketing', build: (r) => section('digital-marketing', 'Digital Marketing', r['digital-marketing']?.data, r['digital-marketing']?.error, (d) => summarizeTaskbar(d, 'marketing')) },
  { key: 'stock', title: 'Stock', slugs: ['stock'], linkSlug: 'stock', build: (r) => section('stock', 'Stock', r.stock?.data, r.stock?.error, summarizeStock) },
  { key: 'neodove', title: 'NeoDove Calls', slugs: ['neodove-telecaller-report'], linkSlug: 'neodove-telecaller-report', build: (r) => section('neodove-telecaller-report', 'NeoDove Calls', r['neodove-telecaller-report']?.data, r['neodove-telecaller-report']?.error, summarizeNeodove) },
];

export const ALL_SOURCE_SLUGS: string[] = [...new Set(SECTIONS.flatMap((s) => s.slugs))];
