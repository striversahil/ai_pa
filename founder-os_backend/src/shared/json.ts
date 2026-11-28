// json.ts — the one tolerant JSON parse used by routes that store JSON in TEXT.
// A malformed/absent value yields the caller's fallback instead of a throw, so a
// corrupted column can never 500 a whole list endpoint.

export function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (raw == null || raw === '') return fallback;
  try {
    const parsed = JSON.parse(raw);
    return parsed == null ? fallback : (parsed as T);
  } catch {
    return fallback;
  }
}

/** JSON object column (config, metadata): anything non-object becomes `{}`. */
export function safeJsonObject(raw: string | null | undefined): Record<string, unknown> {
  const parsed = safeJsonParse<unknown>(raw, {});
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}
