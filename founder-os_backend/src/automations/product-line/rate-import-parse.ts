// rate-import-parse.ts — the pure half of the paste importer.
//
// Split out (2026-11-23) so the guard can bundle it without the D1 layer: the
// parser is what "paste the assistant's answer" depends on, and a chat model
// happily wraps its JSON in prose or a code fence.

/** Pull the JSON out of a chat answer: fenced block first, else first {...}/[...]. */
export function extractJsonPayload(text: string): unknown {
  const raw = String(text ?? '').trim();
  if (!raw) throw new Error('paste the JSON the assistant produced');
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence ? fence[1] : raw;
  const trimmed = body.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.search(/[[{]/);
    const end = Math.max(trimmed.lastIndexOf('}'), trimmed.lastIndexOf(']'));
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch { /* fall through */ }
    }
    throw new Error('that is not valid JSON — copy the whole block the assistant returned');
  }
}

export function rowsOf(payload: unknown): any[] {
  const anyObj = payload as any;
  if (Array.isArray(anyObj)) return anyObj;
  if (anyObj && Array.isArray(anyObj.rates)) return anyObj.rates;
  if (anyObj && Array.isArray(anyObj.quotes)) return anyObj.quotes;
  if (anyObj && typeof anyObj === 'object' && (anyObj.product_key || anyObj.product)) return [anyObj];
  throw new Error('expected {"rates": [ … ]} — see the prompt for the exact shape');
}


function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/[^0-9.+-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

export { num };
