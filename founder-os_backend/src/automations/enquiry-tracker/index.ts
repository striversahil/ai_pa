// Enquiry Tracker — live sales pipeline dashboard.
//
// Not a scheduled job: this automation exists so the enquiry tracker appears in
// the Automations registry with its own dashboard (slugs: `enquiry-tracker`).
// Live data + CRUD live under /api/enquiries/* (D1/Postgres) and fan out over
// the EventHub (LiveEvent.Enquiries); the frontend EnquiryTracker dashboard
// subscribes to those events.
//
// NOTE: trigger is manual (rule.json) — there is no scheduled scan; the
// registry entry is display-only. Every write busts the data cache below.
import { prisma } from '../../shared/prisma';
import { cached } from '../../shared/cache';
import type { AutomationContext } from '../../modules/automation/types';

const DATA_CACHE_KEY = 'enquiry-tracker:data';
const DATA_TTL_MS = 60 * 1000;

async function computeTrackerData() {
  const enquiries = await prisma.enquiry.findMany();
  const comments = await prisma.enquiryComment.findMany();
  const byStatus: Record<string, number> = {};
  const byPriority: Record<string, number> = {};
  for (const e of enquiries) {
    byStatus[e.status] = (byStatus[e.status] || 0) + 1;
    byPriority[e.priority] = (byPriority[e.priority] || 0) + 1;
  }
  return {
    analysis: 'enquiry-tracker',
    counts: { total: enquiries.length, byStatus, byPriority },
    enquiries: enquiries.length,
  };
}

export async function data(_ctx: AutomationContext) {
  // Short TTL collapses dashboard refetch storms into one compute; every
  // enquiry write busts this key (enquirySend + server paths).
  return cached(DATA_CACHE_KEY, DATA_TTL_MS, computeTrackerData);
}
