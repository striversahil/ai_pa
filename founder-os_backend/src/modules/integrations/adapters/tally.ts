// tally.ts — the one built-in payload adapter (Tally FORM_RESPONSE).
//
// Tally sends `data.fields[]` with a question label and a value; a
// multiple-choice answer arrives as option IDs that this adapter resolves
// through the field's own `options[]` text (the REST submissions API returns
// the labels directly — handling both here keeps replay identical).

import { stableId, type DraftEvent, type MappingResult } from '../mapping';

interface TallyField { key?: string; label?: string; type?: string; value?: unknown; options?: Array<{ id?: string; text?: string }> }

function optionText(f: TallyField, v: unknown): string {
  const raw = String(v ?? '');
  const hit = (f.options ?? []).find((o) => String(o.id ?? '') === raw);
  return (hit?.text ?? raw).trim();
}

function answerText(f: TallyField): string {
  const v = f.value;
  if (v == null) return '';
  if (Array.isArray(v)) return v.map((x) => (typeof x === 'object' ? answerText({ value: x, options: f.options }) : optionText(f, x))).filter(Boolean).join(', ');
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const parts = Object.entries(o).map(([k, val]) => `${k.replace(/_/g, ' ')}: ${String(val)}`);
    return parts.join(' · ');
  }
  return optionText(f, v);
}

function findAnswer(answers: Array<[string, string]>, ...needles: string[]): string {
  for (const needle of needles) {
    const hit = answers.find(([label]) => label.includes(needle));
    if (hit && hit[1]) return hit[1];
  }
  return '';
}

function digits(v: string): string {
  let out = '';
  for (const ch of v) if ((ch >= '0' && ch <= '9') || ch === '+') out += ch;
  return out.slice(0, 20);
}

/** Tally FORM_RESPONSE → one activity event (never throws). */
export function normalizeTally(payload: any): MappingResult {
  const data = payload?.data ?? payload;
  const fields = Array.isArray(data?.fields) ? (data.fields as TallyField[]) : null;
  if (!fields) return { events: [], warnings: ['not a Tally FORM_RESPONSE payload (no data.fields)'] };
  const answers: Array<[string, string]> = fields.map((f) => [String(f.label ?? f.key ?? '').toLowerCase().trim(), answerText(f)]);
  const formName = String(data.formName ?? payload?.formName ?? 'Tally form');
  const mill = findAnswer(answers, 'mill name', 'company', 'firm');
  const contact = findAnswer(answers, 'point of contact', 'contact person', 'name');
  const phone = digits(findAnswer(answers, 'phone', 'mobile', 'contact no'));
  const city = findAnswer(answers, 'location', 'city');
  const requirement = findAnswer(answers, 'requirement', 'enquiry');
  const total = findAnswer(answers, 'calculated');
  const isExpense = /expense/i.test(formName);
  const isVisit = /visit|field/i.test(formName);
  const kind = isExpense ? 'expense' : isVisit ? 'visit' : 'lead';
  const summary = answers.filter(([, v]) => v).map(([k, v]) => `${k.replace(/^[^a-z0-9]+/i, '').trim()}: ${v}`).join('\n').slice(0, 4000);
  const title = (isExpense ? formName : mill || formName).slice(0, 200);
  const amountRaw = total ? Number((total.match(/[0-9]+(\.[0-9]+)?/) ?? [])[0]) : NaN;
  const event: DraftEvent = {
    externalId: String(data.submissionId ?? data.responseId ?? payload?.eventId ?? stableId(data)),
    kind,
    occurredAt: new Date(String(data.createdAt ?? data.submittedAt ?? payload?.createdAt ?? Date.now())).toISOString(),
    title,
    summary,
    company: mill,
    contactName: contact,
    phone,
    email: findAnswer(answers, 'email').toLowerCase(),
    city,
    amount: Number.isFinite(amountRaw) ? amountRaw : null,
    payload: { formId: data.formId, formName, submissionId: data.submissionId, answers: Object.fromEntries(answers), fields },
  };
  return { events: [event], warnings: requirement ? [] : [] };
}