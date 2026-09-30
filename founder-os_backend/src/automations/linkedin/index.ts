import { prisma } from '../../shared/prisma';
import { logger } from '../../shared/logger';
import { cached } from '../../shared/cache';

/**
 * LinkedIn — Daily Founder Content (BUI).
 *
 * Generation runs in scripts/linkedin-daily-runner.js (GH Actions, 00:30 UTC
 * = 06:00 IST): topic rotation → web research (Tavily→Brave→Serper→DDG-lite)
 * → research brief → draft → edit → AI explainer visual, 5 drafts/batch, all
 * via the unified AI gateway (agnes-3.0-flash). The runner POSTs the batch to
 * /api/runner/linkedin/batch; text lands in D1 (LinkedinPost), images in KV
 * (linkedin:img:<id>, 90-day TTL). This data() serves today's batch + history
 * for the dashboard review card. Posting stays manual — the Worker never
 * touches the LinkedIn API.
 */

export async function handler() {
  // Triggered via GH Actions → /api/trigger/linkedin. The actual work lives
  // in scripts/linkedin-daily-runner.js; this is a no-op heartbeat so manual
  // triggers from the admin panel resolve cleanly.
  logger.info('LinkedIn automation triggered — GH runner owns generation.');
}

export interface LinkedinBatchPost {
  id: string;
  topic: string;
  pillar: string;
  format: string;
  researchBrief: string;
  postDraft: string;
  postFinal: string;
  hashtags: string;
  visualBrief: string;
  hasImage: boolean;
  imageUrl: string | null;
  status: string;
  picked: boolean;
}

function istDateString(d: Date): string {
  return new Date(d.getTime() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function toPost(r: any): LinkedinBatchPost {
  return {
    id: String(r.id),
    topic: String(r.topic ?? ''),
    pillar: String(r.pillar ?? ''),
    format: String(r.format ?? ''),
    researchBrief: String(r.researchBrief ?? ''),
    postDraft: String(r.postDraft ?? ''),
    postFinal: String(r.postFinal ?? ''),
    hashtags: String(r.hashtags ?? ''),
    visualBrief: String(r.visualBrief ?? ''),
    hasImage: !!r.hasImage,
    imageUrl: r.hasImage ? `/api/linkedin/image/${encodeURIComponent(String(r.id))}` : null,
    status: String(r.status ?? 'draft'),
    picked: !!r.picked,
  };
}

async function computeLinkedinData() {
  const today = istDateString(new Date());
  const batch = await (prisma as any).linkedinPost.findMany({
    where: { batchDate: today },
    orderBy: { createdAt: 'asc' },
  });
  const recentBatches: string[] = await (prisma as any).$queryRawUnsafe(
    `SELECT DISTINCT batchDate AS d FROM LinkedinPost ORDER BY batchDate DESC LIMIT 7`,
  ).then((rows: any[]) => (rows || []).map((r: any) => String(r.d))).catch(() => []);
  const counts = await (prisma as any).$queryRawUnsafe(
    `SELECT status AS s, COUNT(*) AS n FROM LinkedinPost GROUP BY status`,
  ).then((rows: any[]) => Object.fromEntries((rows || []).map((r: any) => [String(r.s), Number(r.n)]))).catch(() => ({}));
  return {
    date: today,
    ready: batch.length > 0,
    posts: batch.map(toPost),
    recentBatches,
    totals: counts,
  };
}

/**
 * Dashboard data provider — `GET /api/automations/linkedin/data`.
 * KV-cached 60s (single-flight); the runner busts it on batch ingest.
 */
export async function data() {
  return cached('linkedin:data', 60 * 1000, computeLinkedinData);
}
