// prompt.ts — the chat-agent prompt that turns a vendor sheet into typed rates.
//
// The Rates tab offers "Copy prompt": it copies a prompt that already carries the
// active vendors (name + location only) and points the model at the KYP JSON the
// neighbouring button downloads. The model answers with the envelope that
// `rate-import.ts` accepts, the user pastes it back, and every row is typechecked
// by the live catalogue before it lands.
//
// The prompt is editable in the dashboard and stored in the `Setting` table
// (key `product-line:rate-prompt`) so an edit is shared and survives reloads.
import { prisma } from '../../shared/prisma';

export const RATE_PROMPT_KEY = 'product-line:rate-prompt';
export const VENDOR_PLACEHOLDER = '{{ACTIVE_VENDORS}}';
const MAX_PROMPT_LEN = 20000;

/** Shipped prompt — the "Reset to default" target. */
export const DEFAULT_RATE_PROMPT = [
  'You convert messy vendor rate sheets into typed KYP vendor-rate JSON for Founder OS.',
  '',
  'INPUTS',
  '1. The KYP schema JSON (attached). Under definitions/<product_key> you get:',
  '   - properties = the spec keys that product accepts (enum / minimum / maximum)',
  '   - required   = spec keys every quote MUST answer',
  '   - x-aliases  = other names buyers and vendors use for the product',
  '2. The vendor document (photo, PDF text, Excel paste or email body).',
  '3. ACTIVE VENDORS — the only suppliers already in the system.',
  '',
  'ACTIVE VENDORS',
  VENDOR_PLACEHOLDER,
  '',
  'OUTPUT',
  'Exactly one fenced ```json block and nothing else, in this shape:',
  '{',
  '  "create_vendors": false,',
  '  "rates": [',
  '    {',
  '      "product_key": "milling_fabric",',
  '      "vendor": "Shreeji Textiles",',
  '      "vendor_location": "Ahmedabad",',
  '      "unit": "meter",',
  '      "price_per_unit": 120,',
  '      "discount_percent": 10,',
  '      "moq": "100 m",',
  '      "delivery_days": 5,',
  '      "delivery_max_days": 7,',
  '      "quoted_at": "2026-11-20",',
  '      "notes": "2026 rate list",',
  '      "specs": { "grade": "GG", "grade_number": 40, "width_cm": 140, "brand": "PIX" }',
  '    }',
  '  ]',
  '}',
  '',
  'RULES',
  '- product_key MUST be a key from the schema. Match through x-aliases and the product name. Never invent a product.',
  '- specs keys MUST exist in that product properties. Only brand, material and machine_make_model are accepted everywhere.',
  '- Respect the schema: enum values verbatim, numbers as numbers (40, not "40 mm"), stay inside minimum / maximum.',
  '- A required spec you cannot read is LEFT OUT. Never invent, never guess a grade or size.',
  '- Money is numeric INR per unit — no ₹, no commas. discount_percent is 0–100.',
  '- Dates are YYYY-MM-DD. delivery_max_days must be >= delivery_days.',
  '- A range becomes: lower bound in price_per_unit and delivery_days, upper bound in delivery_max_days.',
  '- unit must be one of: kg, meter, piece, roll, set, litre, sqm, sqft, box, pair, bundle, ton.',
  '- vendor: match the ACTIVE VENDORS list ignoring case and punctuation. If the vendor is new, keep its real name, put its city in vendor_location and set create_vendors to true.',
  '- One row per vendor + product + spec combination. Never merge rows with different specs.',
  '- Skip lines you cannot classify and list them under "unclassified": ["..."] at the top level.',
  '- A non-INR price is converted to INR, with the conversion noted in notes.',
].join('\n');

/** Active vendors as the prompt shows them: name and location only. */
export function vendorBlock(vendors: { name?: unknown; location?: unknown }[]): string {
  const lines = (vendors ?? [])
    .map((v) => {
      const name = String(v?.name ?? '').trim();
      const loc = String(v?.location ?? '').trim();
      return name ? `- ${name}${loc ? ` — ${loc}` : ''}` : '';
    })
    .filter(Boolean);
  return lines.length ? lines.join('\n') : '(none yet — every vendor in the sheet is new, set create_vendors to true)';
}

/** Fill the placeholder (or append the list when the template dropped it). */
export function renderPrompt(template: string, vendors: { name?: unknown; location?: unknown }[]): string {
  const block = vendorBlock(vendors);
  const text = String(template ?? '');
  if (text.includes(VENDOR_PLACEHOLDER)) return text.split(VENDOR_PLACEHOLDER).join(block);
  return `${text.trimEnd()}\n\nACTIVE VENDORS\n${block}`;
}

function cleanTemplate(v: unknown): string {
  const text = String(v ?? '').replace(/\r\n/g, '\n').slice(0, MAX_PROMPT_LEN);
  if (text.trim().length < 20) throw new Error('prompt is too short to be useful');
  return text;
}

/** The saved prompt (or the shipped one when nothing was saved yet). */
export async function getRatePrompt(): Promise<{ template: string; isDefault: boolean }> {
  try {
    const row = await (prisma as any).setting.findUnique({ where: { key: RATE_PROMPT_KEY } });
    const saved = String(row?.value ?? '');
    if (saved.trim()) return { template: saved, isDefault: saved === DEFAULT_RATE_PROMPT };
  } catch {
    /* fall through to the shipped prompt */
  }
  return { template: DEFAULT_RATE_PROMPT, isDefault: true };
}

export async function saveRatePrompt(raw: unknown): Promise<{ template: string; isDefault: boolean }> {
  const template = cleanTemplate(raw);
  await (prisma as any).setting.upsert({
    where: { key: RATE_PROMPT_KEY },
    update: { value: template },
    create: { key: RATE_PROMPT_KEY, value: template },
  });
  return { template, isDefault: template === DEFAULT_RATE_PROMPT };
}

/** Reset back to the shipped prompt. */
export async function resetRatePrompt(): Promise<{ template: string; isDefault: boolean }> {
  await (prisma as any).setting.delete({ where: { key: RATE_PROMPT_KEY } }).catch(() => {});
  return { template: DEFAULT_RATE_PROMPT, isDefault: true };
}

/** Everything the "Copy prompt" drawer needs in one round trip. */
export async function promptForCopy(): Promise<{
  template: string;
  defaultTemplate: string;
  rendered: string;
  isDefault: boolean;
  vendorCount: number;
}> {
  const [{ template, isDefault }, vendors] = await Promise.all([
    getRatePrompt(),
    (prisma as any).vendor.findMany({ where: { active: true }, select: { name: true, location: true }, orderBy: { name: 'asc' } })
      .catch(() => []),
  ]);
  const list = (vendors ?? []) as { name: string; location: string | null }[];
  return {
    template,
    defaultTemplate: DEFAULT_RATE_PROMPT,
    rendered: renderPrompt(template, list),
    isDefault,
    vendorCount: list.length,
  };
}
