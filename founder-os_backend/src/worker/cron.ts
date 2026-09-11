// ─────────────────────────────────────────────────────────────────────────────
// worker/cron.ts — native cron router.
//
// Router pattern: ONE `* * * * *` Cron Trigger (wrangler.toml [triggers]); the
// scheduled handler runs every minute and routes by UTC minute alignment:
//   every-5min  → minute % 5 == 0
//   every-10min → minute % 10 == 0
//   every-15min → minute % 15 == 0
//   every-30min → minute % 30 == 0
//   daily       → 02:30 / 13:30 / 15:30 / 19:30 / 21:30 UTC (one slot per job
//                  family; the `slot` input tells the workflow which jobs run)
//   neodove-refresh → minute % 5 == 0 (native D1 write; GH egress is blocked by NeoDove)
//
// Replaces the cPanel/web-server cron that used to fire workflow_dispatch.
// Free-plan safe (1 Cron Trigger). Heavy AI still runs on the GH Actions runner.
//
// Quiet hours: Zoho/NeoDove-backed analysis pauses 21:00–09:00 IST (no shop-floor
// operation then). isOpsWindow() gates, all from the *scheduled* slot time:
//   - every-10min / every-15min dispatches are skipped (pure NeoDove/Zoho jobs)
//   - every-5min dispatches with run_zoho=false (skips crm + zoho-sent-analyzer;
//     WhatsApp jobs + light triggers keep running)
//   - daily dispatches with run_neodove=false (skips the neodove-report job;
//     brief / telecalling / retention / baseline keep running — they read D1)
//   - the native neodove-refresh (+ dashboard warmer) is skipped in-worker
// Manual dispatch from the Actions tab defaults both inputs to true, so an
// overnight manual run still works.
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
async function dispatchGitHubWorkflow(workflowFile: string, token: string, inputs?: Record<string, string>): Promise<void> {
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
        body: JSON.stringify({ ref: GITHUB_REF, ...(inputs ? { inputs } : {}) }),
      },
    );
    const body = await res.text().catch(() => '');
    const rateLimit = res.headers.get('x-ratelimit-remaining');
    console.log(`[dispatch] ${workflowFile} -> HTTP ${res.status} ratelimit=${rateLimit} ${body.slice(0, 200)}`);
  } catch (e: any) {
    console.error(`[dispatch] ${workflowFile} failed:`, e?.message);
  }
}

/** Ops window 09:00–21:00 IST. Outside it, Zoho/NeoDove-backed analysis pauses. */
function isOpsWindow(now: Date): boolean {
  const istMin = (now.getUTCHours() * 60 + now.getUTCMinutes() + 330) % 1440;
  return istMin >= 540 && istMin < 1260;
}

// Slot map (UTC → IST job family):
//   02:30 (08:00 IST) → telecalling-distribution + morning-brief
//   13:30 (19:00 IST) → eod-summary
//   15:30 (21:00 IST) → telecalling-eod-snatch
//   19:30 (01:00 IST) → baseline-freeze (+ neodove backfill via 02:30 slot)
//   21:30 (03:00 IST) → data-retention
// The workflow gates each job on `inputs.slot` (default 'all' = manual runs
// execute everything). Never gate on `github.event.schedule` — it is only set
// for native `schedule:` events, which these workflows don't have, so such a
// guard silently matches nothing on workflow_dispatch.

export const DAILY_SLOTS = [2 * 60 + 30, 13 * 60 + 30, 15 * 60 + 30, 19 * 60 + 30, 21 * 60 + 30];

/** Which workflows to fire at the current UTC minute. */
function dueWorkflows(now: Date): string[] {
  const min = now.getUTCMinutes();
  const hhmm = now.getUTCHours() * 60 + min;
  const due: string[] = [];
  if (min % 5 === 0) due.push('every-5min');
  if (min % 10 === 0) due.push('every-10min');
  if (min % 15 === 0) due.push('every-15min');
  if (min % 30 === 0) due.push('every-30min');
  if (DAILY_SLOTS.includes(hhmm)) due.push('daily');
  return due;
}

/** "02:30" style slot label for a UTC-minutes time (matches workflow `slot` input). */
export function slotLabel(hhmm: number): string {
  return `${String(Math.floor(hhmm / 60)).padStart(2, '0')}:${String(hhmm % 60).padStart(2, '0')}`;
}

async function runScheduled(event: { cron?: string; scheduledTime?: number }, env: Bindings, ctx: { waitUntil(p: Promise<unknown>): void }): Promise<void> {
  bootstrapEnv(env);
  // Gate cadence on the *scheduled* slot time, not execution time — Cloudflare
  // delivers cron events up to ~1-2 min late, and minute-aligned gates would
  // drift/skip (e.g. the 07:40 slot delivered at 07:41 would skip every-10min).
  const now = new Date(event.scheduledTime ?? Date.now());
  const min = now.getUTCMinutes();

  // neodove-refresh every 5 min in ops hours (native D1 write). Paused in
  // quiet hours — NeoDove is a Zoho/NeoDove-backed analysis source.
  if (min % 5 === 0 && isOpsWindow(now)) {
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
  // Quiet-hours gate (21:00–09:00 IST): pause Zoho/NeoDove-backed analysis.
  // every-10min (neodove-today) and every-15min (effort-sync) are pure
  // NeoDove/Zoho jobs → skipped whole. every-5min still fires for WhatsApp,
  // but with run_zoho=false so crm + zoho-sent-analyzer are skipped. daily
  // still fires (brief / telecalling / retention read D1), but with
  // run_neodove=false so the neodove-report job is skipped.
  const ops = isOpsWindow(now);
  const runs: Promise<void>[] = [];
  for (const key of due) {
    if (!ops && (key === 'every-10min' || key === 'every-15min')) {
      console.log(`[cron] quiet hours — skipping ${key}`);
      continue;
    }
    const inputs: Record<string, string> = {};
    if (key === 'every-5min') inputs.run_zoho = ops ? 'true' : 'false';
    if (key === 'daily') {
      inputs.run_neodove = ops ? 'true' : 'false';
      // Tell the workflow which slot fired so each job runs once/day.
      // Gated on scheduled (not wall-clock) time, like everything else here.
      inputs.slot = slotLabel(now.getUTCHours() * 60 + now.getUTCMinutes());
    }
    runs.push(dispatchGitHubWorkflow(GITHUB_WORKFLOWS[key], token, inputs));
  }
  if (runs.length > 0) {
    ctx.waitUntil(Promise.all(runs));
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