// Procurement Queue — pending-only vendor-rate queue.
//
// Not a scheduled job: this automation exists so the procurement queue appears
// in the Automations registry with its own dashboard (slug:
// `enquiry-procurement`). Live data flows through /api/enquiries/*
// (view=procurement, PII-redacted) and fans out over the EventHub; the
// frontend ProcurementQueue dashboard subscribes to those events.
import type { AutomationContext } from '../../modules/automation/types';

export async function data(_ctx: AutomationContext) {
  return {
    analysis: 'enquiry-procurement',
    note: 'Queue served live from /api/enquiries?view=procurement',
  };
}
