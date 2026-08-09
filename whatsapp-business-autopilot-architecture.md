# WhatsApp Business Autopilot — Complete Architecture

*The core problem this solves: turning messy WhatsApp conversations into structured, trackable business work — not by teaching the AI to "understand WhatsApp," but by building a structured business operating layer underneath it.*

## 0. What "autopilot" should mean in practice

True unattended automation on day one is a bad idea for this business — you're quoting prices and committing to availability, and a wrong auto-reply costs you a customer or a loss-making sale. The architecture below automates the parts that are pure overhead (reading history, tracking context, chasing vendors, sending reminders) and keeps a human in the loop for anything that commits the business. That split is what makes it safe to actually turn on.

---

## 1. The mental model

| Concept | Role |
|---|---|
| WhatsApp | The messy interface — where humans actually talk |
| Message lineage | Relationship / memory — how one message connects to the last |
| Task queue | Current business state — what's open, right now, per chat |
| General context | The business operating system — rules and capabilities that apply everywhere |
| Fine-grained context | Contact-specific behavior — who this person is and how to treat them |
| LLM | Reasoning / state-transition engine — decides what changes, not just what to say |
| Database | Source of truth — the only place state actually lives |
| Tools | Business actions — what the system is actually allowed to do |
| Human review | Safety net — where anything uncertain lands |

WhatsApp itself never becomes structured — it stays exactly as messy as it always was. What changes is that every message now gets processed against a real, queryable model of "what's currently going on."

---

## 2. The core loop

Every message — incoming or outgoing — is processed as an **event against the system's current state**, not independently, in two phases:

**Phase 1 — Association: which task does this belong to?**
1. Try a deterministic link first — WhatsApp's own reply/thread relationship (§4.3)
2. If there's no explicit link, fall back to the LLM — infer the most likely task from the message, context, and the open task queue
3. If the LLM isn't confident, don't guess — route to human review (thresholds in §8)

**Phase 2 — Transition: what should happen to that task?**
The LLM acts as a **state-transition engine**, picking one of eight transitions:

| Transition | Meaning |
|---|---|
| Create | This is genuinely new — open a task |
| Update | New information on an already-open task |
| Complete | The task is resolved |
| Reopen | A completed task just got new, relevant activity |
| Wait | Blocked on something external — paused, not stalled |
| Clarify | Not enough information yet — ask the customer something before proceeding |
| Review | Low confidence, or policy requires a human regardless — hand off |
| Action | Trigger a business action/tool as part of handling this task |

These aren't mutually exclusive — a message commonly produces a primary transition plus an action (e.g. **Create + Action**). The exact contract between Action and the other seven is in §4.7.

```
Message + Context + Task Queue → [Association] → [State Transition] → Task/State Changes + Actions
```

---

## 3. System overview

| # | Layer | Job |
|---|-------|-----|
| 1 | Channel layer | WhatsApp Business Platform — the actual messaging rail |
| 2 | Ingestion & normalization | Webhook receiver — idempotent, media-aware, turns raw events into a clean log |
| 3 | Message lineage & association | Resolves message → parent → root, links messages to tasks |
| 4 | Context model | General (global) + fine-grained (contact-specific) |
| 5 | Task queue | Per-chat working state |
| 6 | LLM state-transition engine | One of eight transitions per message |
| 7 | Business actions (tools) | Declared in general context, executed through a registry |
| 8 | Human review | Safety net |
| 9 | Follow-up scheduler | Customer-side silence and internal Wait-state timeouts |
| 10 | Concurrency control | Prevents duplicate tasks and lost updates under simultaneous messages |
| 11 | Multimodal handling | Images, PDFs, voice, catalog replies |
| 12 | Database | Source of truth for all of the above |

The diagrams shown earlier cover the high-level pipeline and the core per-message loop at the concept level. Everything below is the engineering detail needed to make that loop hold up under real traffic — concurrent messages, retried webhooks, non-text input, and failures.

---

## 4. Component breakdown

### 4.1 Channel layer
Meta Cloud API directly, or a BSP on top of it — see §10.

### 4.2 Ingestion & normalization
- Writes every inbound/outbound message to an immutable `messages` log
- Captures the WhatsApp reply/quote reference when present (deterministic lineage signal)
- Resolves `contact` and `chat`, then hands off to lineage resolution

