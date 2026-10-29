/**
 * Debtors Tracker — promised-to-pay money roll-up (pure, display-only).
 *
 * A promise is stored per customer, but the money it covers sits in ageing
 * buckets. Each promised customer's net due (gross due − advances) is split
 * across their overdue buckets in proportion to the gross balance in each
 * bucket, so the bucket slices always add up to the promise total.
 *
 * A promise stops counting once the customer is settled (net due ≤ 0) or the
 * situation is Paid / Closed — the same rules as the ageing badge. Overdue
 * promises still count: that money was promised, it just arrived late.
 *
 * MIRROR: none — presentation-only roll-up of the backend payload.
 */
import type { CustomerAgeingRow } from "./types";
import { situationLabel } from "./types";
import { promiseDaysRemaining, promiseStatus } from "./promise";
import { AGEING_BUCKETS, type AgeingBucketKey } from "./buckets";

/** Anything below half a paisa is not money. */
const EPSILON = 0.005;

export interface PromiseBucketSlice {
  key: AgeingBucketKey;
  amount: number;
  /** Clients with promised money still sitting in this bucket (may overlap buckets). */
  clients: number;
}

export type PromiseDueKey = "overdue" | "today" | "next7" | "later";

export interface PromiseDueSlice {
  key: PromiseDueKey;
  label: string;
  amount: number;
  clients: number;
}

export interface PromiseSituationSlice {
  /** Raw situation code; '' = unset. */
  situation: string;
  label: string;
  amount: number;
  clients: number;
}

export interface PromiseSummary {
  /** Money promised by clients who still owe us (net due figure). */
  total: number;
  clients: number;
  buckets: PromiseBucketSlice[];
  /** Promised money by how near the promise date is. */
  due: PromiseDueSlice[];
  /** Promised money by the client's current CRM situation. */
  situations: PromiseSituationSlice[];
  overdueAmount: number;
  overdueClients: number;
  /** Past-due money with no live promise — the collection gap. */
  unpromisedDue: number;
  unpromisedClients: number;
  /** 0–100: promised share of all collectible overdue money. */
  promisedShare: number;
}

const DUE_LABELS: Record<PromiseDueKey, string> = {
  overdue: "Promise overdue",
  today: "Due today",
  next7: "Next 7 days",
  later: "Beyond 7 days",
};

/** Outstanding and not Paid / Closed. */
function isCollectible(row: CustomerAgeingRow): boolean {
  return Number(row.netDue) > EPSILON && row.situation !== "PAID_CLOSED";
}

/** Outstanding, not Paid / Closed, and carrying a usable promise date. */
export function hasLivePromise(row: CustomerAgeingRow, today: string): boolean {
  if (!row.promisedDate || !isCollectible(row)) return false;
  return promiseStatus(row.promisedDate, today) !== "none";
}

function dueKey(date: string, today: string): PromiseDueKey | null {
  const days = promiseDaysRemaining(date, today);
  if (days === null) return null;
  if (days < 0) return "overdue";
  if (days === 0) return "today";
  return days <= 7 ? "next7" : "later";
}

/**
 * Split a customer's net due across their ageing buckets.
 * Returns null when the customer has no past-due balance to attribute.
 */
function splitByBucket(row: CustomerAgeingRow): { key: AgeingBucketKey; amount: number }[] | null {
  const net = Number(row.netDue) || 0;
  const weights = AGEING_BUCKETS.map((b) => Math.max(0, Number(row[b.key]) || 0));
  const weightSum = weights.reduce((sum, w) => sum + w, 0);
  if (net <= EPSILON) return null;
  if (weightSum <= EPSILON) {
    // Degenerate payload (no bucket carries money) — keep the totals intact
    // rather than dropping the promise from the chart.
    return [{ key: "bucket0to30", amount: net }];
  }
  return AGEING_BUCKETS.map((b, i) => ({ key: b.key, amount: (net * weights[i]) / weightSum }));
}

export function buildPromiseSummary(customers: CustomerAgeingRow[], today: string): PromiseSummary {
  const bucketTotals = new Map<AgeingBucketKey, PromiseBucketSlice>(
    AGEING_BUCKETS.map((b) => [b.key, { key: b.key, amount: 0, clients: 0 }]),
  );
  const dueTotals = new Map<PromiseDueKey, PromiseDueSlice>(
    (Object.keys(DUE_LABELS) as PromiseDueKey[]).map((key) => [
      key,
      { key, label: DUE_LABELS[key], amount: 0, clients: 0 },
    ]),
  );
  const situationTotals = new Map<string, PromiseSituationSlice>();

  let total = 0;
  let promisedClients = 0;
  let unpromisedDue = 0;
  let unpromisedClients = 0;

  for (const row of customers) {
    if (!isCollectible(row)) continue;
    const net = Number(row.netDue) || 0;

    if (!hasLivePromise(row, today)) {
      unpromisedDue += net;
      unpromisedClients += 1;
      continue;
    }

    promisedClients += 1;
    total += net;

    const slices = splitByBucket(row);
    if (slices) {
      for (const slice of slices) {
        const bucket = bucketTotals.get(slice.key)!;
        bucket.amount += slice.amount;
        if (slice.amount > EPSILON) bucket.clients += 1;
      }
    }

    const key = dueKey(String(row.promisedDate), today);
    if (key) {
      const due = dueTotals.get(key)!;
      due.amount += net;
      due.clients += 1;
    }

    const situation = String(row.situation || "");
    const existing = situationTotals.get(situation);
    if (existing) {
      existing.amount += net;
      existing.clients += 1;
    } else {
      situationTotals.set(situation, {
        situation,
        label: situationLabel(situation) || "Unset",
        amount: net,
        clients: 1,
      });
    }
  }

  const collectible = total + unpromisedDue;

  return {
    total,
    clients: promisedClients,
    buckets: AGEING_BUCKETS.map((b) => bucketTotals.get(b.key)!),
    due: (Object.keys(DUE_LABELS) as PromiseDueKey[]).map((key) => dueTotals.get(key)!),
    situations: [...situationTotals.values()]
      .sort((a, b) => b.amount - a.amount || a.label.localeCompare(b.label)),
    overdueAmount: dueTotals.get("overdue")!.amount,
    overdueClients: dueTotals.get("overdue")!.clients,
    unpromisedDue,
    unpromisedClients,
    promisedShare: collectible > EPSILON ? (total / collectible) * 100 : 0,
  };
}
