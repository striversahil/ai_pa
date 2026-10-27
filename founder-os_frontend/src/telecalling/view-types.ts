// view-types.ts — the narrow shapes the telecalling board components render.
//
// These are STRUCTURAL SUBSETS of the payload adapters in
// `components/TelecallingDashboard.tsx` (`LeaderRow`, `RegionInfo`, `DashData`).
// The dashboard passes its richer objects straight in — TypeScript's structural
// typing accepts them — so the components stay decoupled from the page module
// (no circular import) while every rupee figure still comes from the payload.
//
// Never compute a target/attainment number here: `target` is server-computed.

import type { RegionTarget } from "./targets";
import type { TrafficLight } from "./tone";

export interface BoardStaff {
  id: string;
  name: string;
  tlLevel?: string;
  /** 'telecaller' | 'field_staff'. */
  type?: string;
  score: number;
  region?: string;
  regionName?: string;
  conversion: { assigned: number; won: number; acceptedValue?: number };
  generation: {
    callsConnected: number;
    leadsGenerated: number;
    talkTimeSec: number;
    connectedTarget: number;
    connectedPct: number;
    connectedStatus: TrafficLight;
    leadsTarget: number;
    leadsPct: number;
    leadsStatus: TrafficLight;
  };
  risk?: { atRisk: number; zombie: number };
}

/** One accepted estimate behind a region's `Won` number (server-built). */
export interface BoardClosedItem {
  estimateId: string;
  estimateNumber?: string | null;
  customerName?: string | null;
  total?: number | null;
  acceptedAt?: string | null;
  createdBy?: string | null;
  createdByName?: string | null;
  status?: string | null;
}

export interface BoardRegion {
  id: string;
  name: string;
  tl: string;
  states: string[];
  /** Leaderboard position by target attainment (1 = best). */
  rank: number;
  won: { count: number; value: number };
  accepted?: { count: number; value: number; points: number };
  /** The closed estimates behind `won`, newest acceptance first (capped 60). */
  acceptedItems?: BoardClosedItem[];
  /** ₹1L/day target + weekly carry-forward ledger (server-computed). */
  target: RegionTarget | null;
  open: { count: number; value: number };
  callsConnected: number;
  leadsGenerated: number;
  points: number;
  kra: {
    connectedTarget: number;
    connectedPct: number;
    connectedStatus: TrafficLight;
    leadsTarget: number;
    leadsPct: number;
    leadsStatus: TrafficLight;
  };
  staff?: BoardStaff[];
}

export interface BoardKpi {
  won?: number;
  acceptedValue?: number;
  regionWon?: number;
  regionValue?: number;
  directWon?: number;
  directValue?: number;
  unlinkedWon?: number;
  unlinkedValue?: number;
  callsConnected?: number;
  leadsGenerated?: number;
  talkTimeSec?: number;
}

export interface BoardBucketItem {
  estimateId: string;
  estimateNumber?: string | null;
  customerName?: string | null;
  total?: number | null;
  acceptedAt?: string | null;
}

export interface BoardBucket {
  count: number;
  value: number;
  points: number;
  items?: BoardBucketItem[];
  label?: string;
}

export interface BoardMeta {
  day?: string;
  periodLabel?: string;
  periodFrom?: string | null;
  periodTo?: string | null;
  workingDays?: number;
  activeCount?: number;
  telecallerCount?: number;
  /** Raw payload extra — enquiries with no roster match. */
  unattributedLeads?: number;
}