**Idempotency**: `wa_message_id` carries a unique constraint on the `messages` table. Every insert is an upsert-then-check — if a message with that ID already exists, the webhook is acknowledged and dropped without reprocessing. This makes Meta/BSP retries and duplicate deliveries safe by construction, with no separate dedupe table needed.

**Out-of-order delivery** is handled in lineage resolution (§4.3), not here — ingestion's only job is to record the message and its raw reply-to reference, correctly, exactly once.

### 4.3 Message lineage & task association

**Lineage**: `message → parent → parent → root → task`. Following parents up gets you the root — the message that originally opened whatever thread this belongs to.

**Association, deterministic first**:
1. **Deterministic** — an explicit WhatsApp reply link to a message already tied to a task
2. **LLM fallback** — no explicit relationship → infer from message, context, and the open task queue
3. **Confidence gate** — low confidence → human review, not a guess

```
on new_message:
    lineage = resolve_lineage(message)          # parent -> parent -> root

    if lineage.has_explicit_task_link():
        task = lineage.linked_task              # deterministic
    else:
        task, confidence = llm_infer_task(message, context, task_queue)
        if confidence < ASSOCIATION_THRESHOLD:
            task = None
            route_to_human_review(message)

    if task:
        attach(message, task)

    transition = llm_state_transition(message, context, task)  # Phase 2
```

