## The Problem with the Current System

Your current WhatsApp digest extracts "action items" into generic tasks, but they're **disconnected from the chat**. When you open a chat, you can't see "in this conversation, I owe these 3 things." That's why things slip through — the tasks exist somewhere, but not in the context of the conversation where they belong.

## The Best Method: A Per-Chat "Pending From Me" Ledger

The most effective approach is to maintain a **running ledger of open items per chat**, where each item represents something **you owe** in that specific conversation. Here's the full design:

### 1. Data Model — Track items per chat
For each chat, maintain a list of pending items, each with:
- **`chatId`** — which chat this belongs to
- **`description`** — what's pending from YOUR side (e.g., "Send revised quote to Rahul")
- **`status`** — `OPEN` / `DONE` / `CANCELLED`
- **`dueDate`** — optional deadline
- **`sourceMessageId`** — link to the exact message that created it
- **`createdAt` / `resolvedAt`** — timestamps

This is the key difference: **a single chat can have multiple open items**, and they're all visible in the chat's context.

### 2. AI Extraction — Focus on "what the founder owes"
Enhance the digest prompt to explicitly extract **"pending from founder"** items per chat, not just generic action items. The AI would ask: *"What is the founder expected to do or respond to in this conversation?"* This catches things like:
- Promises made ("I'll send the quote tomorrow")
- Questions directed at you that you haven't answered
- Requests you acknowledged but haven't fulfilled
- Follow-ups you said you'd do

### 3. Resolution Detection — Auto-close when you respond
When you send a message in a chat, the AI checks whether it resolves any open pending items and marks them `DONE`. This prevents stale items from piling up.

### 4. Per-Chat Dashboard — The "What I Owe" view
A dashboard (or a section in each chat) showing:
- **All chats with open pending items**, sorted by urgency
- **Within each chat, the list of open items** — so you see "In Rahul's chat, I owe: quote, pitch deck, meeting confirmation"
- **Overdue items highlighted** in red

### 5. Escalation & Reminders
- Overdue items get flagged and surfaced in your morning brief
- Items untouched for X days get escalated

## Why This Beats the Current Approach

| Current System | Per-Chat Ledger |
|---|---|
| Generic tasks, disconnected from chat | Items tied to the specific chat |
| One summary per chat | Multiple tracked items per chat |
| No visibility of "what I owe" in a chat | Instant per-chat "what I owe" view |
| Items never auto-close | Auto-closes when you respond |
| Context loss | Zero context loss — everything tracked |

## Implementation Path

This builds directly on your existing infrastructure:
1. **Add a `ChatPendingItem` model** to Prisma (or extend the existing `Task` model with `chatId` + `status`).
2. **Update the digest prompt** (`summarizeConversation.ts` / `incrementalSummarizeConversation.ts`) to extract "pending from founder" items explicitly.
3. **Update `process.ts`** to save these items per chat instead of (or in addition to) generic tasks.
4. **Add resolution detection** — when a new outbound message is sent in a chat, run a quick AI check to close resolved items.
5. **Build the per-chat "What I Owe" view** in the frontend, plus surface overdue items in the morning brief.

This gives you a single source of truth: **open any chat → see exactly what's pending from your side → nothing slips through.**

Would you like me to implement this? I can start with the data model and the AI prompt changes, then build the per-chat pending view.