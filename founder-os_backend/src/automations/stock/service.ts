// service.ts — KV-cached stock payload: multi-location closings, moving-average
// valuation, ABC classes, dead-stock ageing, SO reservations.
import { prisma } from '../../shared/prisma-d1';
import { cached, cacheDel } from '../../shared/cache';
import { stockStatus } from './queues';
import type { StockLine, StockPayload } from './types';

export const STOCK_CACHE_KEY = 'stock:data:v2';
const STOCK_TTL_MS = 5 * 60 * 1000;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function istDay(offset = 0): string {
  const now = new Date(Date.now() + offset * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

function lastDays(n: number): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(istDay(-i));
  return out;
}

export async function getStockData(days = 14): Promise<StockPayload> {
  const span = Math.min(Math.max(Number(days) || 14, 1), 31);
  return cached(`${STOCK_CACHE_KEY}:${span}`, STOCK_TTL_MS, async () => {
    const [items, movesRaw, locs, resRaw] = await Promise.all([
      (prisma as any).stockItem.findMany({ orderBy: [{ sku: 'asc' }] }),
      (prisma as any).stockMovement.findMany({ orderBy: [{ day: 'asc' }] }),
      (prisma as any).stockLocation.findMany({ orderBy: [{ name: 'asc' }] }).catch(() => []),
      (prisma as any).stockReservation.findMany({ where: { status: 'open' } }).catch(() => []),
    ]);
    const moves = ((movesRaw as any[]) ?? []).filter((m) => String(m.status ?? 'approved') === 'approved');
    const dayList = lastDays(span);
    const today = dayList[dayList.length - 1];
    const onHand = new Map<string, number>();
    const avgRate = new Map<string, number>();
    const avgQty = new Map<string, number>();
    const lastMove = new Map<string, string>();
    // Moving average: receipts/openings/positive adjustments re-average.
    for (const m of moves) {
      const id = String(m.itemId);
      const q = Number(m.qty ?? 0);
      onHand.set(id, (onHand.get(id) ?? 0) + q);
      lastMove.set(id, String(m.day) > String(lastMove.get(id) ?? '') ? String(m.day) : String(lastMove.get(id) ?? ''));
      if (q > 0) {
        const rate = Number(m.rate ?? 0);
        const eff = rate > 0 ? rate : (avgRate.get(id) ?? 0);
        if (eff > 0) {
          const prevQ = Math.max(0, avgQty.get(id) ?? 0);
          const prevR = avgRate.get(id) ?? 0;
          avgQty.set(id, prevQ + q);
          avgRate.set(id, (prevQ * prevR + q * eff) / (prevQ + q));
        } else {
          avgQty.set(id, (avgQty.get(id) ?? 0) + q);
        }
      }
    }
    // Fallback to master purchase rate when no receipted rate exists.
    for (const it of (items as any[]) ?? []) {
      const id = String(it.id);
      if (!avgRate.get(id) && Number(it.purchaseRate ?? 0) > 0) avgRate.set(id, Number(it.purchaseRate));
    }
    const reserved = new Map<string, number>();
    for (const r of (resRaw as any[]) ?? []) {
      reserved.set(String(r.itemId), (reserved.get(String(r.itemId)) ?? 0) + Number(r.qty ?? 0));
    }
    // ABC by stock value (A = top 80% cumulative).
    const values = ((items as any[]) ?? []).map((it) => {
      const id = String(it.id);
      return { id, v: (onHand.get(id) ?? 0) * (avgRate.get(id) ?? Number(it.purchaseRate ?? 0) ?? 0) };
    }).sort((a, b) => b.v - a.v);
    const totalV = values.reduce((s, x) => s + Math.max(0, x.v), 0) || 1;
    let cum = 0;
    const abc = new Map<string, 'A' | 'B' | 'C'>();
    for (const x of values) {
      cum += Math.max(0, x.v) / totalV;
      abc.set(x.id, cum <= 0.8 ? 'A' : cum <= 0.95 ? 'B' : 'C');
    }
    // Day-wise closings (all locations summed).
    const sorted = [...moves].sort((a, b) => String(a.day).localeCompare(String(b.day)));
    const closings: Record<string, Record<string, number>> = {};
    const running = new Map<string, number>();
    let mi = 0;
    for (const d of dayList) {
      while (mi < sorted.length && String(sorted[mi].day) <= d) {
        const m = sorted[mi++];
        running.set(String(m.itemId), (running.get(String(m.itemId)) ?? 0) + Number(m.qty ?? 0));
      }
      for (const it of (items as any[]) ?? []) {
        const id = String(it.id);
        (closings[id] ??= {})[d] = running.get(id) ?? 0;
      }
    }
    const dayNum = (d: string) => Date.parse(d + 'T00:00:00+05:30');
    const lines: StockLine[] = ((items as any[]) ?? []).map((it) => {
      const id = String(it.id);
      const oh = onHand.get(id) ?? 0;
      const rs = reserved.get(id) ?? 0;
      const avail = oh - rs;
      const reorderLevel = Number(it.reorderLevel ?? 0);
      const rate = avgRate.get(id) ?? 0;
      const lm = lastMove.get(id) ?? '';
      const deadDays = lm ? Math.max(0, Math.floor((dayNum(today) - dayNum(lm)) / 86400000)) : 999;
      return {
        id, sku: String(it.sku ?? ''), productName: String(it.productName ?? ''),
        category: String(it.category ?? ''), brand: String(it.brand ?? ''), barcode: String(it.barcode ?? ''),
        unit: String(it.unit ?? 'pcs'), unitPurchase: String(it.unitPurchase ?? ''),
        unitFactor: Number(it.unitFactor ?? 1) || 1,
        purchaseRate: Number(it.purchaseRate ?? 0), saleRate: Number(it.saleRate ?? 0),
        supplier: String(it.supplier ?? ''), reorderLevel,
        minLevel: Number(it.minLevel ?? 0), maxLevel: Number(it.maxLevel ?? 0),
        imageUrl: String(it.imageUrl ?? ''),
        active: it.active !== false && it.active !== 0,
        onHand: oh, reserved: rs, available: avail, avgRate: rate, stockValue: oh * rate,
        status: stockStatus(avail, reorderLevel), abc: abc.get(id) ?? 'C',
        lastMoveDay: lm, deadDays,
      };
    });
    const active = lines.filter((l) => l.active);
    const pendingAdjust = ((movesRaw as any[]) ?? []).filter((m) => String(m.status) === 'pending').length;
    return {
      meta: {
        analysis: 'stock', generatedAt: new Date().toISOString(), day: today, days: dayList,
        locations: ((locs as any[]) ?? []).map((l) => ({ id: String(l.id), name: String(l.name), active: l.active !== false && l.active !== 0 })),
      },
      items: lines,
      closings,
      totals: {
        skus: active.length,
        units: active.reduce((s, l) => s + l.onHand, 0),
        available: active.reduce((s, l) => s + l.available, 0),
        value: active.reduce((s, l) => s + l.stockValue, 0),
        low: active.filter((l) => l.status === 'low').length,
        out: active.filter((l) => l.status === 'out').length,
        dead: active.filter((l) => l.deadDays >= 90).length,
        pendingAdjust,
      },
      movements: ((movesRaw as any[]) ?? []).slice(-300).map((m) => ({
        id: String(m.id), itemId: String(m.itemId), day: String(m.day), kind: m.kind,
        qty: Number(m.qty ?? 0), locationId: String(m.locationId ?? ''), toLocationId: String(m.toLocationId ?? ''),
        rate: Number(m.rate ?? 0), status: String(m.status ?? 'approved') as any,
        refType: String(m.refType ?? ''), refId: String(m.refId ?? ''),
        note: String(m.note ?? ''), createdBy: String(m.createdBy ?? ''),
      })).reverse(),
    };
  });
}

export function validateDay(day: unknown): string {
  const d = String(day ?? '').trim();
  if (!DAY_RE.test(d)) throw new Error('day must be YYYY-MM-DD');
  return d;
}

export async function invalidateStockCache(): Promise<void> {
  try {
    const { cacheDelPrefix } = await import('../../shared/cache');
    await cacheDelPrefix(STOCK_CACHE_KEY);
  } catch {
    try { await cacheDel(STOCK_CACHE_KEY); } catch { /* noop */ }
  }
}
