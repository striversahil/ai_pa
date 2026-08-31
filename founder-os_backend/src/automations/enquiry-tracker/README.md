# Enquiry Tracker

Live sales pipeline dashboard. Enquiries and comments are stored in D1 (Worker)
or Postgres (Express) and pushed to open dashboards over the EventHub
(`LiveEvent.Enquiries`). No scheduled processing — this automation exists so the
tracker shows up in the Automations registry with a `View Dashboard` entry.

## API
- `GET  /api/enquiries` → `{ enquiries, comments }`
- `POST /api/enquiries` — create enquiry
- `PATCH /api/enquiries/:id` — update
- `DELETE /api/enquiries/:id` — delete
- `GET/POST /api/enquiries/:id/comments` — threaded comments

## Dashboard
- Slug: `enquiry-tracker`
- Frontend renderer: `EnquiryTracker` (mounted via `Automations.tsx`), scope `enquiries`.