# Enquiry Tracker

Live sales pipeline dashboard. Enquiries and comments are stored in D1 (Worker)
or Postgres (Express) and pushed to open dashboards over the EventHub
(`LiveEvent.Enquiries`). No scheduled processing — this automation exists so the
tracker shows up in the Automations registry with a `View Dashboard` entry
(`rule.json` trigger is `manual`).

## API
- `GET  /api/enquiries` → `{ enquiries, comments }`
- `GET  /api/enquiries/clients` → `[{ name, openEstimates, enquiries }]` —
  client master merged from Zoho customers + companies used on enquiries
  (procurement gets `[]`; client PII stays hidden there)
- `GET  /api/enquiries/agents` — sales roster (procurement gets `[]`)
- `POST /api/enquiries` — create enquiry (daily no. from an atomic Setting
  counter; junk quote amounts are 400s, never silent drops)
- `PATCH /api/enquiries/:id` — update (send `items` to save manual item edits;
  editing `description` without `items` resets items for AI re-split)
- `DELETE /api/enquiries/:id` — delete
- `GET/POST /api/enquiries/:id/comments` — threaded comments

Live broadcasts carry scope-safe summaries only (counts + label parts, never
PII/free text); every view refetches its own scoped payload on events.
The dashboard payload (`data()`) is KV-cached 60s and busted on every write.

## Line items (Item 1..N)
The unstructured Specifications & Scope (`description`) is AI-split into
`items: [{ name, qty, spec, media }]` by the background extraction (description
only, AI decides boundaries). Stored on the row; sales can edit/delete/add
manually. Each item carries `media: [{ type: 'image'|'video', url }]` (data-URI,
≤10MB each, ≤10 per item) — media passes through unredacted in procurement
(technical drawings) but is part of the freshness hash. Visible in both views
with inline video players + Lightbox playback. Money inputs accept `₹`/commas
(`₹1,200.50` → 1200.50); anything else non-numeric is a 400 with a message.

## Dashboard
- Slug: `enquiry-tracker`
- Frontend renderer: `EnquiryTracker` (mounted via `Automations.tsx`), scope `enquiries`.
