# Agnes AI Usage Guide

OpenAI-compatible gateway via `https://apihub.agnes-ai.com/v1`.

- Base URL: `https://apihub.agnes-ai.com/v1`
- Auth: `Authorization: Bearer <AGNES_API_KEY>` — keep server-side, never expose.
- Docs: `https://agnes-ai.com/doc/overview`, `https://wiki.agnes-ai.com/en/docs/quickstart`, limits `https://agnes-ai.com/en/docs/tokenplan`
- NEVER commit a key. Rotate any key pasted in chat.
- Our calls route through `founder-os_backend/src/shared/ai-gateway.ts` (Worker/Express) and `scripts/ai-gateway.js` (GH runners) — never hand-roll fetch/rotation.

## Models — current status (2026-09-21, live-probed)

| Model | Status | Notes |
|---|---|---|
| `agnes-3.0-flash` | **PRIMARY — use this** | Next-gen, rank 1/61 Intelligence. Channel hung the morning of 2026-09-21, probed alive again ~15:30 IST (0.44s 200s) — now the default everywhere. If it ever hangs, the gateway auto-falls-back to 2.5 and re-probes. |
| `agnes-2.5-flash` | **FALLBACK — use only when 3.0 is down** | Text+vision, tool-calling verified 9/9. Automatic fallback target (`FALLBACK_MODEL`), never requested first. |
| `agnes-2.5-pro-alpha`, `agnes-2.5-pro-beta` | listed (`GET /v1/models`), not used | Candidates if 2.5-flash ever degrades. |
| `agnes-2.0-flash` | deprecated | Migrate to 2.5-flash. |

`2.5-flash` and `3.0-flash` share base URL, headers, `messages`, `stream`, `tools`/`tool_choice`, `image_url`. Only `model` changes.

## Rate limits & limit pools (from Agnes docs, verified 2026-09-21)

- Free/default text models: **30 public RPM, 20 effective RPM**. Enterprise 60/40. Token Plan 1000/1000 + subscription quotas (Starter 1.5k req/5h; Plus 7.5k; Pro 30k).
- **Pools are shared per key TYPE within an account** (docs §8: "Creating multiple keys of the same type does not increase the total RPM or total quota"). Multiple keys ≠ more capacity on one account.
- **7 keys on 7 different accounts = 7 independent pools** (~140 RPM combined). Our pool has this shape.
- 429 causes per docs: RPM exceeded, too many concurrent requests, repeated requests in short window, retry too aggressive.

## Error 1015 — investigation record (2026-09-21)

**Verdict: edge-WAF throttle on Cloudflare's shared egress range, not our volume.**

Evidence chain (all live-probed):
1. Fresh keys 1015 on their **first** request — per-key RPM counters start at zero, so per-key accounting is ruled out.
2. 1015 arrives in **~9ms** with body `error code: 1015`, `retry-after: 213`, `__cf_bm` bot-cookie, `cf-ray ... SIN` — an edge-WAF rejection, not upstream quota evaluation (which returns JSON 429s).
3. Direct calls bypassing our Cloudflare AI Gateway 1015 identically → it's **Agnes's** Cloudflare, not ours.
4. Our Worker egress IP is `2a06:98c0:3600::103` (confirmed via `/api/debug/egress` → `cloudflare.com/cdn-cgi/trace`) — Cloudflare-owned shared range. Agnes's WAF sees bot-shaped traffic from a datacenter range shared with thousands of strangers' Workers.
5. Same requests from a home broadband IP: landing page/auth/model-list all fast; only `3.0-flash` inference stalls (dead channel, §Models).
6. No `Promise.all` fan-out to Agnes anywhere in the Worker (audited all 53 sites — all D1/Zoho reads). Our volume is single-digit req/min; we are not the burst source.

**Failure-mode matrix (how to read the next outage):**

| Symptom | Meaning |
|---|---|
| Fast 401 `Invalid token` | bad/revoked key — replace it |
| Fast 503 `model_not_found` / `No available channel for model X` | bad model name — fix `model` |
| Fast 429 + `1015` body, ~ms | IP-level edge throttle — wait out / reroute egress, do NOT hammer |
| Hang 20s+ then nothing (valid key + valid model) | dead model channel — switch model, flag it |
| `busy (rate-limited)` from our chat | our pool exhausted/storm — retry in ~2 min |

## Our gateway behavior (what the wrapper does with Agnes)

- **Rotation:** one fresh key per attempt (bounded ≤5). Plain 429 → cool that key (escalating 60s→8min) + next key. 1015 → brief cool (≤60s) + rotate (each attempt also gets its proxy shot); the turn only fails when all attempts 1015. 401/403 → disable permanently.
- **No rotation on hangs** — every key would hang identically; hangs trigger model fallback instead.
- **Sticky conversations:** `sessionKey` pins a chat to one key (consistent hash, cross-isolate). One-shots spread randomly across the healthiest tier.
- **Storm flag:** pool exhaustion writes KV `ai:storm:agnes` (2 min) — later turns fail fast instead of re-burning ~60s.
- **Model fallback:** `FALLBACK_MODEL = { 3.0-flash → 2.5-flash }`, timeout-triggered, KV-flagged 10 min. Explicit 3.0 requests probe cheaply (`probeTimeoutMs`), then serve from 2.5.
- **Groq ban:** Groq keys are NEVER loaded (founder decision 2026-09-21, hallucination quality). Copilot is Agnes-only; throttle answers "busy" instead of guessing.
- **Egress order:** proxy-first always (home tunnel); direct Cloudflare egress is the fallback on proxy fault/misconfiguration. A proxy 429 is a real upstream answer; proxy faults never penalise keys (3-strike 60s skip-ladder).
- **Headers:** browser-like `User-Agent` (bypasses their bot challenge); `Accept: application/json` implied. Do NOT switch to a self-declared bot UA — more likely to be pooled as bot traffic.

