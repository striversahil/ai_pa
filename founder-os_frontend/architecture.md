# Frontend Architecture — founder-os_frontend

This document describes the component architecture, data flow, and design patterns used in the Founder OS frontend dashboard.

---

## 1. Overview

`founder-os_frontend` is a **standalone Next.js 16 static-export application**. It has no server-side rendering or API routes — it compiles to pure HTML/CSS/JS and is served by the `founder-os_backend` Express server from its `public/` directory.

```
┌─────────────────────────────────────────────────────────┐
│                  Browser (localhost:3000)                │
│                                                         │
│   ┌─────────────────────────────────────────────────┐   │
│   │              Next.js Static Bundle              │   │
│   │           (served from Express /public)         │   │
│   │                                                 │   │
│   │  Dashboard ──► ZohoEstimates                    │   │
│   │            ├──► FounderAssistant                │   │
│   │            ├──► EnquiryList / EnquiryDetail     │   │
│   │            └──► (future modules...)             │   │
│   └──────────────────────┬──────────────────────────┘   │
│                          │ fetch() REST calls            │
│                          ▼                               │
│   ┌─────────────────────────────────────────────────┐   │
│   │            Express REST API (same origin)        │   │
│   │                 /api/estimates                   │   │
│   │                 /api/brief/latest                │   │
│   │                 /api/digests                     │   │
│   │                 /api/tasks                       │   │
│   │                 /api/ask-founder-ai              │   │
│   └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

---

## 2. Component Hierarchy

```
page.tsx
└── Dashboard.tsx                      # Main shell, handles nav state
    ├── [Sidebar Navigation]
    ├── ZohoEstimates.tsx              # Active view: Zoho Estimates Queue
    │   ├── [Filter bar]              # Dynamic AI-flag filter chips
    │   ├── [Estimate cards]          # Rich context cards per estimate
    │   │   └── CommentNode.tsx       # Recursive comment thread renderer
    │   └── [Copy tools]             # One-click clipboard copy helpers
    ├── FounderAssistant.tsx          # Active view: AI Chat
    ├── EnquiryList.tsx               # Active view: Notion Enquiry Table
    │   └── EnquiryRowItem.tsx        # Single row card
    ├── EnquiryDetail.tsx             # Active view: Enquiry Deep-Dive
    │   ├── ClientProfile.tsx         # Client snapshot panel
    │   ├── SpecificationsSection.tsx # Product specs
    │   ├── ActivityTimeline.tsx      # Chronological feed
    │   └── CommentNode.tsx           # Comment thread
    ├── EnquiryModal.tsx              # Modal overlay for enquiry detail
    ├── CalendarRibbon.tsx            # Weekly calendar strip
    ├── KpiCard.tsx                   # Metric widget
    ├── PipelineFunnel.tsx            # Funnel chart
    ├── TrendChart.tsx                # Chart.js wrapper
    ├── FilterControls.tsx            # Reusable filter chip bar
    ├── Lightbox.tsx                  # Image preview overlay
    └── ToastContainer.tsx            # Toast notification stack
```

---

## 3. Data Flow

The frontend is fully client-side. All data is fetched on the client using the `useEffect` + `useState` pattern (no server components are used, since the app exports as static HTML).

### Fetch Pattern
```typescript
const [data, setData] = useState<any[]>([]);

useEffect(() => {
  fetch('/api/estimates')
    .then(r => r.json())
    .then(setData);
}, []);
```

### State Management
There is no external state manager (no Redux, no Zustand). All state is managed locally inside components with React hooks:
- `useState` for local UI state (selected filters, expanded cards, modal open state)
- `useMemo` for derived/filtered lists to avoid redundant re-computation
- Props drilling for parent-child communication

---

## 4. Build & Deployment Pipeline

```
npm run build
      │
      ▼
Next.js compiles TypeScript + Tailwind
      │
      ▼
Static assets written to ./out/
(index.html, _next/static/...)
      │
      ▼
cp -r ./out/* ../founder-os_backend/public/
      │
      ▼
Express serves static files on GET /*
from public/ directory
```

### Output Mode
`next.config.ts` sets:
```typescript
const nextConfig: NextConfig = {
  output: 'export',
};
```
This disables all server-side features and produces a fully portable static bundle.

---

## 5. Design System

All design tokens are defined as CSS custom properties in `src/app/globals.css` and are applied via Tailwind arbitrary values or direct CSS.

### Color Tokens

| Token               | Light Mode    | Dark Mode     | Purpose                    |
|---------------------|---------------|---------------|----------------------------|
| `--bg-app`          | `#ffffff`     | `#1e1f22`     | Page background            |
| `--bg-card`         | `#f2f3f5`     | `#2b2d31`     | Card surfaces              |
| `--bg-sidebar`      | `#e3e5e8`     | `#111214`     | Sidebar background         |
| `--text-primary`    | `#060607`     | `#f2f3f5`     | Main text                  |
| `--text-secondary`  | `#2e3338`     | `#dbdee1`     | Supporting text            |
| `--text-tertiary`   | `#5c6370`     | `#949ba4`     | Muted/meta text            |
| `--border-card`     | `#e3e5e8`     | `#3f4248`     | Card borders               |
| `--border-thread`   | `#e3e5e8`     | `#3f4248`     | Comment thread lines       |

### Brand Accent Tokens (Tailwind `@theme`)
```css
--color-brand-indigo: #5865f2;   /* Primary CTA, active states */
--color-brand-emerald: #248046;  /* Positive/success states */
--color-brand-amber: #f0b232;    /* Warning / pending states */
--color-brand-rose: #f04747;     /* Error / negative states */
```

### Animation Utilities
- `.animate-scale-up` — panel/card entry animation (scale + opacity)
- `.animate-fade-in` — gentle fade-in for modals/overlays

### Comment Thread Lines
`.comment-node-container::before` and `.replies-list-container::before` draw the vertical/corner thread connector lines mimicking a Twitter/X-style thread layout.

---

## 6. Adding a New View

To add a new section to the dashboard:

1. **Create a component** in `src/components/MyNewView.tsx`
2. **Add a nav item** in `Dashboard.tsx` sidebar navigation array
3. **Render the view** inside the `Dashboard.tsx` view-router conditional block:
   ```tsx
   {activeView === 'my-new-view' && <MyNewView />}
   ```
4. **Wire up the API call** inside your component using `fetch('/api/your-endpoint')`
5. **Build and deploy**:
   ```bash
   npm run build
   cp -r ./out/* ../founder-os_backend/public/
   ```

---

## 7. No Monorepo — Standalone App

This project was originally part of a Turborepo monorepo (`enquiry_tracker`). It has been converted to a **fully standalone flat Next.js app** for simplicity:

- No `turbo.json` or workspace packages
- The shared `@repo/theme` CSS package has been inlined directly into `src/app/globals.css`
- Uses `npm` instead of `pnpm` workspace commands
- All dependencies are declared directly in `package.json`
