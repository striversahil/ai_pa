# founder-os_frontend

A standalone **Next.js 16** static-export dashboard serving as the UI layer of the Founder OS executive assistant platform. It communicates exclusively with the `founder-os_backend` Express API and is served as pre-compiled static HTML/JS by the backend itself.

---

## Project Structure

```
founder-os_frontend/
├── src/
│   ├── app/
│   │   ├── globals.css        # Tailwind v4 + inline design system tokens
│   │   ├── layout.tsx         # Root layout with Geist fonts
│   │   └── page.tsx           # App shell — mounts the main Dashboard component
│   └── components/
│       ├── Dashboard.tsx          # Top-level layout: sidebar nav + active view router
│       ├── ZohoEstimates.tsx      # Zoho sent estimates queue with filters, cards, copy tools
│       ├── FounderAssistant.tsx   # AI chat interface with context-aware founder Q&A
│       ├── EnquiryList.tsx        # Notion enquiry table with status filters
│       ├── EnquiryDetail.tsx      # Per-enquiry deep-dive with specs, timeline, comments
│       ├── EnquiryModal.tsx       # Full modal view of an enquiry record
│       ├── EnquiryRowItem.tsx     # Single row card in enquiry list
│       ├── ClientProfile.tsx      # Client snapshot panel with deal history
│       ├── CommentNode.tsx        # Recursive Twitter-thread-style comment renderer
│       ├── FilterControls.tsx     # Generic filter chip bar
│       ├── CalendarRibbon.tsx     # Weekly calendar strip component
│       ├── ActivityTimeline.tsx   # Chronological activity feed
│       ├── KpiCard.tsx            # Metric card widget
│       ├── PipelineFunnel.tsx     # Sales pipeline funnel chart
│       ├── TrendChart.tsx         # Chart.js line/bar chart wrapper
│       ├── SpecificationsSection.tsx  # Enquiry product specs section
│       ├── Lightbox.tsx           # Image lightbox overlay
│       └── ToastContainer.tsx     # Toast notification system
├── public/                    # Static assets (favicon, images)
├── next.config.ts             # Next.js config — static export mode
├── package.json               # npm dependencies (no monorepo)
├── tsconfig.json              # TypeScript compiler options
├── postcss.config.mjs         # PostCSS + Tailwind v4 config
└── eslint.config.mjs          # ESLint + Next.js rules
```

---

## Tech Stack

| Layer       | Technology                    |
|-------------|-------------------------------|
| Framework   | Next.js 16 (App Router)       |
| Language    | TypeScript 5                  |
| Styling     | Tailwind CSS v4 (via PostCSS) |
| Charts      | Chart.js 4                    |
| Package Mgr | npm (standalone, no monorepo) |
| Build Mode  | Static Export (`output: 'export'`) |

---

## Development

### Prerequisites
- Node.js 20+
- `founder-os_backend` running on `http://localhost:3000`

### Run locally (dev server with HMR)
```bash
npm install
npm run dev
```
The dev server runs on `http://localhost:3001` (or next available port) and proxies API calls to the backend.

> **Note:** The `next.config.ts` is configured with `output: 'export'`. In dev mode, Next.js serves pages normally. The static export is only generated on `npm run build`.

### Build static bundle
```bash
npm run build
# Outputs static files to ./out/
```

### Deploy bundle to backend
After building, copy the output to the backend's `public/` directory:
```bash
rm -rf ../founder-os_backend/public/*
cp -r ./out/* ../founder-os_backend/public/
```

---

## Key Components

### `ZohoEstimates.tsx`
The primary workhorse component. Renders the full Zoho sent estimates review queue with:
- **Filter bar**: dynamic filter chips (e.g. "Follow-up missing", "Last comment > 5 hrs", "Under Discussion")
- **Estimate cards**: rich context cards showing customer name, value, AI intent score, reasoning, next action, and full comment thread
- **Copy tools**: one-click copy of estimate description + remarks for forwarding
- **Sync button**: triggers `/api/trigger/zoho-sync` to re-crawl Zoho and re-run AI classification

### `FounderAssistant.tsx`
Conversational AI panel that sends questions to `/api/ask-founder-ai`, returning answers with full inbox/estimate context.

### `Dashboard.tsx`
Main shell that manages the sidebar navigation state and renders the active view based on selected menu item.

---

## API Integration

All data is fetched from the `founder-os_backend` Express server. In production, both the frontend static assets and the API are served from the same origin (`http://localhost:3000`), so all API calls use relative paths (e.g. `/api/estimates`).

| Endpoint                      | Used By               |
|-------------------------------|-----------------------|
| `GET /api/estimates`          | `ZohoEstimates.tsx`   |
| `POST /api/trigger/zoho-sync` | `ZohoEstimates.tsx`   |
| `GET /api/brief/latest`       | `Dashboard.tsx`       |
| `GET /api/digests`            | `Dashboard.tsx`       |
| `GET /api/tasks`              | `Dashboard.tsx`       |
| `POST /api/ask-founder-ai`    | `FounderAssistant.tsx`|

---

## Design System

The design system tokens are inlined directly in `src/app/globals.css`:

- **Dark mode**: CSS class `.dark` on the root element toggles the full color palette
- **Colors**: `--bg-app`, `--bg-card`, `--bg-sidebar`, `--text-primary`, `--text-secondary`, etc.
- **Animations**: `.animate-scale-up`, `.animate-fade-in`
- **Scrollbar**: Custom Discord-style scrollbar styling
- **Thread lines**: `.comment-node-container` and `.replies-list-container` for Twitter-thread-style comment trees

---

## Docker

In the production Docker build, the frontend is compiled in a dedicated build stage and copied into the backend's `public/` folder. See the root-level `Dockerfile` for the multi-stage build definition.