**Out-of-order arrival**: a webhook can deliver a reply before its parent (Meta/BSP don't guarantee order). If `reply_to_wa_message_id` points to a message not yet in the `messages` table, mark that lineage row `resolution_status = pending` and **don't block** — fall through to the LLM-fallback path immediately so the customer-facing response isn't delayed. When the missing parent eventually arrives, a background job re-checks for any pending children referencing it and resolves the link retroactively. This mainly matters for lineage-chain integrity and analytics after the fact; the real-time decision already went through LLM association and isn't waiting on it.

**Internal / vendor chat heuristic**: the same deterministic-then-LLM logic applies in internal chats (e.g. the pricing group), but two things differ in practice: (a) staff often reply free-form without quoting, so the deterministic path fires less often there than with customers; (b) when multiple people are discussing different items in the same group, "most recent open task in this chat" is not a safe heuristic on its own. Tag chats with a `chat_role` (`customer` / `internal` / `vendor`, see §5) and, for internal/vendor roles, let the LLM fallback weight item/product terms mentioned in the reply against the open task queue rather than defaulting to recency. If it's still genuinely ambiguous (two open tasks, same item, unclear which), route to review rather than guess — for internal chats this can be as lightweight as the reviewer (or the bot, via `request_clarification`) asking the replying staff member which task they mean, since they're internal and easy to ask directly.

### 4.4 Context model
**General context (global)** — business rules, tool access, fallback behavior, event handlers (§7). Applies to every chat.

**Fine-grained context (optional, per contact)** — role/type, language, pricing rules, special instructions. Example: *Purchaser → communicate in Japanese → use dealer pricing.* Overrides/extends general context when present; falls back to general alone when absent.

### 4.5 Task queue
Every chat's list of open/unfinished tasks — this, not the full raw history, is what's fed into the LLM call. A group chat with four things going on is four independently trackable rows instead of one blurred feed.

### 4.6 LLM state-transition engine
Given an associated task (or a clear signal it's new), outputs one of the eight transitions plus structured fields. It decides *what changes*, never *what the answer is* — facts come from tools, not memory.

### 4.7 Business actions (tools)

**The Action contract, made explicit**:
- Action can be emitted alongside any of the other seven transitions in the same turn. The transition determines the task's new state; the action is a side effect the orchestrator asks the registry to perform in service of that transition.
- The LLM *proposes* an action. The tool registry — not the LLM — decides whether it can run immediately or needs approval first, based on that tool's `requires_approval` flag. The LLM's read on urgency doesn't override this.
- **If a tool call fails or times out**, behavior depends on whether the action was load-bearing for the transition:
  - If the transition's content depended on the action's result (e.g. an Update whose new price came from a lookup that failed), the transition does **not** stand — the task stays in its prior state and moves to **Review**, with the failure reason attached.
  - If the action was a downstream side effect of an already-decided transition (e.g. a `forward_message` after a Create — the task is real regardless of whether the forward succeeded), the transition stands, and the failed action is retried/escalated independently per its `on_failure` policy, logged in `actions` with `status = failed`.
  - Every tool in the registry declares an `on_failure` policy: `retry(n, backoff)`, `review`, or `degrade` (a defined fallback, e.g. "if `check_inventory` is down, don't guess — hold the task in Wait and flag for manual stock check").

| Tool | Purpose | Example `on_failure` |
|---|---|---|
| `check_inventory(item, size)` | Real stock lookup, never from memory | `retry(2, 30s)` then `review` |
| `broadcast_to_vendors(item, vendor_list)` | Fan out a sourcing request | `retry(1)` then `degrade` (send to fewer vendors, flag gap) |
| `forward_message(target_chat, context_summary)` | Route to another chat with a synthesized summary | `retry(3, backoff)` then `review` |
| `send_reply(chat_id, message_type, content)` | Send the actual WhatsApp response | `retry(3, backoff)` then `review` |
| `escalate_to_human(task_id, reason)` | The Review transition, made concrete | n/a (this *is* the fallback) |
| `schedule_follow_up(task_id, due_at)` | Registers a reminder | `retry(2)` then `review` |
| `request_clarification(chat_id, question)` | Internal-chat disambiguation (§4.3) | `retry(1)` then `review` |

Canonical example: *price enquiry → create task → forward to pricing group → wait → receive price → update task → respond to customer* = **Create + Action** (`forward_message`) → **Wait** → (deterministic lineage resolves the reply) → **Update + Action** (`send_reply`).

### 4.8 Human review — the safety net
A staff-facing view filtered by `status = needs_review`, with the reason attached (low association confidence, low transition confidence, failed load-bearing action, sentiment escalation, internal ambiguity). Don't over-build this initially.

### 4.9 Follow-up scheduler & task lifecycle
Watches two kinds of silence:
- **Customer-side**: no inbound message in 24h — subject to WhatsApp's messaging-window rules (§9.1)
- **Internal-side**: a task in **Wait** past a business-defined timeout (e.g. a vendor hasn't responded in 4 hours) — your own SLA, not a WhatsApp rule

**Concrete lifecycle defaults** (starting points, configurable per `task_type`):

| Step | Default timing |
|---|---|
| First customer follow-up | +24h of silence |
| Second follow-up | +48h of silence (i.e. 24h after the first nudge) |
| Auto-complete / mark closed-unresponded | 7 days of silence for fast-moving types (e.g. `price_enquiry`); 14 days for types with naturally longer cycles (e.g. `order`) |
| Internal Wait timeout (vendor) | 4h, escalate to next vendor or flag for manual follow-up |

```
follow_up_policy
  task_type, first_follow_up_after, second_follow_up_after,
  auto_close_after, wait_timeout_after, updated_at
```

### 4.10 Concurrency control
Two messages arriving near-simultaneously for the same chat — a reply and an unrelated new message, or two people replying at once in a group — must not create duplicate tasks or attach to a task another process just completed.

- **Per-chat serialization**: route messages through a queue/lock keyed by `chat_id`, so within one chat, messages are processed one at a time in arrival order. This removes most races cheaply — WhatsApp chat volume rarely makes this a bottleneck.
- **Optimistic concurrency on tasks**: `tasks` carries a `version` integer. Every transition write is conditioned on `WHERE version = <version read>`. If zero rows update — the task changed underneath it, e.g. the follow-up scheduler completed it in another lane at the same moment — re-read the task and re-run Phase 2 against fresh state, rather than blindly overwriting.
- **Create-dedupe window**: before firing a Create, check for a task with the same `(chat_id, item, status = open)` created in the last few seconds; if found, treat the message as an Update to that task instead. Cheap insurance on top of serialization, since serialization alone doesn't help if two *different* chats or two lanes race on the same underlying request.

### 4.11 Multimodal input handling
The model can't stay text-only — real commerce traffic includes:

| Input | Handling |
|---|---|
| Product photos | Passed directly as an image alongside text context to the transition engine (native vision); a `match_product_image(image)` tool maps it to a catalog SKU when precision matters |
| PDFs / order documents | Passed directly for extraction, or through a dedicated structured-extraction tool at higher volume |
| Voice notes | Transcribed to text **during ingestion**, before the core loop — the orchestrator only ever sees text/images, never raw audio. Keep the original audio reference attached so a human reviewer can double-check a misheard transcription |
| Native catalog replies | WhatsApp delivers these as structured message types already (product ID, not free text) — ingestion should parse the structured fields directly rather than asking the LLM to re-extract them from text |

`messages` carries a `message_kind` (`text` / `image` / `pdf` / `voice` / `catalog_reply`) so downstream logic knows what it's looking at without inspecting content.

### 4.12 Database — the source of truth
Everything the system knows lives here: messages, message lineage, contact context, tasks, task history, actions — plus the supporting tables introduced above (`chats`, `follow_up_policy`, `override_log`). Full schema in §5.

---

## 5. Data model

### Messages
```
messages
  message_id, chat_id, contact_id, direction (in/out), body,
  message_kind (text/image/pdf/voice/catalog_reply), media_ref, transcript (nullable),
  timestamp, wa_message_id UNIQUE, reply_to_wa_message_id
```

### Message lineage
```
message_lineage
  message_id, parent_message_id, root_message_id,
  task_id (nullable until associated),
  association_method (deterministic / llm / human),
  confidence (nullable, set only when association_method = llm),
  resolution_status (resolved / pending)
```

### Chats & contacts
```
chats
  chat_id, chat_type (individual/group), chat_role (customer/internal/vendor), name

contacts
  contact_id, wa_id, name, chat_id, opted_in
```

### Contact context
```
context_general      -- one active version, applied to every call
  version_id, business_rules, tools_available, fallback_behavior,
  event_handlers, updated_at

context_profile       -- fine-grained, optional, per contact
  contact_id, role_type, language, pricing_tier,
  special_instructions, active (bool)
```

### Tasks
```
tasks
  task_id, chat_id, contact_id, task_type, item,
  status (open / waiting / needs_clarification / needs_review / completed),
  assigned_to, association_task_id, root_message_id,
  version (int, optimistic concurrency),
  created_at, last_inbound_at, last_outbound_at,
  waiting_since, wait_timeout_at, follow_up_due_at, in_24h_window
```

### Task history
```
task_history
  history_id, task_id,
  transition (create/update/complete/reopen/wait/clarify/review/action),
  triggered_by (llm/human), message_id, notes, occurred_at
```

### Actions
```
actions
  action_id, task_id, tool_name, input, output,
  status (success/failed/pending), requested_by (llm/human), executed_at
```

### Confidence & follow-up config (new — see §8, §4.9)
```
override_log
  override_id, task_id, message_id, decision_type (association/transition),
  system_decision, system_confidence, human_decision, overridden_at, reviewer

follow_up_policy
  task_type, first_follow_up_after, second_follow_up_after,
  auto_close_after, wait_timeout_after, updated_at
```

### Supporting reference data
```
products
  product_id, name, size_variants, price, stock_qty

vendors
  vendor_id, name, wa_id/phone, product_categories, reliability_score
```

---

## 6. End-to-end walkthrough

1. Customer in a group chat messages: "Item B, size 6 inch available?" — a fresh message, no reply-to reference
2. Ingestion logs it (idempotent on `wa_message_id`); lineage resolution finds no parent — this message is its own root
3. Association: no deterministic link → LLM checks the open task queue → nothing matches → **Create**
4. New task `T-104` opens: type `price_enquiry`, item "Item B", size 6", `version = 1`
5. Same turn, **Action**: `check_inventory("Item B", "6\"")` → size 6" not in stock, size 4" is
6. Needs a person to confirm substitution and price → **Review**, `escalate_to_human(T-104, "substitution needs price confirmation")`
7. Staff, in the pricing group, forwards and confirms — **Action**: `forward_message(pricing_group, "Item B size 6 unavailable, size 4 in stock, need price")`, opening a linked task with `association_task_id = T-104`
8. A staff member replies inside the pricing group, quoting the forwarded message, with the price
9. Lineage resolves that reply as a reply to the forwarded message → deterministic association finds `T-104` immediately
10. **Update** (price now known) + **Action**: `send_reply` back to the customer with the confirmed substitution and price
11. Task status → **Wait**; `follow_up_due_at` set to +24h per the default policy (§4.9)
12. No reply in 24h → scheduler checks the messaging window (§9.1) and sends either a free-form nudge or an approved template; a second nudge is scheduled for +48h if still silent
13. Customer eventually replies "Done," nested several messages deep, replying to an earlier message rather than the latest one — lineage still walks message → parent → parent → root → `T-104`
14. **Complete**

What isn't shown above — a second message arriving in the same second, a webhook retry, a voice note instead of text, `check_inventory` timing out — is handled by §4.9–§4.12 and §7, not by special-casing the happy path.

---

## 7. Failure modes & graceful degradation

These should be declarable in `context_general.event_handlers` — that field exists specifically so degradation behavior is business config, not buried in code.

| Failure | Behavior |
|---|---|
| Inventory system unreachable | `check_inventory` retries per its policy (§4.7); exhausted retries → task moves to **Review** with reason "inventory check failed" — never silently assumed in or out of stock |
| LLM returns invalid/unparseable structured output | Reject, retry once with the validation error included in the next call; second failure → **Review**, raw output logged for debugging |
| Tool call times out | Same pattern as inventory — per-tool retry, then **Review** |
| Human review queue backlog | Define a queue-depth alert (e.g. more than 20 open `needs_review` tasks) that notifies an owner rather than letting tasks silently age; consider oldest-first or `task_type`-priority triage once backlog exceeds threshold |
| Webhook delivery failure / duplicate | Duplicates are absorbed by the `wa_message_id` unique constraint (§4.2); true gaps (a webhook that never arrived) require a periodic reconciliation job comparing your log against the BSP's message history |

---

## 8. Confidence thresholds and evaluation

Association confidence and transition confidence are tracked and tuned **separately** — a message can be correctly linked to the right task and still need Review because the transition itself is uncertain, and vice versa.

**Starting thresholds** (conservative on purpose — these are starting points, not fixed values):
- Association: below ~0.85 → human review rather than auto-attach
- Transition — Create/Update: below ~0.8 → review
- Transition — Complete: below ~0.9 → review (closing something wrongly is worse than leaving it open one extra cycle)
- Wait/Clarify: no meaningful threshold needed — neither commits anything, so they're safe to act on even at lower confidence

**Log everything needed to tune later**: every association and transition decision is logged with its confidence score in `task_history`; every time a human overrides one, that's logged in `override_log` alongside the system's original decision and confidence. Reviewing override rate by confidence bucket (e.g. "how often were 0.75–0.85 association calls actually wrong?") is what tells you whether a threshold should move — start conservative, loosen where the data says the system was already right.

---

## 9. What WhatsApp's platform rules mean for this design

### 9.1 The 24-hour customer service window
Every inbound customer message opens a 24-hour window for free-form messages. Once 24 hours pass with no customer message, you can **only** reach them via a pre-approved **message template**. This only applies to customer-facing messages — internal Wait-state timeouts (§4.9) aren't Meta-regulated and shouldn't be conflated with it.

Draft your most common follow-up messages as templates now and get them approved early — approval isn't instant and you can't improvise template text at send time.

### 9.2 Template categories affect compliance and cost
**Utility** (service-related, tied to something the customer already did), **Authentication** (OTPs), or **Marketing** (promotions). A stock follow-up on an existing enquiry is Utility. Utility templates sent inside an open window generally don't incur an extra fee; outside the window, they typically do.

### 9.3 Pricing has shifted to a per-template/category model
Meta charges by template category and context (in-window vs out-of-window) rather than flat per-conversation, with a monthly allowance of free service conversations. Rates vary by country and change periodically — check current India rates before budgeting.

### 9.4 Native catalog features can replace custom `send_reply` logic
Single product messages, multi-product messages (up to 30 items), catalog messages, and product carousels are built in. If your products are in a Meta Commerce Catalog, `send_reply` can call these directly instead of a custom document composer.

### 9.5 Opt-in is required
Applies equally to `forward_message` and `broadcast_to_vendors` — vendors and third parties need the same opt-in standing as customers.

---

## 10. Meta Cloud API vs a BSP

| | Direct Meta Cloud API | BSP (e.g. AiSensy, Interakt, Gupshup, 360dialog, Wati) |
|---|---|---|
| Cost | No platform markup, only Meta's rates | Meta's rates + BSP's platform fee (roughly ₹1,000–₹15,000+/month) and sometimes a per-message markup |
| Effort | You build the dashboard, inbox, template manager yourself | Comes with a staff-facing inbox, template builder, broadcast tools out of the box |
| Best fit | You have (or are building) developer capacity | You want to move fast without a dev team maintaining the UI layer |
| India-specific note | — | AiSensy and Interakt are commonly recommended for India-based SMBs on cost and local support; Gupshup and 360dialog skew larger/more developer-first |

Given you're building lineage, association, and a transition engine regardless, a reasonable middle path: a BSP (or 360dialog) purely for sending/receiving and template management, with the rest built on top of their webhook/API.

---

## 11. Tech stack options

### MVP (low-code, fastest to a working system)
- **Channel**: A BSP with a solid API (AiSensy/Interakt/360dialog)
- **Orchestration**: n8n or Make.com — webhook → lineage resolution → LLM call → task write → tool execution → scheduler
- **LLM**: Claude API — native tool use for the registry (§4.7), structured JSON output for transitions
- **Data store**: Postgres (Supabase is a fast path) — needs `message_lineage`, `task_history`, and `override_log` from day one
- **Human review dashboard**: Airtable/Retool view filtered by `status = needs_review`
- **Follow-up scheduler**: n8n cron, checking both silence types (§4.9)

### Custom build (once the logic is proven and volume justifies it)
- **Backend**: Node.js or Python handling the webhook, lineage resolution, and the transition-engine call, with per-chat locking (§4.10)
- **Data store**: Postgres
- **Queue/scheduler**: Redis + a worker (Celery/BullMQ) for follow-up timing, retries, and tool execution
- **LLM**: Claude API with the tool registry as real tool-use schemas, including `on_failure` policies
- **Dashboard**: A small React app for staff
- **Channel**: Meta Cloud API directly, or a lean BSP like 360dialog

---

## 12. Guardrails

- **No auto-sent prices or commitments** in phase 1 — `send_reply` with a price attached always requires review until the transition engine has an evaluated track record (§8).
- **Inventory truth comes from `check_inventory`, never from memory.**
- **Association confidence and transition confidence are separate gates** — don't collapse them into one score.
- **Per-tool approval and failure policy, not a global switch** — every tool declares both `requires_approval` and `on_failure` (§4.7).
- **Full audit trail** — `task_history`, `actions`, and `override_log` together make every decision reconstructable and every threshold tunable from real data, not guesswork.
- **Escalation on sentiment**: a frustrated customer triggers Review immediately, regardless of task state.
- **Graceful degradation is business config**, not an afterthought — failure behavior lives in `context_general.event_handlers` (§7).

---

## 13. Phased rollout

| Phase | What's automated | What's still manual |
|---|---|---|
| 0 — Shadow mode | Lineage, association, and transitions run and populate the task queue; no tools execute | You still work WhatsApp normally, with a structured view alongside it |
| 1 — Assisted | Live transitions, including low-risk **Wait** and **Clarify** (they commit nothing) | Every **Action** or **Complete** touching price, substitution, or a third party is approved first |
| 2 — Semi-auto | Low-risk tools run autonomously (`check_inventory`, `schedule_follow_up`); price-bearing tools still reviewed | Price/substitution/exception handling |
| 3 — Scoped full-auto | Narrow, well-understood flows (standard sizes, fixed pricing, no negotiation) run fully unattended | Everything else stays human-reviewed indefinitely — that's fine |

---

## 14. Decisions to make before you build

1. **Meta Cloud API directly or a BSP** — §10
2. **Where does live inventory truth live?** `check_inventory` needs a real system to query
3. **First draft of general context** — business rules, tool-use policy, and event handlers (§7) — plus which contacts need a fine-grained profile now vs later
4. **Starting confidence thresholds** — §8 gives defaults; decide who owns tightening them as `override_log` fills in
5. **Per-tool `requires_approval` and `on_failure` policy** — the actual dial for how "autopilot" the system feels, tool by tool (§4.7)
6. **Follow-up and auto-close timing per task type** — §4.9 gives defaults; confirm they match how fast your different task types actually move
7. **Vendor sourcing dispatch** — does `broadcast_to_vendors` fan out to all 15–20 vendors at once, or go sequentially?
8. **Review queue backlog owner and alert threshold** — §7 — who gets notified, and at what depth?

---

*Note: WhatsApp Business Platform pricing, template policies, and catalog features change periodically — verify current rates and policy details at business.whatsapp.com and developers.facebook.com/docs/whatsapp before finalizing budgets or template submissions.*
