# Dahl AI Usage Guide

OpenAI-compatible inference gateway. Verified against live API on 2026-09-20
(model `deepseek-ai/DeepSeek-V4-Flash-0731`, plus short-prompt baselines).

- Base URL: `https://inference.dahl.global/v1`
- Auth: `Authorization: Bearer <DAHL_API_KEY>` — Bearer key with allocated token balance.
- Docs: `https://inference.dahl.global/docs/api`, `https://inference.dahl.global/docs/models`
- NEVER commit a key. The test key previously pasted in chat is compromised — rotate it.

## Models (verify live via `GET /v1/models` — IDs rotate)

| Model ID | Context | Notes |
|---|---|---|
| `MiniMaxAI/MiniMax-M2.7` | 200K | Default, chat + coding, tools |
| `deepseek-ai/DeepSeek-V4-Flash-0731` | 1M | Fast coding, reasoning, agents, tools |
| `zai-org/GLM-5.3-Flash` | — | Tools (per status probes) |

`GET /v1/status?window=1h|24h|7d|30d` (public) reports per-model `operational` + uptime.
`GET /tokens/current` (authed) reports remaining balance.

## Chat completions

```bash
curl https://inference.dahl.global/v1/chat/completions \
  -H "Authorization: Bearer $DAHL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek-ai/DeepSeek-V4-Flash-0731",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
# 200 → assistant text at choices[0].message.content
# usage: {prompt_tokens, completion_tokens, total_tokens}
```

Short prompts: ~0.25s p50, 100% success at 20-way parallel (tested: 90 requests, zero 429/5xx).

## Reasoning (empirically verified — NOT in official docs)

- Supported via **`"reasoning_effort": "medium"`** (also accepts low/high implied).
  Response then includes a separate **`message.reasoning`** string alongside `content`.
- Without the param: reasoning appears inline in `content` only, no separate field.
- `"thinking": {"type": "enabled"}` → 200 but silently ignored.
- `"include_reasoning": true` → **400 rejected** (Gonka network rejects non-standard params).
- Always send `reasoning_effort` when you need a separable reasoning channel.

```json
{
  "model": "deepseek-ai/DeepSeek-V4-Flash-0731",
  "messages": [{"role": "user", "content": "Show your work: speed for 60km in 1.5h?"}],
  "reasoning_effort": "medium",
  "temperature": 0,
  "max_tokens": 300
}
```

## Tool calling (OpenAI shape, verified on DeepSeek Flash)

```json
{
  "model": "deepseek-ai/DeepSeek-V4-Flash-0731",
  "messages": [{"role": "user", "content": "Weather in Mumbai in celsius?"}],
  "tools": [{"type": "function", "function": {
    "name": "get_weather",
    "description": "Current weather for a city",
    "parameters": {"type": "object",
      "properties": {"city": {"type": "string"},
                     "units": {"type": "string", "enum": ["celsius", "fahrenheit"]}},
      "required": ["city"]}}}],
  "tool_choice": "auto"
}
```

Single-tool `auto` calls: 5/5 correct tool + args. Multi-tool, forced, and
long-context retrieval also work, **but the client MUST implement these rules**:

1. **Trigger on presence of `tool_calls`, NOT on `finish_reason`.**
   Forced `tool_choice` returns `finish_reason: "stop"` WITH `tool_calls` populated.
2. **Strip `<｜DSML｜>` control-token leakage** from `content` before display/logging
   (observed on forced calls).
3. **Forced choice is advisory** — the model once called the query-correct tool
   instead of the forced one. Validate the returned function name.
4. **Validate all args** — vague prompts yield hallucinated defaults
   (e.g. invented `priority: "medium"`); over-triggering happens
   ("Answer directly" still emitted a `calculator` call).
5. Chunk very large expressions — a 200-term addition returned empty content with
   `finish_reason: "length"`.

## Streaming

Add `"stream": true` → OpenAI SSE (`data: {...}` lines, ends `data: [DONE]`).
Tool calls arrive as `delta.tool_calls` chunks — reassemble by `index`, then
concatenate `function.arguments` fragments before `JSON.parse`.
Measured TTFT on 38k-token prompts: 1.7s / 3.6s. Prefer streaming for long contexts.

## Concurrency limits (measured — the critical constraint)

| Workload | Observed ceiling (anonymous key) |
|---|---|
| Short prompts (~6 prompt tokens) | 20-way parallel, 100% OK, ~23 rps |
| Long prompts (~38k prompt tokens) | **~1–5 concurrent**; 30-burst → 5 admitted, 25 × `429 model_concurrency` |

- `429 {"code": "model_concurrency"}` = shared-capacity admission, NOT your rate.
  Even concurrency 1 with 20–30s spacing hit 429s during contention.
  Retry with 60s backoff; signed-in/paid linked keys are admitted first.
- Long-context latency: p50 ~2–6s, tails to 22s (judgment queries) and 122s observed.
  **Timeout ≥180s** for 38k prompts; expect minutes, not seconds, at scale.
- Identical prompts are **response-cached** (~0.25s, byte-identical) — use unique
  prompts when benchmarking; prefix caching helps repeated system prompts.

## Not supported — do NOT send these (per official API reference)

| Feature | Status | Corrected usage |
|---|---|---|
| **Web search** (`tools: [{type: "web_search"}]`) | ❌ Skipped server-side | Bring your own search: call your search API yourself, inject results into `messages`, then ask the model to answer |
| OpenAI computer-use / code-interpreter hosted tools | ❌ Skipped | Expose them as **function tools** you execute client-side instead |
| Vision / image input | ❌ Not offered on current models | Send text only (earlier Kimi docs mentioned vision; current API page says vision is not offered — re-check `/docs/api` before relying on it) |
| Embeddings | ❌ Not served | Use another provider for embeddings |
| `previous_response_id` / server-side conversations | ❌ Not stored | Send the full `input`/`messages` every turn (stateless) |
| `include_reasoning` and other non-standard params | ❌ 400-rejected by Gonka network | Use `reasoning_effort` only (see Reasoning above) |
| `/v1/responses/compact` (Codex built-in openai provider calls this) | ❌ Not implemented | Point Codex at a custom provider id (`dahl`), or use `/v1/chat/completions` |

`POST /v1/responses` exists as a thin adapter over the same models (for Codex CLI /
OpenAI Agents SDK): send `model` + `input`, read `output_text`. Function tools work
there; hosted tools are skipped the same way. Prefer MiniMax for agents per docs.

## Errors

| Status | Meaning | Action |
|---|---|---|
| 401 | Missing/invalid Bearer token | Fix `Authorization` header / rotate key |
| 402 | `available tokens exhausted` | Top up / allocate from pool |
| 400 | Stale model id / bad param (names the param) | Refresh `GET /v1/models`, drop the param |
| 429 `model_concurrency` | Model at capacity | 60s backoff, reduce parallelism, link key to account |
| 503 / timeout | Node overload | Short backoff, retry |

## Python sketch (buffered + retry)

```python
import json, time, urllib.request

URL = "https://inference.dahl.global/v1/chat/completions"

def chat(payload, api_key, timeout=200):
    body = json.dumps(payload).encode()
    req = urllib.request.Request(URL, data=body, headers={
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"}, method="POST")
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read())
        except Exception as e:
            if getattr(e, "code", None) != 429 or attempt == 3:
                raise
            time.sleep(60)
```

## Cost reference

~38k prompt tokens per 200KB-char system prompt (~5.3 chars/token).
Full workup (probes + 30-scenario matrix + retries) spent ~1.34M tokens.
Check spend via `GET /tokens/current` before/after large runs.
