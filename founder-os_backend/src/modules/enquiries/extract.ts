// Groq-based real-time enquiry field extraction.
//
// Called from the worker after an enquiry is created/edited AND after the first
// 1–2 comments are added: the sales agent writes the lead-details block in the
// first comment(s), and this parses it into structured fields. The client's
// wording is NEVER rewritten. Keys rotate randomly per call (GROQ_API_KEYS,
// comma-separated; server-side only).

export interface ExtractionResult {
  title?: string | null;
  enquiryNumber?: string | null;
  sourceLead?: string | null;
  location?: string | null;
  company?: string | null;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  // NOTE: agent assignment is NOT done here — "Lead of" = the enquiry's
  // creator, set at creation time (no AI guessing).
}

export interface EnquiryAgentRef {
  id: string;
  name: string;
}

export function pickGroqKey(env: any): string | null {
  const raw = (env?.GROQ_API_KEYS as string) || "";
  const keys = raw.split(",").map((k) => k.trim()).filter(Boolean);
  if (keys.length === 0) return null;
  return keys[Math.floor(Math.random() * keys.length)];
}

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = "openai/gpt-oss-20b";

export async function extractEnquiryFields(
  key: string,
  input: { text: string; title?: string; company?: string },
  agents: EnquiryAgentRef[],
): Promise<ExtractionResult | null> {
  const prompt = `You are a B2B industrial-sales data extractor. Sales agents write a lead-details block for each enquiry. From the text below, extract ONLY these fields and return STRICT JSON (no markdown):

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
title: ${input.title || "?"}
company: ${input.company || "?"}

Text:
"""${(input.text || "").slice(0, 4000)}"""`;

  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "Extract structured sales-enquiry fields as JSON. Never alter client wording." },
        { role: "user", content: prompt },
      ],
    }),
  });
  if (!res.ok) {
    console.log("groq extract failed:", res.status, (await res.text()).slice(0, 200));
    return null;
  }
  const data: any = await res.json();
  const content = data?.choices?.[0]?.message?.content || "";
  try {
    const parsed = JSON.parse(content.replace(/```json|```/g, "").trim());
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
  } catch {
    return null;
  }
}