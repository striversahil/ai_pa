/**
 * Enquiry field extraction — routes through the unified AiGateway
 * (src/shared/ai-gateway.ts) so key rotation, retry, rate-limit cooldowns and
 * multi-provider support are handled in ONE place. This module keeps the
 * extraction prompt + response shaping; the gateway owns the wire call.
 */
import { getGateway } from '../../shared/ai-gateway';

export interface RedactedComment {
  id: string;
  content: string;
}

export interface ExtractionResult {
  title?: string | null;
  enquiryNumber?: string | null;
  sourceLead?: string | null;
  location?: string | null;
  company?: string | null;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  /** Procurement-team rewrite of the DESCRIPTION: every line carrying ONLY
   *  client-identifying details (company, people, contacts, places,
   *  salesperson names, lead labels) is OMITTED entirely — never replaced
   *  with a placeholder. Technical specification lines are kept VERBATIM. */
  redactedDescription?: string | null;
  /** Same rewrite, per comment of the THREAD section below. */
  redactedComments?: RedactedComment[] | null;
  /** Same rewrite, per requirement of the REQUIREMENTS section below. */
  redactedRequirements?: Array<{ index: number; text: string }> | null;
}

export interface EnquiryAgentRef {
  id: string;
  name: string;
}

const MODEL = 'openai/gpt-oss-20b';

function buildPrompt(input: { text: string; title?: string; company?: string }): string {
  return `You are a B2B industrial-sales data extractor. Sales agents write a lead-details block for each enquiry. From the text below, extract ONLY these fields and return STRICT JSON (no markdown):

{
  "title": "a concise enquiry title, or null",
  "enquiryNumber": "the enquiry/inquiry number as written (e.g. 'Inquiry 1 - 7 SEP'), or null",
  "sourceLead": "the lead source (e.g. 'company data', 'IndiaMART', 'reference'), or null",
  "location": "the customer location/city/state (e.g. 'Haryana'), or null",
  "company": "client company name, or null",
  "contactName": "contact person name, or null",
  "contactEmail": "contact email, or null",
  "contactPhone": "contact mobile/phone number, or null"
}

Also return:
{
  "redactedDescription": "the DESCRIPTION section below rewritten for the procurement team: OMIT every line that carries only client-identifying details (company names, person names, emails, phone numbers, cities/locations, salesperson/lead-owner names, lead labels like 'Company Name - ...'). NEVER write a placeholder like [redacted] — drop those lines completely. Keep every technical specification line VERBATIM — item names, quantities, dimensions, models, requirements. Ignore the COMMENTS and THREAD sections for this field — redact the DESCRIPTION only. If it has no identifying details, return it unchanged.",
  "redactedComments": [{"id": "comment id from the THREAD section", "content": "that comment rewritten with the same rules: identifying-only lines omitted, technical content verbatim"}],
  "redactedRequirements": [{"index": 0, "text": "the REQUIREMENTS item at that index rewritten with the same rules"}]
}

Rules:
- Match the labels loosely: 'Enquiry Number', 'Inquiry No', 'Source Lead', 'Lead Source',
  'Lead of' (that is the owning agent, NOT the customer — ignore it), 'Company Name',
  'Contact Person', 'Mobile Number', 'Location'.
- If a field is already provided and correct, keep it; otherwise extract from the text.
- NEVER rewrite or summarize the enquiry text — do not output it (except inside redactedDescription).
- Return JSON only.

Current values:
title: ${input.title || '?'}
company: ${input.company || '?'}

Text:
"""${(input.text || '').slice(0, 4000)}"""`;
}

/** Build the extraction input with labeled sections so the model can tell the
 *  description apart from pasted lead-details comments and the discussion
 *  thread. Both write-time and serve-time hash the DESCRIPTION alone — comment
 *  ordering can never break the match. */
export function splitExtractionText(
  description: string,
  firstComments: string,
  thread: Array<{ id: string; content: string }> = [],
  requirements: string[] = [],
): { text: string; description: string } {
  const desc = String(description ?? '');
  const comms = String(firstComments ?? '');
  let text = comms ? `DESCRIPTION:\n${desc}\n\nCOMMENTS:\n${comms}` : desc;
  const items = (thread || [])
    .filter((t) => t && t.id && String(t.content ?? '').trim())
    .slice(0, 20)
    .map((t) => `[${t.id}] ${String(t.content).slice(0, 600)}`);
  // Cap the thread section so the prompt stays small (threads are short).
  let threadText = items.join('\n');
  if (threadText.length > 3000) threadText = threadText.slice(0, 3000);
  if (threadText) text += `\n\nTHREAD:\n${threadText}`;
  const reqs = (requirements || []).map((r) => String(r ?? '').trim()).filter(Boolean).slice(0, 10);
  let reqText = reqs.map((r, i) => `[${i}] ${r.slice(0, 400)}`).join('\n');
  if (reqText.length > 1500) reqText = reqText.slice(0, 1500);
  if (reqText) text += `\n\nREQUIREMENTS:\n${reqText}`;
  return { text, description: desc };
}

