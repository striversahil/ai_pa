// AsyncTaskRunner Durable Object — runs long automations in the background,
// decoupled from the GitHub Actions request that triggered them.
//
// Flow:
//   POST /schedule?slug=<s>&origin=<o>  → stores the job + sets a ~1s alarm
//   alarm()                             → calls the worker's internal sync
//                                          endpoint, which runs the scan to
//                                          completion (request stays open for
//                                          the full scan duration, same as the
//                                          old synchronous path) and broadcasts
//                                          the live event when done.
//
// Using an alarm (not the caller's waitUntil) keeps the scan independent of the
// trigger request's lifecycle, so multi-minute scans are never truncated.

export class AsyncTaskRunner {
  state: DurableObjectState;
  env: any;

  constructor(state: DurableObjectState, env: any) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/schedule") {
      const slug = url.searchParams.get("slug") || "";
      const origin = url.searchParams.get("origin") || "";
      await this.state.storage.put("job", { slug, origin });
      await this.state.storage.setAlarm(Date.now() + 1000);
      return new Response(JSON.stringify({ ok: true, slug }), {
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("not found", { status: 404 });
  }

  async alarm(): Promise<void> {
    const job = (await this.state.storage.get("job")) as { slug: string; origin: string } | undefined;
    if (!job) return;
    const secret = this.env.SHARED_SECRET || "";
    try {
      await fetch(`${job.origin}/api/internal/run-automation?slug=${encodeURIComponent(job.slug)}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}` },
      });
    } catch (e: any) {
      console.error("AsyncTaskRunner alarm failed:", e?.message);
    } finally {
      await this.state.storage.deleteAlarm().catch(() => {});
    }
  }
}
