// Groq-based real-time enquiry field extraction.
//
// Called from the worker after an enquiry is created/edited: parses the freeform
// description into structured fields (title, company, contact, assigned agent).
// The DESCRIPTION IS NEVER REWRITTEN — the client's wording stays verbatim.
// Keys rotate randomly per call (GROQ_API_KEYS, comma-separated; server-side only).

export interface ExtractionResult {
  title?: string | null;
  company?: string | null;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  agentId?: string | null;
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
  input: { description: string; title?: string; company?: string; agentHint?: string },
  agents: EnquiryAgentRef[],
): Promise<ExtractionResult | null> {
  const agentNames = agents.map((a) => `${a.name} (id:${a.id})`).join("\n");
  const prompt = `You are a B2B industrial-sales data extractor. From the enquiry text below, extract ONLY these fields and return STRICT JSON (no markdown):

{
  "title": "a concise enquiry title, or null",
  "company": "client company name, or null",
  "contactName": "contact person name, or null",
  "contactEmail": "contact email, or null",
  "contactPhone": "contact phone, or null",
  "agentId": "the id of the most relevant sales agent from the provided list, or null"
}

Rules:
- Pick the sales agent id from this list:
${agentNames || "(no agents available)"}
- If a field is already provided and correct, keep it; otherwise extract from the text.
- NEVER rewrite or summarize the description or requirements — do not output them.
- Return JSON only.

Current values:
title: ${input.title || "?"}
company: ${input.company || "?"}

Enquiry text:
"""${(input.description || "").slice(0, 4000)}"""`;

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
    const agentId = parsed.agentId ? String(parsed.agentId) : null;
    // Only accept an agentId that's actually in the list.
    const validAgentId = agentId && agents.some((a) => a.id === agentId) ? agentId : null;
    return {
      title: parsed.title ? String(parsed.title) : null,
      company: parsed.company ? String(parsed.company) : null,
      contactName: parsed.contactName ? String(parsed.contactName) : null,
      contactEmail: parsed.contactEmail ? String(parsed.contactEmail) : null,
      contactPhone: parsed.contactPhone ? String(parsed.contactPhone) : null,
      agentId: validAgentId,
    };
  } catch {
    return null;
  }
}