function shapeResult(parsed: any): ExtractionResult {
  return {
    title: parsed.title ? String(parsed.title) : null,
    enquiryNumber: parsed.enquiryNumber ? String(parsed.enquiryNumber) : null,
    sourceLead: parsed.sourceLead ? String(parsed.sourceLead) : null,
    location: parsed.location ? String(parsed.location) : null,
    company: parsed.company ? String(parsed.company) : null,
    contactName: parsed.contactName ? String(parsed.contactName) : null,
    contactEmail: parsed.contactEmail ? String(parsed.contactEmail) : null,
    contactPhone: parsed.contactPhone ? String(parsed.contactPhone) : null,
    redactedDescription: parsed.redactedDescription ? String(parsed.redactedDescription) : null,
    redactedComments: Array.isArray(parsed.redactedComments)
      ? parsed.redactedComments
          .filter((r: any) => r && r.id && typeof r.content === 'string')
          .map((r: any) => ({ id: String(r.id), content: String(r.content) }))
      : null,
    redactedRequirements: Array.isArray(parsed.redactedRequirements)
      ? parsed.redactedRequirements
          .filter((r: any) => r && Number.isInteger(r.index) && typeof r.text === 'string')
          .map((r: any) => ({ index: r.index, text: String(r.text) }))
      : null,
  };
}

/** Tiny non-crypto hash (djb2) — identifies the exact source text a cached
 *  AI-redacted description was built from, so serve-time can verify freshness
 *  without trusting timestamps (extraction itself bumps updatedAt). */
export function hashText(s: string): string {
  let h = 5381;
  const str = String(s ?? '');
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/** Procurement-view cache entry: the AI rewrites, keyed by hashes of the
 *  exact source texts. Write-time enrichment fills it; serve-time uses a
 *  piece only when its hash still matches, otherwise marks it pending and
 *  kicks a background re-enrichment. No deterministic text munging anywhere. */
export interface RedactedViewCache {
  description: string;
  descHash: string;
  comments: Record<string, { content: string; hash: string }>;
  requirements: Record<number, { text: string; hash: string }>;
  at: string;
}

export const REDACTED_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function redactedCacheKey(enquiryId: string): string {
  return `enquiry:redacted:${enquiryId}`;
}

/**
 * Extract structured fields from an enquiry's lead-details text. Uses the
 * unified gateway so it inherits key rotation + retry + rate-limit handling and
 * works across any configured provider (Groq, OpenRouter, DeepSeek, …).
 */
export async function extractEnquiryFieldsRobust(
  env: Record<string, unknown>,
  input: { text: string; title?: string; company?: string },
  _agents: EnquiryAgentRef[] = [],
): Promise<ExtractionResult | null> {
  let gateway: ReturnType<typeof getGateway>;
  try {
    gateway = getGateway(env);
  } catch (err) {
    console.error(`[extract] gateway init failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
  if (gateway.keyCount === 0) {
    console.warn('[extract] no AI keys configured (AI_KEYS/GROQ_API_KEYS) — skipping extraction');
    return null;
  }
  try {
    const parsed = await gateway.completeJson<any>({
      messages: [
        { role: 'system', content: 'Extract structured sales-enquiry fields as JSON. Never alter client wording.' },
        { role: 'user', content: buildPrompt(input) },
      ],
      temperature: 0,
      model: MODEL,
      json: true,
    });
    return shapeResult(parsed);
  } catch (err) {
    console.error(`[extract] gateway extraction failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/** @deprecated Use extractEnquiryFieldsRobust(env, input) instead. */
export async function extractEnquiryFields(
  _key: string,
  input: { text: string; title?: string; company?: string },
  agents: EnquiryAgentRef[] = [],
): Promise<ExtractionResult | null> {
  return extractEnquiryFieldsRobust({}, input, agents);
}

/** @deprecated AI keys are now configured via env.AI_KEYS / GROQ_API_KEYS. */
export function pickGroqKey(_env: any): string | null {
  return null;
}

/** @deprecated AI keys are now configured via env.AI_KEYS / GROQ_API_KEYS. */
export function listGroqKeys(_env: any): string[] {
  return [];
}
