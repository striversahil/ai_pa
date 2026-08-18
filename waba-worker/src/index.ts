import { WorkerEntrypoint } from "cloudflare:workers";

export interface Env {
  DB: D1Database;
  SHARED_SECRET: string;          // wrangler secret — used by GitHub Actions + dashboard
  WA_ENGINE_API_KEY: string;      // wrangler secret — validates waengine.pro webhook signature
}

/**
 * waba-worker — Cloudflare free-tier ingress for WhatsApp webhooks.
 *
 *   POST /webhook          waengine.pro → stored raw into D1 (acked instantly)
 *   GET  /api/logs         auth: Bearer SHARED_SECRET — recent rows; ?mode=cron → unprocessed only
 *   POST /api/update       auth: Bearer SHARED_SECRET — mark processed + store ai_result
 *   GET  /dashboard        minimal live dashboard (reads /api/logs)
 *   GET  /health           liveness
 *
 * The GitHub Actions runner polls /api/logs?mode=cron, classifies each row with
 * the founder-os classifier (deterministic rules + LLM fallback), and writes the
 * result back through /api/update. Idempotent by whatsapp_id (UNIQUE index).
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return new Response("ok", { status: 200 });
    }

    // ── 1. Incoming webhook from waengine.pro ──────────────────────────────
    if (request.method === "POST" && url.pathname === "/webhook") {
      return handleWebhook(request, env);
    }
    // Some platforms verify webhook ownership with a GET challenge before
    // enabling delivery. Respond 200 so delivery gets activated.
    if (request.method === "GET" && url.pathname === "/webhook") {
      const challenge = url.searchParams.get("hub.challenge")
        || url.searchParams.get("challenge");
      return new Response(challenge || "ok", { status: 200 });
    }

    // ── 2. Dashboard + runner API ──────────────────────────────────────────
    if (request.method === "GET" && url.pathname === "/api/logs") {
      return handleLogs(request, env);
    }
    if (request.method === "POST" && url.pathname === "/api/update") {
      return handleUpdate(request, env);
    }
    if (request.method === "GET" && url.pathname === "/dashboard") {
      return dashboardHtml();
    }

    return new Response("Not Found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;

function isAuthorized(request: Request, env: Env): boolean {
  const auth = request.headers.get("Authorization") || "";
  return auth === `Bearer ${env.SHARED_SECRET}`;
}

async function handleWebhook(request: Request, env: Env): Promise<Response> {
  try {
    const raw = await request.text();
    console.log("webhook raw body:", raw);
    const payload = JSON.parse(raw);

    // WA Engine Pro subscribes webhooks and signs them with the account key.
    const provided = request.headers.get("X-Api-Key") || "";
    console.log("webhook hit", { method: request.method, apiKey: provided ? "present" : "absent" });
    if (env.WA_ENGINE_API_KEY && provided && provided !== env.WA_ENGINE_API_KEY) {
      return new Response("Forbidden", { status: 403 });
    }

    const event = payload.event || "";
    console.log("webhook event:", event);

    // Persist inbound messages (AI triage) and outbound status events (delivery
    // tracking). Both are stored so the dashboard shows the full conversation.
    if (event === "message.received" || event === "message.status") {
      const direction = event === "message.received" ? "inbound" : "outbound";
      const d = payload.data || {};
      const message = d.message
        || { id: d.wa_message_id, text: { body: d.text || "" }, type: d.type || "text" };
      const wabaId = message?.id || message?.message_id || message?.wa_id ||
        d.wa_message_id ||
        `${d.phone || d.recipient || "unknown"}:${message?.timestamp || payload.timestamp || Date.now()}`;
      const now = new Date().toISOString();

      await env.DB.prepare(
        `INSERT INTO waba_payloads (whatsapp_id, payload, direction, created_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(whatsapp_id) DO UPDATE SET payload = excluded.payload, direction = excluded.direction`
      ).bind(wabaId, raw, direction, now).run();
    }

    return new Response("EVENT_RECEIVED", { status: 200 });
  } catch (err) {
    console.log("webhook ERROR:", String(err));
    return new Response("Internal Processing Error", { status: 500 });
  }
}

async function handleLogs(request: Request, env: Env): Promise<Response> {
  if (!isAuthorized(request, env)) return new Response("Unauthorized", { status: 401 });
  const url = new URL(request.url);
  const mode = url.searchParams.get("mode");
  let query: string;
  let params: unknown[] = [];
  if (mode === "cron") {
    query = "SELECT id, whatsapp_id, direction, payload FROM waba_payloads WHERE processed = 0 ORDER BY id ASC LIMIT 5";
  } else {
    query = "SELECT * FROM waba_payloads ORDER BY created_at DESC, id DESC LIMIT 100";
    const chatId = url.searchParams.get("chat");
    if (chatId) {
      query = "SELECT * FROM waba_payloads WHERE payload LIKE ? ORDER BY created_at DESC, id DESC LIMIT 100";
      params = [`%${chatId}%`];
    }
  }
  const { results } = await env.DB.prepare(query).bind(...params).all();
  return new Response(JSON.stringify(results), {
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}

async function handleUpdate(request: Request, env: Env): Promise<Response> {
  if (!isAuthorized(request, env)) return new Response("Unauthorized", { status: 401 });
  try {
    const body = await request.json<{ id: number; ai_result?: string }>();
    if (typeof body?.id !== "number") return new Response("Bad Request", { status: 400 });
    await env.DB.prepare(
      "UPDATE waba_payloads SET processed = 1, ai_result = ?, processed_at = ? WHERE id = ?"
    ).bind(body.ai_result ?? null, new Date().toISOString(), body.id).run();
    return new Response("Success", { status: 200 });
  } catch {
    return new Response("Bad Request", { status: 400 });
  }
}

function dashboardHtml(): Response {
  const html = `<!DOCTYPE html>
<html>
<head>
  <title>WhatsApp Processing Dashboard</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-gray-900 text-white p-8">
  <h1 class="text-2xl font-bold text-green-400 mb-4">📱 WhatsApp Processing Dashboard</h1>
  <div class="mb-4">
    <input id="secret" type="password" placeholder="SHARED_SECRET" class="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm" />
    <button onclick="load()" class="bg-green-600 hover:bg-green-500 text-white text-sm font-bold rounded px-3 py-1.5 ml-2">Load</button>
  </div>
  <div class="bg-gray-800 p-4 rounded-lg">
    <table class="w-full text-left">
      <thead><tr class="border-b border-gray-700 text-gray-400"><th>Time</th><th>Status</th><th>AI Result</th></tr></thead>
      <tbody id="rows"></tbody>
    </table>
  </div>
  <script>
    async function load() {
      const secret = document.getElementById('secret').value;
      if (!secret) return alert('Enter SHARED_SECRET');
      const res = await fetch('/api/logs', { headers: { 'Authorization': 'Bearer ' + secret } });
      const data = await res.json();
      document.getElementById('rows').innerHTML = data.map(r => \`
        <tr class="border-b border-gray-700 text-sm">
          <td class="p-2">\${r.created_at}</td>
          <td class="p-2">\${r.processed === 1 ? '✅ Done' : '⏳ Pending'}</td>
          <td class="p-2 font-mono text-xs max-w-xl truncate">\${r.ai_result || 'None'}</td>
        </tr>\`).join('');
    }
    document.getElementById('secret').addEventListener('keydown', e => { if (e.key === 'Enter') load(); });
  </script>
</body>
</html>`;
  return new Response(html, { headers: { "Content-Type": "text/html" } });
}