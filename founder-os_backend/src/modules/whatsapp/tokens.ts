// ── WhatsApp token vault + chat digest rows: persistence ─────────────────
//
// Token vault (per-source API tokens for runners) and chat digest snapshots.
// One home for the prisma.token / prisma.digest calls in
// worker/routes/whatsapp.ts; parsing/serialization lives here so routes stay
// thin orchestrators.
export interface TokenRow {
  source: string;
  token: unknown;
  metadata: unknown;
  createdAt: unknown;
  updatedAt: unknown;
}

export async function saveToken(
  prisma: any,
  args: { source: string; token: unknown; metadata: string | null },
): Promise<string> {
  const tokenStr = JSON.stringify(args.token);
  await prisma.token.upsert({
    where: { source: args.source },
    update: { token: tokenStr, metadata: args.metadata, updatedAt: new Date() },
    create: { source: args.source, token: tokenStr, metadata: args.metadata },
  });
  return new Date().toISOString();
}

export async function getToken(prisma: any, source: string): Promise<Omit<TokenRow, 'createdAt'> | null> {
  const row = await prisma.token.findUnique({ where: { source } });
  if (!row) return null;
  let parsedToken: unknown;
  try { parsedToken = JSON.parse(row.token); } catch { parsedToken = row.token; }
  return {
    source: row.source,
    token: parsedToken,
    metadata: row.metadata ? JSON.parse(row.metadata) : null,
    updatedAt: row.updatedAt,
  };
}

export async function listTokenSources(prisma: any): Promise<unknown[]> {
  const rows = await prisma.token.findMany({ select: { source: true, metadata: true, createdAt: true, updatedAt: true } });
  return (rows as any[]).map((r) => ({
    source: r.source,
    metadata: r.metadata ? JSON.parse(r.metadata) : null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));
}

export interface DigestInput {
  chatId: string;
  chatName: string;
  summary: string;
  priority: string;
  category: string;
  sentiment: string;
  requiresFounder: boolean;
  suggestedReply: string | null;
}

export async function saveDigest(prisma: any, input: DigestInput): Promise<unknown> {
  const { chatId, chatName, ...rest } = input;
  return prisma.digest.upsert({
    where: { id: chatId },
    update: { chatId, chatName, ...rest, createdAt: new Date() },
    create: { id: chatId, chatId, chatName, ...rest, createdAt: new Date() },
  });
}
