// System-generated Zoho Books comment detection, shared by the AI classification
// path (SalesCopilotService) and the read route that serves comments to the UI.
// Zoho auto-logs events like "Quote marked as sent", "Quote updated. Amount changed
// from X to Y", "Quote emailed to ..." as comments attributed to the sales agent.
// These carry no sales-intent signal and must be excluded everywhere: the UI
// comment timeline, the per-date comment counts, and the LLM prompt.

const SYSTEM_DESCRIPTION_PHRASES = [
  'estimate has been created',
  'estimate has been sent',
  'estimate sent',
  'email sent to',
  'mail sent to',
  'status changed from',
  'quote created',
  'quote sent',
  'quote updated',
  'quote marked as',
  'quote emailed to',
  'quote converted',
  'quote viewed',
  'viewed the quote',
  'amount changed from',
  'sent status',
  'created by',
  'updated by',
  'viewed in mail',
  'client viewed',
  'accepted by',
  'declined by',
  'payment received',
  'has been printed',
  'marked as sent',
  'marked as declined',
  'created for'
];

/**
 * True when the comment text is a Zoho system auto-log. Author name is consulted
 * as a fallback (Zoho Books itself) but the description phrases are the primary signal.
 */
export function isSystemGeneratedComment(description: string, commentedBy?: string): boolean {
  if ((commentedBy || '').toLowerCase().includes('system')) return true;

  const desc = (description || '').toLowerCase();
  for (const phrase of SYSTEM_DESCRIPTION_PHRASES) {
    if (desc.includes(phrase)) return true;
  }
  return false;
}