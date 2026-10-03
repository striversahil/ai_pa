# Copilot engine (shared agentic loop)

One loop reused verbatim by every department copilot (sales enquiries,
product-line knowledge, product-line intake): Agnes-only, max 6 tool steps
per turn, max 25 human turns per chat (the 26th message is refused with
"Limit reached (25 chats) — open a new chat to continue"; new chat resets it),
return data (departments add proposals; writes happen only via confirmed
`/execute`). To add a department: implement `CopilotDef` (`types.ts`) and
register it in `registry.ts` — no engine or route changes needed.

- `types.ts` — `CopilotDef` contract (tools, prompts, history keys, confirm path).
- `engine.ts` — `runTurn` / `streamTurn` + rolling KV history (recent 12 near-verbatim, older as gists) + turn counter.
- `registry.ts` — id → def map for `/api/copilot/:id/*`.

## Built-in tools (default for EVERY copilot)

The engine appends these automatically and dispatches them itself —
departments never declare or handle them. Opt out per copilot with
`disableBuiltInTools: true` on the def.

- `web_search {query, count?}` (`src/shared/web-search.ts`) — public-web
  facts (market prices, standards, news). Provider chain, first non-empty
  win: `TAVILY_API_KEY` → `BRAVE_SEARCH_API_KEY` → `SERPER_API_KEY` →
  keyless DuckDuckGo-lite scrape (titles/URLs only, no snippets). Works with
  zero secrets today; for production-grade results set ONE worker secret:
  `printf '%s' "$KEY" | npx wrangler secret put TAVILY_API_KEY`.
  10s per-provider timeout; empty → `{results: [], note}` (never throws).
- `fetch_page {url, maxChars?}` (`src/shared/fetch-page.ts`) — fetch a URL
  as markdown text the LLM can read (the result-fetcher for web_search
  hits). Chain: official Firecrawl API when `FIRECRAWL_API_KEY` is set →
  keyless Jina AI reader (free, no secret) → `{text: '', note}` fallback.
  http(s) only, 10s timeout, 500–6000 chars (default 3000). Never throws.
- `calculate {expression}` (`src/shared/calculator.ts`) — deterministic
  multi-step arithmetic via a hand-written parser (NEVER eval): assignments
  + chained steps (`"qty = 220; rate = 145; total = qty * rate * 1.25"`,
  `ans` = previous value), `+ - * / ^ %`(percent) + parens,
  `sqrt abs round floor ceil min max pow`. Division by zero, unknown names,
  and injection attempts (`process`, `require`, …) are hard errors. Agents
  must use this for ALL numeric work instead of mental math.

activity chimes (`Searched web · N results`, `Fetched page · host · Xk chars`,
`Calculated = X`) are engine-built; frontend icon keys are `web_search` /
`fetch_page` / `calculate` (already mapped in `ChatbaseCopilot`, `CopilotChat`
via `ProductCopilot` configs).
