/**
 * Enquiry field extraction — routes through the unified AiGateway
 * (src/shared/ai-gateway.ts) so key rotation, retry, rate-limit cooldowns and
 * multi-provider support are handled in ONE place. This module keeps the
 * extraction prompt + response shaping; the gateway owns the wire call.
 */
import { getGateway } from '../../shared/ai-gateway';

export interface ExtractionResult {
  title?: string | null;
  enquiryNumber?: string | null;
  sourceLead?: string | null;
  location?: string | null;
  company?: string | null;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
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

Rules:
- Match the labels loosely: 'Enquiry Number', 'Inquiry No', 'Source Lead', 'Lead Source',
  'Lead of' (that is the owning agent, NOT the customer — ignore it), 'Company Name',
  'Contact Person', 'Mobile Number', 'Location'.
- If a field is already provided and correct, keep it; otherwise extract from the text.
- NEVER rewrite or summarize the enquiry text — do not output it.
- Return JSON only.

Current values:
title: ${input.title || '?'}
company: ${input.company || '?'}

Text:
"""${(input.text || '').slice(0, 4000)}"""`;
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
  };
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
  const gateway = getGateway(env);
  if (gateway.keyCount === 0) return null;
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
