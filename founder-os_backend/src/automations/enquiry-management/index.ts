// Management Review — pending-only rate-review queue.
//
// Not a scheduled job: this automation exists so the review queue appears in
// the Automations registry with its own dashboard (slug:
// `enquiry-management`). Live data flows through /api/enquiries/* and fans
// out over the EventHub; the frontend ManagementReview dashboard subscribes
// to those events. Markup + finalize writes are MIS-only (API-enforced).
import type { AutomationContext } from '../../modules/automation/types';

export async function data(_ctx: AutomationContext) {
  return {
    analysis: 'enquiry-management',
    note: 'Queue served live from /api/enquiries/* (MIS-only writes)',
  };
}
