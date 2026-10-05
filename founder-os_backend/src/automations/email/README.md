# Email service (`automations/email/`)

Modular send-as-Gmail service: connect a Gmail account once, then send to
anyone, save drafts, or schedule one-shot / daily-repeat mails.

## Files

- `types.ts` — shapes, provider contract, RFC822 builder, input validation
- `gmail.ts` — Gmail provider (OAuth + send/drafts/list, pure fetch)
- `store.ts` — D1 persistence ONLY (`EmailAccount` / `EmailOutbox` / `EmailLog`)
- `service.ts` — orchestration (tokens, send, drafts, schedule, cron tick)
- `../worker/routes/email.ts` — Worker `/api/email/*` (production path)
- `../routes/email.ts` — Express mirror (stateless; schedule → 501)

## Connect a Gmail (two ways)

1. **OAuth dance** — needs worker secrets `GOOGLE_CLIENT_ID` /
   `GOOGLE_CLIENT_SECRET` (one Google Cloud project, Gmail API enabled) and
   redirect URI `<PUBLIC_ORIGIN>/api/email/oauth/callback` registered.
   Open `/api/email/oauth/start?email=<you@gmail.com>&label=<name>`
   (signed in as root) → Google consent → done. Tokens auto-refresh.
2. **Paste refresh token** — mint at the OAuth 2.0 Playground
   (scope `gmail.compose gmail.readonly`, your client id/secret), then:
   `POST /api/email/connect {label, email, refreshToken}`.
   The token is verified (profile read) before anything is stored.

Tokens live ONLY in `CACHE_KV` (`email:oauth:<accountId>`).

## Use

- Send now: `POST /api/email/send {accountId, to[], cc?, bcc?, subject, body, html?}`
- Draft: `POST /api/email/draft` (same shape) → `{draftId}` (a real Gmail draft)
- Drafts: `GET /api/email/drafts?account=<id>` · `DELETE /api/email/draft?account=<id>&draftId=<d>`
- Schedule once: `POST /api/email/schedule {…, sendAt: ISO}` (must be future)
- Cron daily: `POST /api/email/schedule {…, repeatDailyAt: "HH:MM"}` (IST) —
  the per-minute worker cron tick sends it and re-queues for tomorrow
- Inspect: `GET /api/email/outbox` · `DELETE /api/email/outbox/:id` (cancel) ·
  `GET /api/email/log`

Writes (connect/send/draft/schedule/cancel/disconnect) are ROOT-only; reads
ride the dashboard session. No attachments in v1 (MIME builder is single-part;
extend `buildRawMessage` for multipart when needed). Next providers
(SMTP/Graph) implement `EmailProvider` in a new file — no route changes.