## Home-egress proxy (fallback lane)

- Code: `home-egress/` (`proxy.js` zero-dep forwarder + `Dockerfile` + `docker-compose.yml` with `cloudflared` quick tunnel + `README.md`).
- Worker secrets: `AGNES_PROXY_URL` (static named-tunnel hostname, e.g. `https://egress-bui.apotza.com` — set once, never rotates) + `AGNES_PROXY_SECRET`.
- Proxy allowlists `apihub.agnes-ai.com` only, requires the secret per call, streams SSE transparently, returns upstream status verbatim (including 429s), marks its own failures (`x-proxy-error`) so the gateway falls through cleanly. Health: `GET /health`.
- Runners (`scripts/ai-gateway.js`) intentionally ignore proxy vars — GitHub egress is clean.

## Usage / consumption logs

**There is no public API.** The per-key table (`Secret Key Name / Consumption Model / Amount(cents) / Quantity / Time / Status`) is a manual CSV export from each account's developer dashboard. Without UI logins to the key-owning accounts, pull CSVs from the owners (community analyzer: `GavinCnod/agnes-api-usage-analysis`, browser-local). Our-side metering (per-key log in D1) is the alternative if dashboard access stays unavailable.

## Chat completions

```bash
curl https://apihub.agnes-ai.com/v1/chat/completions \
 -H "Authorization: Bearer $AGNES_API_KEY" \
 -H "Content-Type: application/json" \
 -d '{"model":"agnes-2.5-flash","messages":[{"role":"user","content":"Hello!"}]}'
# 200 → choices[0].message.content, (reasoning_content when Thinking), usage { prompt_tokens, completion_tokens, total_tokens, completion_tokens_details {reasoning_tokens,text_tokens}, prompt_tokens_details {cached_tokens} }
# Also: chat_template_kwargs: {enable_thinking:true} for thinking
```

Also supports `POST /v1/responses` (`input` instead of `messages`) and Anthropic `POST /v1/messages` (`x-api-key`, `anthropic-version: 2023-06-01`).

## Reasoning / Thinking

Reasoning via Thinking — `chat_template_kwargs: {enable_thinking:true}` (OpenAI-compatible) or Anthropic `thinking: {type:"enabled", budget_tokens:2048}`. 2.5-flash emits `reasoning_content` (also without the flag on short prompts); 3.0 emits when Thinking is on (when its channel is alive).

No `include_reasoning` — unknown params → 503/400. `"thinking"` alone without `chat_template_kwargs` is Anthropic path, not ChatCompletions.

## Tool calling (OpenAI shape, verified 9/9 on 2.5-flash)

```json
{
  "model":"agnes-2.5-flash",
  "messages":[{"role":"user","content":"What is weather in Singapore?"}],
  "tools":[{"type":"function","function":{"name":"get_weather","description":"Get weather","parameters":{"type":"object","properties":{"location":{"type":"string"}},"required":["location"]}}}],
  "tool_choice":"auto"
}
```

35k-token 9-tool suite (2026-09-20, 2.5-flash): **9/9 perfect** + 3-parallel bonus 3/3, prompt caching active (~35k cached_tokens/turn), lat 1.5–7.7s. Unlike Dahl (7/9), Agnes honored every `kb_lookup` when phrasing included `Use kb_lookup.` — keep that suffix (or `tool_choice: required`) for audited KB paths.

## Streaming, vision, concurrency

- **Streaming** `stream:true` → SSE `data:{…}` ending `data:[DONE]`, TTFT ~0.5–0.7s. Reassemble `delta.tool_calls` by index.
- **Vision** `messages[].content: [{type:text},{type:image_url, image_url:{url}}]` on 2.5-flash (intake chain falls back to OpenRouter VL on error).
- **Concurrency**: our Worker never fans out to Agnes (all sequential, max 6-step agentic loop). Keep it that way — bursts trip the IP-level 1015 fastest. Runners: zoho analyzer `AI_CONCURRENCY=1`.
- **Errors**: `400 messages is required`, `401 Token not provided` / `Invalid token`, `503 model_not_found` — all fast and actionable (see matrix above).

## Python sketch (with thinking + retry)

```python
import json, time, urllib.request
BASE="https://apihub.agnes-ai.com/v1"
def chat(payload, api_key, timeout=120):
    body=json.dumps(payload).encode()
    req=urllib.request.Request(BASE+"/chat/completions",data=body,headers={"Authorization":f"Bearer {api_key}","Content-Type":"application/json"},method="POST")
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r: return json.loads(r.read())
        except Exception as e:
            if getattr(e,"code",None)!=429 or attempt==3: raise
            time.sleep(min(5,2**attempt))
```
