'use client';
// DigitalMarketingCharts — KRA/KPI view for the DMM dashboard.
//
// Replaces the old leaderboard / today-by-frequency / done-this-week board:
// day-wise graphical interpretation of the numbers that matter — Meta Ads
// leads, B2B portal leads, Email + WhatsApp volumes. Data comes from
// GET /api/digital-marketing/metrics-series (KV-cached, busted on every log
// write). All charts are hand-rolled SVG (no chart lib): gradient areas,
// smooth curves, rounded bars, hover crosshair — fluid in both themes via
// currentColor.
import React, { useMemo, useState } from 'react';
import { useLiveDashboard } from '@/hooks/useLiveData';

interface SeriesDay {
  date: string;
  meta: { spend: number; inquiries: number; leads: number };
  b2b: { alibaba: number; eexporter: number; indiamart: number; tradeindia: number };
  whatsapp: { sent: number; leads: number; spend: number };
  email: { sent: number; leads: number };
}
interface SeriesPayload { days: SeriesDay[]; from: string; to: string; computedAt: string }

const LEADS = '#10b981'; // leads are ALWAYS emerald, every card
const INQ = '#6366f1';
const SENT_MAIL = '#818cf8';
const SENT_WA = '#14b8a6';
const SPEND = '#f59e0b';
const PORTALS = [
  { key: 'alibaba', label: 'Alibaba', color: '#0ea5e9' },
  { key: 'eexporter', label: 'eExporter', color: '#f97316' },
  { key: 'indiamart', label: 'IndiaMART', color: '#8b5cf6' },
  { key: 'tradeindia', label: 'TradeIndia', color: '#f43f5e' },
] as const;

const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const int = (n: number) => Math.round(n).toLocaleString('en-IN');
function fmtShort(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? m[2]}`;
}

/** Catmull-Rom → bezier smooth path through points. */
function smoothPath(pts: Array<{ x: number; y: number }>): string {
  if (pts.length === 0) return '';
  if (pts.length === 1) return `M ${pts[0].x} ${pts[0].y}`;
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`;
  }
  return d;
}

function Card({ title, sub, right, children }: { title: string; sub?: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-sm font-extrabold text-zinc-900 dark:text-zinc-100">{title}</h3>
        {sub && <span className="text-[11px] font-medium text-zinc-500">{sub}</span>}
        {right && <div className="ml-auto flex items-center gap-2">{right}</div>}
      </div>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function Tile({ label, value, sub, color }: { label: string; value: string; sub?: string; color: string }) {
  return (
    <div className="rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200/70 dark:border-zinc-800 px-3 py-2 min-w-[104px]">
      <div className="text-[10px] uppercase tracking-wider font-bold text-zinc-500">{label}</div>
      <div className="text-xl font-extrabold font-mono" style={{ color }}>{value}</div>
      {sub && <div className="text-[10px] text-zinc-500 -mt-0.5">{sub}</div>}
    </div>
  );
}

function RangeSwitch({ range, onChange }: { range: number; onChange: (n: number) => void }) {
  return (
    <div className="flex gap-1 rounded-lg bg-zinc-100 dark:bg-zinc-900 p-0.5">
      {[7, 14, 30].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          className={`px-2.5 py-1 rounded-md text-[11px] font-extrabold cursor-pointer transition-colors ${
            range === n ? 'bg-white dark:bg-zinc-800 text-indigo-500 shadow-sm' : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
          }`}
        >
          {n}D
        </button>
      ))}
    </div>
  );
}

