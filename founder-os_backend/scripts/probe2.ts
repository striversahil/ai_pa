function numField(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
function strField(v: unknown, max = 300): string | undefined {
  const s = String(v ?? '').trim().slice(0, max);
  return s || undefined;
}
export async function probe(args: Record<string, unknown>): Promise<unknown> {
  return { n: numField(args.x), s: strField(args.y) };
}
