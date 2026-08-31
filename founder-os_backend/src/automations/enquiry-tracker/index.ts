// Enquiry Tracker — live sales pipeline dashboard.
//
// Not a scheduled job: this automation exists so the enquiry tracker appears in
// the Automations registry with its own dashboard (slugs: `enquiry-tracker`).
// Live data + CRUD live under /api/enquiries/* (D1/Postgres) and fan out over
// the EventHub (LiveEvent.Enquiries); the frontend EnquiryTracker dashboard
// subscribes to those events.
import { prisma } from '../../shared/prisma';
import type { AutomationContext } from '../../modules/automation/types';

export async function data(_ctx: AutomationContext) {
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