/** Smooth multi-series area + line chart with hover crosshair. */
function FlowChart({ days, series, height = 210 }: {
  days: SeriesDay[];
  series: Array<{ get: (d: SeriesDay) => number; color: string; label: string; fill: boolean }>;
  height?: number;
}) {
  const W = 680;
  const H = height;
  const PAD = { l: 34, r: 10, t: 12, b: 24 };
  const [hover, setHover] = useState<number | null>(null);
  const maxV = Math.max(1, ...days.flatMap((d) => series.map((s) => s.get(d))));
  const stepX = days.length > 1 ? (W - PAD.l - PAD.r) / (days.length - 1) : 0;
  const X = (i: number) => PAD.l + i * stepX;
  const Y = (v: number) => PAD.t + (H - PAD.t - PAD.b) * (1 - v / maxV);
  const grid = [0.25, 0.5, 0.75, 1].map((f) => Math.round(maxV * f));
  const every = Math.max(1, Math.ceil(days.length / 8));
  const gid = React.useId().replace(/[^a-zA-Z0-9]/g, '');
  return (
    <div className="relative">
      <div className="flex flex-wrap gap-x-4 gap-y-1 mb-1">
        {series.map((s) => (
          <span key={s.label} className="inline-flex items-center gap-1.5 text-[11px] font-bold text-zinc-500">
            <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full text-zinc-300 dark:text-zinc-700"
        onMouseMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * W;
          const i = Math.round((px - PAD.l) / (stepX || 1));
          setHover(Math.max(0, Math.min(days.length - 1, i)));
        }}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          {series.map((s, si) => (
            <linearGradient key={si} id={`${gid}-g${si}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity={s.fill ? 0.35 : 0} />
              <stop offset="100%" stopColor={s.color} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>
        {grid.map((g) => (
          <g key={g}>
            <line x1={PAD.l} x2={W - PAD.r} y1={Y(g)} y2={Y(g)} stroke="currentColor" strokeWidth="1" strokeDasharray="3 4" opacity="0.7" />
            <text x={PAD.l - 5} y={Y(g) + 3.5} textAnchor="end" fontSize="10" fill="currentColor" opacity="0.9">{g}</text>
          </g>
        ))}
        {days.map((d, i) => i % every === 0 && (
          <text key={d.date} x={X(i)} y={H - 8} textAnchor="middle" fontSize="10" fill="currentColor" opacity="0.9">{fmtShort(d.date)}</text>
        ))}
        {series.map((s, si) => {
          const pts = days.map((d, i) => ({ x: X(i), y: Y(s.get(d)) }));
          const line = smoothPath(pts);
          return (
            <g key={si}>
              {s.fill && <path d={`${line} L ${X(days.length - 1)} ${Y(0)} L ${X(0)} ${Y(0)} Z`} fill={`url(#${gid}-g${si})`} />}
              <path d={line} fill="none" stroke={s.color} strokeWidth={si === 0 ? 2.5 : 2} strokeLinecap="round" />
              {pts.map((p, i) => (
                <circle key={i} cx={p.x} cy={p.y} r={hover === i ? 4 : 2.2} fill={s.color} strokeWidth={hover === i ? 2 : 0} stroke="#fff" className="transition-all" />
              ))}
            </g>
          );
        })}
        {hover !== null && days[hover] && (
          <line x1={X(hover)} x2={X(hover)} y1={PAD.t} y2={H - PAD.b} stroke="currentColor" strokeWidth="1" opacity="0.9" />
        )}
      </svg>
      {hover !== null && days[hover] && (
        <div className="pointer-events-none absolute z-10 -translate-x-1/2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2.5 py-1.5 shadow-lg text-[11px] font-bold whitespace-nowrap"
          style={{ left: `${(X(hover) / W) * 100}%`, top: 0 }}>
          <div className="text-zinc-500 font-semibold">{fmtShort(days[hover].date)}</div>
          {series.map((s) => (
            <div key={s.label} style={{ color: s.color }}>{s.label}: {int(s.get(days[hover]))}</div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Per-day bars: stacked (single bar, segments) or grouped (side-by-side). */
function DayBars({ days, groups, stacked = false, height = 190 }: {
  days: SeriesDay[];
  groups: Array<{ get: (d: SeriesDay) => number; color: string; label: string }>;
  stacked?: boolean;
  height?: number;
}) {
  const W = 680;
  const H = height;
  const PAD = { l: 34, r: 10, t: 12, b: 24 };
  const totals = days.map((d) => groups.reduce((n, g) => n + g.get(d), 0));
  const maxV = Math.max(1, ...totals);
  const slot = (W - PAD.l - PAD.r) / Math.max(1, days.length);
  const bw = stacked ? Math.min(30, slot * 0.55) : Math.min(13, (slot * 0.7) / Math.max(1, groups.length));
  const Y = (v: number) => PAD.t + (H - PAD.t - PAD.b) * (1 - v / maxV);
  const grid = [0.5, 1].map((f) => Math.round(maxV * f));
  const every = Math.max(1, Math.ceil(days.length / 8));
  return (
    <div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mb-1">
        {groups.map((g) => (
          <span key={g.label} className="inline-flex items-center gap-1.5 text-[11px] font-bold text-zinc-500">
            <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: g.color }} />
            {g.label}
          </span>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full text-zinc-300 dark:text-zinc-700">
        {grid.map((g) => (
          <g key={g}>
            <line x1={PAD.l} x2={W - PAD.r} y1={Y(g)} y2={Y(g)} stroke="currentColor" strokeWidth="1" strokeDasharray="3 4" opacity="0.7" />
            <text x={PAD.l - 5} y={Y(g) + 3.5} textAnchor="end" fontSize="10" fill="currentColor" opacity="0.9">{g}</text>
          </g>
        ))}
        {days.map((d, i) => i % every === 0 && (
          <text key={d.date} x={PAD.l + slot * i + slot / 2} y={H - 8} textAnchor="middle" fontSize="10" fill="currentColor" opacity="0.9">{fmtShort(d.date)}</text>
        ))}
        {days.map((d, i) => {
          const cx = PAD.l + slot * i + slot / 2;
          if (stacked) {
            let acc = 0;
            return (
              <g key={d.date}>
                <title>{`${fmtShort(d.date)} — ${groups.map((g) => `${g.label}: ${int(g.get(d))}`).join(' · ')}`}</title>
                {groups.map((g) => {
                  const v = g.get(d);
                  const y0 = Y(acc + v);
                  const h = Y(acc) - y0;
                  acc += v;
                  return v > 0 ? <rect key={g.label} x={cx - bw / 2} y={y0} width={bw} height={Math.max(h, 1.5)} rx="3" fill={g.color} opacity="0.92" /> : null;
                })}
              </g>
            );
          }
          const gw = bw * groups.length;
          return (
            <g key={d.date}>
              <title>{`${fmtShort(d.date)} — ${groups.map((g) => `${g.label}: ${int(g.get(d))}`).join(' · ')}`}</title>
              {groups.map((g, gi) => {
                const v = g.get(d);
                const h = Y(0) - Y(v);
                return v > 0 ? (
                  <rect key={g.label} x={cx - gw / 2 + gi * bw + 1} y={Y(v)} width={bw - 2} height={Math.max(h, 1.5)} rx="3" fill={g.color} opacity="0.92" />
                ) : null;
              })}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export default function KraKpiCharts() {
  const [range, setRange] = useState(30);
  const series = useLiveDashboard<SeriesPayload>(async () => {
    const res = await fetch('/api/digital-marketing/metrics-series?days=30', { cache: 'no-store' });
    if (!res.ok) throw new Error(`Load failed (HTTP ${res.status})`);
    return res.json();
  }, { pollMs: 60000 });
  const days = useMemo(() => {
    const all = Array.isArray(series.data?.days) ? series.data.days : [];
    return all.slice(Math.max(0, all.length - range));
  }, [series.data, range]);
  const sum = useMemo(() => {
    const t = {
      metaLeads: 0, metaInq: 0, metaSpend: 0,
      b2b: { alibaba: 0, eexporter: 0, indiamart: 0, tradeindia: 0, total: 0 },
      waSent: 0, waLeads: 0, waSpend: 0,
      mailSent: 0, mailLeads: 0,
    };
    for (const d of days) {
      t.metaLeads += d.meta.leads; t.metaInq += d.meta.inquiries; t.metaSpend += d.meta.spend;
      t.b2b.alibaba += d.b2b.alibaba; t.b2b.eexporter += d.b2b.eexporter;
      t.b2b.indiamart += d.b2b.indiamart; t.b2b.tradeindia += d.b2b.tradeindia;
      t.waSent += d.whatsapp.sent; t.waLeads += d.whatsapp.leads; t.waSpend += d.whatsapp.spend;
      t.mailSent += d.email.sent; t.mailLeads += d.email.leads;
    }
    t.b2b.total = t.b2b.alibaba + t.b2b.eexporter + t.b2b.indiamart + t.b2b.tradeindia;
    return t;
  }, [days]);
  const conv = (leads: number, vol: number) => (vol > 0 ? `${((leads / vol) * 100).toFixed(1)}%` : '—');
  const empty = days.length > 0 && sum.metaLeads + sum.metaInq + sum.b2b.total + sum.waSent + sum.waLeads + sum.mailSent + sum.mailLeads === 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-extrabold text-zinc-900 dark:text-zinc-100">📈 KRA / KPI — leads & volumes, day wise</h3>
        <span className="text-[11px] text-zinc-500">logged numbers only · updates as the manager logs them</span>
        <div className="ml-auto"><RangeSwitch range={range} onChange={setRange} /></div>
      </div>
      {series.loading && !series.data && <div className="py-10 text-center text-sm text-zinc-500 animate-pulse">Loading KRA / KPI…</div>}
      {Boolean((series as any).error) && !series.data && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-4 text-sm text-rose-400">
          Failed to load charts: {String((series as any).error)} <button onClick={() => series.refresh()} className="ml-2 underline cursor-pointer">Retry</button>
        </div>
      )}
      {empty && series.data && (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-10 text-center">
          <p className="text-sm font-bold text-zinc-700 dark:text-zinc-200">No metrics logged in the last {range} days</p>
          <p className="mt-1 text-xs text-zinc-500">Numbers appear here automatically as Meta / B2B / WhatsApp / Email boxes are filled.</p>
        </div>
      )}
      {!empty && days.length > 0 && (
        <>
          <Card
            title="📣 Meta Ads Run — leads generated, day wise"
            sub="leads (area) · inquiries (line)"
          >
            <div className="flex flex-wrap gap-2 mb-3">
              <Tile label="Leads" value={int(sum.metaLeads)} sub={`last ${range}d`} color={LEADS} />
              <Tile label="Inquiries" value={int(sum.metaInq)} sub={`last ${range}d`} color={INQ} />
              <Tile label="Spend logged" value={inr(sum.metaSpend)} sub={`last ${range}d`} color={SPEND} />
            </div>
            <FlowChart
              days={days}
              series={[
                { get: (d) => d.meta.leads, color: LEADS, label: 'Leads', fill: true },
                { get: (d) => d.meta.inquiries, color: INQ, label: 'Inquiries', fill: false },
              ]}
            />
          </Card>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="🏢 B2B portals — leads by portal, day wise" sub="stacked · hover a bar for the split">
              <div className="flex flex-wrap gap-2 mb-3">
                <Tile label="Total leads" value={int(sum.b2b.total)} sub={`last ${range}d`} color={LEADS} />
                {PORTALS.map((p) => (
                  <Tile key={p.key} label={p.label} value={int((sum.b2b as any)[p.key])} sub={`last ${range}d`} color={p.color} />
                ))}
              </div>
              <DayBars
                days={days}
                stacked
                groups={PORTALS.map((p) => ({ get: (d: SeriesDay) => (d.b2b as any)[p.key] as number, color: p.color, label: p.label }))}
              />
            </Card>
            <Card title="✉️ Email marketing — sent vs leads, day wise" sub="volume → outcome">
              <div className="flex flex-wrap gap-2 mb-3">
                <Tile label="Emails sent" value={int(sum.mailSent)} sub={`last ${range}d`} color={SENT_MAIL} />
                <Tile label="Leads" value={int(sum.mailLeads)} sub={`last ${range}d`} color={LEADS} />
                <Tile label="Convert" value={conv(sum.mailLeads, sum.mailSent)} sub="leads ÷ sent" color={INQ} />
              </div>
              <DayBars
                days={days}
                groups={[
                  { get: (d) => d.email.sent, color: SENT_MAIL, label: 'Sent' },
                  { get: (d) => d.email.leads, color: LEADS, label: 'Leads' },
                ]}
              />
            </Card>
          </div>
          <Card title="💬 WhatsApp marketing — sent vs leads, day wise" sub="volume → outcome">
            <div className="flex flex-wrap gap-2 mb-3">
              <Tile label="Messages sent" value={int(sum.waSent)} sub={`last ${range}d`} color={SENT_WA} />
              <Tile label="Leads" value={int(sum.waLeads)} sub={`last ${range}d`} color={LEADS} />
              <Tile label="Convert" value={conv(sum.waLeads, sum.waSent)} sub="leads ÷ sent" color={INQ} />
              {sum.waSpend > 0 && <Tile label="Spend logged" value={inr(sum.waSpend)} sub={`last ${range}d`} color={SPEND} />}
            </div>
            <DayBars
              days={days}
              groups={[
                { get: (d) => d.whatsapp.sent, color: SENT_WA, label: 'Sent' },
                { get: (d) => d.whatsapp.leads, color: LEADS, label: 'Leads' },
              ]}
            />
          </Card>
        </>
      )}
    </div>
  );
}
