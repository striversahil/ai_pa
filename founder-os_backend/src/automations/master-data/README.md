# Customer Master

The Zoho customer book as a first-class dashboard — the reference table every
enquiry, estimate and sales order ultimately points at.

- `MasterCustomer`: one row per Zoho customer (2,604 seeded), keyed by
  `zohoCustomerId` so a re-import upserts instead of duplicating. Contact
  channels live in `phonesJson`/`emailsJson` (a customer legitimately has
  several). `customerTypeBase`/`customerTypeTag` are derived at import — the
  Zoho extract spells "Flour Mill" 65 different ways, the filter uses the family.
- `MasterRegion`: the four R1–R4 rows from the extract's `summary` (zone,
  coverage, sales person, allotted name). These region ids match the live
  Telecaller roster; the telecalling board's coverage copy is a separate text.
- `MasterDataAudit`: insert-only log of imports, record edits, duplicate-group
  reviews and editor appointments (who / what / when).

Reads: `GET /api/automations/master-data/data` — one KV-cached payload
(`master:data:v1`, 5 min TTL, invalidated on every write). The dashboard filters
and sorts client-side. Detail (address/provenance/notes) is fetched per row.

Writes (worker route `src/worker/routes/master-data.ts` — Express is frozen):

| endpoint | who |
|---|---|
| `PATCH /api/master-data/customers/:id` | appointed editors + sales-head/MIS/root |
| `PATCH /api/master-data/duplicates/:group` | appointed editors + sales-head/MIS/root |
| `POST /api/master-data/import` | sales-head/MIS/root |
| `GET/PUT /api/master-data/editors…` | sales-head/MIS/root |

Region/sub-area/state reassignment is manager-only (ownership is the
sales-head's job); everything else on a record is the appointed editor's.

## Seeding

`data/master_data.json` (the founder's extract) is the source of truth for the
initial load. Two paths, both idempotent:

```bash
# Regenerate the durable migration (schema + regions + chunks of INSERTs)
node scripts/gen-master-data-migration.mjs
npx wrangler d1 execute waba-worker --remote --file migrations/0087_master_data.sql
```

The runtime equivalent (for later refreshes) is the Import button in the
dashboard, which POSTs the same JSON to `/api/master-data/import`.
