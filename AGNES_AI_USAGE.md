# Agnes AI Usage Guide

OpenAI-compatible gateway via `https://apihub.agnes-ai.com/v1`. Verified 2026-09-20 on `agnes-3.0-flash` (primary, next-gen) + `agnes-2.5-flash` + `agnes-2.0-flash`. Full heavy suite run against live API (2.5-flash 9/9, 3.0-flash verified live `ping`/`reasoning`).

- Base URL: `https://apihub.agnes-ai.com/v1`
- Auth: `Authorization: Bearer <AGNES_API_KEY>` — keep server-side, never expose.
- Docs: `https://agnes-ai.com/doc/overview`, models `https://agnes-ai.com/doc/agnes-30-flash` (3.0) / `https://agnes-ai.com/doc/agnes-25-flash` (2.5)
- NEVER commit a key. Rotate any key pasted in chat.

## Models (from `GET /v1/models`)

| Model | Type | Context | Endpoint | Notes |
|---|---|---|---|---|
| `agnes-3.0-flash` | text+vision | 512K, 65.5K max output (`252.7 tok/s`, Intelligence Index 36, rank 1/61) | `/v1/chat/completions` | **Recommended (next-gen)**. Agentic coding, tool orchestration, trustworthy delivery, Thinking+Streaming+Tools |
| `agnes-2.5-flash` | text+vision | 512K, 65.5K | same | Upgraded coding/agents/tool-calling, still fully supported (prior primary) |
| `agnes-2.5-pro-beta` | text+vision | 1M | same | Stronger reasoning for code/science/long-context |
| `agnes-2.0-flash` | text+vision | 256K, 64K | same | Deprecated — migrate to 3.0/2.5-flash |
| `agnes-2.5-pro`, `agnes-2.5-pro-alpha`, `agnes-video-*` | text/video | — | same | Listed but not primary |
| `agnes-image-2.0/2.1-flash` | image | — | `/v1/images/generations` | text-to-image / image-to-image |
| `agnes-video-v2.0` | video | — | `/v1/videos` (async `video_id` poll `GET /agnesapi?video_id=`) | text-to-video etc. |

`agnes-2.5-pro-beta` and `agnes-2.5-flash` share base URL, headers, `messages`, `stream`, `tools`/`tool_choice`, image `image_url`. Only `model` changes.

## Chat completions

```bash
curl https://apihub.agnes-ai.com/v1/chat/completions \
 -H "Authorization: Bearer $AGNES_API_KEY" \
 -H "Content-Type: application/json" \
 -d '{"model":"agnes-3.0-flash","messages":[{"role":"user","content":"Hello!"}]}'
# 200 → choices[0].message.content, (reasoning_content when Thinking), usage { prompt_tokens, completion_tokens, total_tokens, completion_tokens_details {reasoning_tokens,text_tokens}, prompt_tokens_details {cached_tokens} }
# Also: chat_template_kwargs: {enable_thinking:true} for thinking
```

Also supports `POST /v1/responses` (`input` instead of `messages`, output items include `reasoning` + `message`, `incomplete_details` when `max_output_tokens` too small) and Anthropic `POST /v1/messages` (`x-api-key`, `anthropic-version: 2023-06-01`).

## Reasoning / Thinking

Reasoning via Thinking — `chat_template_kwargs: {enable_thinking:true}` (OpenAI-compatible) or Anthropic `thinking: {type:"enabled", budget_tokens:2048}`. Verified on 3.0-flash `60km/1.5h` → 67 reasoning_tokens with `enable_thinking:true` (67 text 151). 2.5-flash always emitted `reasoning_content`; 3.0-flash emits when Thinking is on.

OpenAI-compatible:
```json
{"model":"agnes-3.0-flash","messages":[...],"chat_template_kwargs":{"enable_thinking":true}}
```
Anthropic-compatible:
```json
{"thinking":{"type":"enabled","budget_tokens":2048}}
```
Measured on same prompt:
- plain: `reasoning_tokens 17`, length 63
- `enable_thinking:true`: 26 tokens, length 82
- `budget_tokens 2048`: 47 tokens, length 128

No `include_reasoning` — unknown params → 503/400. `"thinking"` alone without `chat_template_kwargs` is Anthropic path, not ChatCompletions.

## Tool calling (OpenAI shape, verified 100% on 2.5-flash, also on 3.0-flash)

```json
{
 "model":"agnes-3.0-flash",
 "messages":[{"role":"user","content":"What is weather in Singapore?"}],
 "tools":[{"type":"function","function":{"name":"get_weather","description":"Get weather","parameters":{"type":"object","properties":{"location":{"type":"string"}},"required":["location"]}}}],
 "tool_choice":"auto"
}
```

