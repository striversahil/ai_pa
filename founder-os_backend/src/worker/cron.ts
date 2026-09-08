// ─────────────────────────────────────────────────────────────────────────────
// worker/cron.ts — native cron router.
//
// Router pattern: ONE `* * * * *` Cron Trigger (wrangler.toml [triggers]); the
// scheduled handler runs every minute and routes by UTC minute alignment:
//   every-5min  → minute % 5 == 0
//   every-10min → minute % 10 == 0
//   every-15min → minute % 15 == 0
//   every-30min → minute % 30 == 0
//   daily       → 02:30 / 03:30 / 13:30 / 21:30 UTC
//   neodove-refresh → minute % 10 == 0 (native D1 write; GH egress is blocked by NeoDove)
//
// Replaces the cPanel/web-server cron that used to fire workflow_dispatch.
// Free-plan safe (1 Cron Trigger). Heavy AI still runs on the GH Actions runner.
// ─────────────────────────────────────────────────────────────────────────────
import { bootstrapEnv, refreshNeodoveReport, neodoveTodayIst, type Bindings } from './context';
import { getTelecallingDashboardData } from '../automations/telecalling/service';

const GITHUB_REPO = 'striversahil/ai_pa';
const GITHUB_REF = 'main';
const GITHUB_WORKFLOWS: Record<string, string> = {
  'every-5min': 'cron-every-5min.yml',
  'every-10min': 'cron-every-10min.yml',
  'every-15min': 'cron-every-15min.yml',
  'every-30min': 'cron-every-30min.yml',
  daily: 'cron-daily-ist.yml',
};

/** Fire one GitHub Actions workflow_dispatch (best-effort; never throws). */
async function dispatchGitHubWorkflow(workflowFile: string, token: string): Promise<void> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/${workflowFile}/dispatches`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
          'User-Agent': 'founder-os-worker',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        body: JSON.stringify({ ref: GITHUB_REF }),
      },
    );
    const body = await res.text().catch(() => '');
    const rateLimit = res.headers.get('x-ratelimit-remaining');
    console.log(`[dispatch] ${workflowFile} -> HTTP ${res.status} ratelimit=${rateLimit} ${body.slice(0, 200)}`);
  } catch (e: any) {
    console.error(`[dispatch] ${workflowFile} failed:`, e?.message);
  }
}

/** Which workflows to fire at the current UTC minute. */
function dueWorkflows(now: Date): string[] {
  const min = now.getUTCMinutes();
  const hhmm = now.getUTCHours() * 60 + min;
  const due: string[] = [];
  if (min % 5 === 0) due.push('every-5min');
  if (min % 10 === 0) due.push('every-10min');
  if (min % 15 === 0) due.push('every-15min');
  if (min % 30 === 0) due.push('every-30min');
  if ([2 * 60 + 30, 3 * 60 + 30, 13 * 60 + 30, 21 * 60 + 30].includes(hhmm)) due.push('daily');
  return due;
}

async function runScheduled(event: { cron?: string; scheduledTime?: number }, env: Bindings, ctx: { waitUntil(p: Promise<unknown>): void }): Promise<void> {
  bootstrapEnv(env);
  // Gate cadence on the *scheduled* slot time, not execution time — Cloudflare
  // delivers cron events up to ~1-2 min late, and minute-aligned gates would
  // drift/skip (e.g. the 07:40 slot delivered at 07:41 would skip every-10min).
  const now = new Date(event.scheduledTime ?? Date.now());
  const min = now.getUTCMinutes();

  // neodove-refresh every 10 min (native D1 write).
  if (min % 10 === 0) {
    ctx.waitUntil(
      refreshNeodoveReport(neodoveTodayIst(0))
        .then((r) => console.log(`[cron] neodove-refresh ${r.reportDate}: ok=${r.ok} stored=${r.stored} ${r.error ?? ''}`))
        .catch((e: any) => console.error('[cron] neodove-refresh failed:', e?.message)),
    );
    // Dashboard warmer: pre-compute the hot filter payloads (today/week/month)
    // into KV right after the refresh, so page loads and filter clicks never
    // eat a cold aggregation. Sequential (no self-contention); each compute is
    // ~2-3s of mostly I/O wait. Failures are silent — worst case the next user
    // request computes on demand as before.
    ctx.waitUntil(
      (async () => {
        for (const period of ['today', 'week', 'month']) {
          const t0 = Date.now();
          try {
            await getTelecallingDashboardData({ subject: { period } } as any);
            console.log(`[cron] dash-warm ${period}: ok in ${Date.now() - t0}ms`);
          } catch (e: any) {
            console.error(`[cron] dash-warm ${period} failed:`, e?.message);
          }
        }
      })(),
    );
  }

  // GitHub Actions dispatcher — fire workflow_dispatch for every due workflow.
  const token = env.GITHUB_ACCESS_TOKEN;
  if (!token) {
    console.error('[cron] GITHUB_ACCESS_TOKEN not set — dispatcher disabled');
    return;
  }
  const due = dueWorkflows(now);
  if (due.length > 0) {
    ctx.waitUntil(
      Promise.all(due.map((key) => dispatchGitHubWorkflow(GITHUB_WORKFLOWS[key], token))),
    );
  }
}

export const scheduled: ExportedHandlerScheduledHandler<Bindings, unknown> = async (event, env, ctx) => {
  console.log(`[cron] fired scheduledTime=${event.scheduledTime ?? 'n/a'}`);
  try {
    await runScheduled(event, env, ctx);
  } catch (e: any) {
    console.error('[cron] scheduled handler error:', e?.message, e?.stack?.slice(0, 300));
  }
};