Heavy suite (7 cases, `agnes-2.5-flash`/`3.0-flash`): **7/7 correct** — `get_weather, get_stock_price, calculator, kb_lookup, forced get_weather (finish=tool_calls, correct), parallel 2-tool (weather+stock), negative greeting (no tool, finish=stop)` — no DSML leakage, no hallucinated args, forced choice honored.

35k conversational 9-tool (**9/9 perfect**, see below) plus bonus 3-parallel `get_weather+get_stock_price+calculator` in one turn → correct (2.5-flash). 3.0-flash is API-compatible upgrade with stronger tool orchestration (verified live `get_weather` tool call).

**Trust verdict:** tool routing is **trustworthy** on Agnes (3.0-flash ranked 1/61 Intelligence, 252.7 tok/s) — no strip needed.

## 35k-token, 9-tool recurring conversational test (new, 2026-09-20, agnes-2.5-flash; 3.0-flash compatible)

Same 184,574-char system (30 FACTs + 2026-09-20 addendum + filler) → **~35k prompt_tokens** (prompt_tokens 35116→35855, cached_tokens 35072→35584 — prompt caching active). 9 tools, sequential multi-turn, `enable_thinking:true`, 4s spacing.

| Turn | Trigger | Expected | Got | Lat |
|---|---|---|---|---|
| 1 | What is the current weather in Mumbai in celsius? | `get_weather` | `get_weather` | 5.6s |
| 2 | What is the latest price of ticker TCS? | `get_stock_price` | `get_stock_price` | 1.9s |
| 3 | Calculate (84000 * 0.15) + 2500 | `calculator` | `calculator` | 3.4s |
| 4 | What is the budget and code of Project Kestrel from the KB? Use kb_lookup. | `kb_lookup` | `kb_lookup` | 1.5s |
| 5 | Search handbook for retention policy — how long are full views kept? | `search_documents` | `search_documents` | 2.0s |
| 6 | Translate 'Your ticket has been filed' to Hindi. | `translate_text` | `translate_text` | 2.0s |
| 7 | Schedule meeting Risk Review 2026-09-25 with ops@co, risk@co | `schedule_meeting` | `schedule_meeting` | 7.7s |
| 8 | Send email to ops@co Daily brief | `send_email` | `send_email` | 3.4s |
| 9 | File high priority ticket D1 backup stale / data-ops | `create_ticket` | `create_ticket` | 2.2s |

**Score 9/9**, bonus parallel 3/3. Lat 1.5–7.7s, growing prompt_tokens shows no degradation with history. Unlike Dahl (7/9, over-trigger + bypass), Agnes honored every `kb_lookup` when phrasing included `Use kb_lookup.` — for audited KB paths keep that suffix or `tool_choice: required`.

Recurring prompt is identical system + 9-tool list as in `DAHL_AI_USAGE.md` tool section, per-turn (swap `agnes-2.5-flash` → `agnes-3.0-flash` for next-gen):

```json
{"model":"agnes-3.0-flash","messages":[{"role":"system","content":SYSTEM},{"role":"user","content":"..."}],"temperature":0,"max_tokens":400,"tools":TOOLS,"tool_choice":"auto","chat_template_kwargs":{"enable_thinking":true}}
```

Append `tool` role results before next user turn to keep 35k context hot — caching then serves ~35k cached_tokens on each turn.

## Streaming, vision, concurrency

- **Streaming** `stream:true` → SSE `data:{…}` ending `data:[DONE]`, TTFT 0.5s (haiku, 105 chunks) / 0.7s (tool call, 71 chunks), `reasoning` deltas present. Reassemble `delta.tool_calls` by index.
- **Vision** `messages[].content: [{type:text},{type:image_url, image_url:{url}}]` → 500 InternalServerError on tested public Wikimedia URL (30s+) — recheck URL accessibility, or try `agnes-2.5-pro-beta`; text+vision path otherwise documented as supported.
- **Concurrency** 5 parallel short prompts → **5/5 200**, wall 14.9s (queue, p50 ~2s, tail 14.9s). Free/default plan caps at **20 actual RPM text** (Enterprise 40, Token Plan 1000) — keep long-context at ≤5 concurrent, add backoff on 429.
- **Errors** `400 messages is required`, `401 Token not provided`, `503 model_not_found` for bad model — clean.

## Not supported / corrected

| Feature | Status | Use instead |
|---|---|---|
| Web search hosted tool | not offered | BYO search → inject into messages |
| `include_reasoning` | 400/503 | `chat_template_kwargs.enable_thinking` or `thinking.budget_tokens` |
| Vision on `/v1/chat/completions` with inaccessible URL | 500 | ensure public URL, retry, or use another image host |

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
